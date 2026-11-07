// Local-first register store. Every change is written to this device first
// (localStorage), then queued in an outbox that the sync layer pushes to
// Supabase. Remote rows are merged by updatedAt, so the newest edit wins and
// soft-deleted rows ("deleted") carry removals to every phone.

export type EType = 'income' | 'expense' | 'investment';
export const TYPES: EType[] = ['income', 'expense', 'investment'];

export interface Entry {
  id: string;
  type: EType;
  amount: number;
  date: string; // YYYY-MM-DD
  cat: string;
  person: string;
  desc: string;
  created: number;
  updatedAt: number;
  deleted?: boolean;
  createdByEmail?: string | null;
}

export interface CustomItem {
  id: string; // kind:type:name
  kind: 'cat' | 'person';
  type: EType | '';
  name: string;
  updatedAt: number;
  deleted?: boolean;
}

/** Loans and planned commitments (insurance, fees, …) — the Statements screen's data. */
export interface Loan {
  name: string; lender: string; principal: number; rate: number; // % per year
  tenure: number; // months
  firstEmi: string; // YYYY-MM-DD of the first instalment
  emi?: number; // bank's EMI if it differs from the calculated one
  person: string;
}
export type CommitmentKind = 'insurance' | 'fees' | 'rent' | 'subscription' | 'tax' | 'other';
export type Frequency = 'monthly' | 'quarterly' | 'half-yearly' | 'yearly' | 'once';
export interface Commitment {
  name: string; kind: CommitmentKind; amount: number; frequency: Frequency;
  firstDue: string; endDate?: string; reference?: string; person: string;
}
export type RecordKind = 'loan' | 'commitment';
export interface StoredRecord {
  id: string; kind: RecordKind; data: Loan | Commitment; updatedAt: number; deleted?: boolean;
}

export type Outbox = { entries: Record<string, Entry>; items: Record<string, CustomItem>; records: Record<string, StoredRecord> };

interface State {
  entries: Record<string, Entry>;
  items: Record<string, CustomItem>;
  records: Record<string, StoredRecord>;
}

const KEY = 'wealthwise_register_v2';
const LEGACY_KEY = 'wealthwise_register_v1'; // the design prototype's storage
const OUTBOX_KEY = 'wealthwise_outbox_v1';

export const itemId = (kind: CustomItem['kind'], type: CustomItem['type'], name: string) => `${kind}:${type}:${name}`;
export const newId = () => 'e' + Date.now() + Math.random().toString(36).slice(2, 7);

function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ }
}

type LegacyShape = { entries?: Array<Partial<Entry>>; customCats?: Partial<Record<EType, string[]>>; customPeople?: string[]; loans?: Array<{ id: string } & Loan>; commitments?: Array<{ id: string } & Commitment> };

/** Converts the prototype's / backup file's shape into store rows. */
export function fromLegacy(d: LegacyShape, stamp = Date.now()): State {
  const entries: Record<string, Entry> = {};
  for (const e of d.entries || []) {
    if (!e || !e.id || !e.type || !TYPES.includes(e.type as EType) || !(+(e.amount ?? 0) > 0) || !e.date) continue;
    entries[e.id] = {
      id: e.id, type: e.type as EType, amount: +e.amount!, date: String(e.date).slice(0, 10), cat: e.cat || 'Other',
      person: e.person || '', desc: e.desc || '', created: +(e.created ?? stamp) || stamp, updatedAt: stamp,
    };
  }
  const items: Record<string, CustomItem> = {};
  for (const t of TYPES) for (const name of d.customCats?.[t] || []) { const id = itemId('cat', t, name); items[id] = { id, kind: 'cat', type: t, name, updatedAt: stamp }; }
  for (const name of d.customPeople || []) { const id = itemId('person', '', name); items[id] = { id, kind: 'person', type: '', name, updatedAt: stamp }; }
  const records: Record<string, StoredRecord> = {};
  for (const { id, ...data } of d.loans || []) if (id) records[id] = { id, kind: 'loan', data: data as Loan, updatedAt: stamp };
  for (const { id, ...data } of d.commitments || []) if (id) records[id] = { id, kind: 'commitment', data: data as Commitment, updatedAt: stamp };
  return { entries, items, records };
}

function load(): State {
  const s = read<State>(KEY);
  if (s && s.entries && s.items) return { ...s, records: s.records || {} };
  const legacy = read<LegacyShape>(LEGACY_KEY);
  return legacy ? fromLegacy(legacy) : { entries: {}, items: {}, records: {} };
}

type Listener = () => void;

class RegisterStore {
  private state: State = load();
  private outbox: Outbox = { entries: {}, items: {}, records: {}, ...(read<Outbox>(OUTBOX_KEY) || {}) };
  private listeners = new Set<Listener>();
  private snapshot = this.makeSnapshot();
  onLocalChange: (() => void) | null = null;

  private makeSnapshot() {
    return {
      entries: Object.values(this.state.entries).filter(e => !e.deleted),
      items: Object.values(this.state.items).filter(i => !i.deleted),
      records: Object.values(this.state.records).filter(r => !r.deleted),
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private emit() {
    this.snapshot = this.makeSnapshot();
    write(KEY, this.state);
    this.listeners.forEach(l => l());
  }

  // — local writes (queued for sync) —
  private stampEntry(e: Entry) {
    const row = { ...e, updatedAt: Math.max(Date.now(), (this.state.entries[e.id]?.updatedAt || 0) + 1) };
    this.state.entries[e.id] = row;
    this.outbox.entries[e.id] = row;
  }
  private stampItem(i: CustomItem) {
    const row = { ...i, updatedAt: Math.max(Date.now(), (this.state.items[i.id]?.updatedAt || 0) + 1) };
    this.state.items[i.id] = row;
    this.outbox.items[i.id] = row;
  }
  private stampRecord(r: StoredRecord) {
    const row = { ...r, updatedAt: Math.max(Date.now(), (this.state.records[r.id]?.updatedAt || 0) + 1) };
    this.state.records[r.id] = row;
    this.outbox.records[r.id] = row;
  }
  private commit() {
    write(OUTBOX_KEY, this.outbox);
    this.emit();
    this.onLocalChange?.();
  }

  putEntry(e: Entry) { this.stampEntry(e); this.commit(); }
  deleteEntry(id: string) { const e = this.state.entries[id]; if (e) { this.stampEntry({ ...e, deleted: true }); this.commit(); } }
  addItem(kind: CustomItem['kind'], type: CustomItem['type'], name: string) {
    const id = itemId(kind, type, name);
    if (this.state.items[id] && !this.state.items[id].deleted) return;
    this.stampItem({ id, kind, type, name, updatedAt: 0 }); this.commit();
  }
  putRecord(id: string, kind: RecordKind, data: Loan | Commitment) { this.stampRecord({ id, kind, data, updatedAt: 0 }); this.commit(); }
  deleteRecord(id: string) { const r = this.state.records[id]; if (r) { this.stampRecord({ ...r, deleted: true }); this.commit(); } }
  hasEntry(id: string) { const e = this.state.entries[id]; return !!e && !e.deleted; }
  /** Replaces everything with the given rows (restore backup / clear all). */
  replaceAll(input: Omit<State, 'records'> & { records?: State['records'] }) {
    const next: State = { ...input, records: input.records || {} };
    for (const e of Object.values(this.state.entries)) if (!e.deleted && !next.entries[e.id]) this.stampEntry({ ...e, deleted: true });
    for (const i of Object.values(this.state.items)) if (!i.deleted && !next.items[i.id]) this.stampItem({ ...i, deleted: true });
    for (const e of Object.values(next.entries)) this.stampEntry({ ...e, deleted: false });
    for (const i of Object.values(next.items)) this.stampItem({ ...i, deleted: false });
    for (const r of Object.values(this.state.records)) if (!r.deleted && !next.records[r.id]) this.stampRecord({ ...r, deleted: true });
    for (const r of Object.values(next.records)) this.stampRecord({ ...r, deleted: false });
    this.commit();
  }

  // — sync hooks —
  pending(): Outbox { return { entries: { ...this.outbox.entries }, items: { ...this.outbox.items }, records: { ...this.outbox.records } }; }
  pendingCount() { return Object.keys(this.outbox.entries).length + Object.keys(this.outbox.items).length + Object.keys(this.outbox.records).length; }
  /** Drops outbox rows that were pushed, unless they changed again meanwhile. */
  acknowledge(sent: Outbox) {
    for (const [id, r] of Object.entries(sent.entries)) if (this.outbox.entries[id]?.updatedAt === r.updatedAt) delete this.outbox.entries[id];
    for (const [id, r] of Object.entries(sent.items)) if (this.outbox.items[id]?.updatedAt === r.updatedAt) delete this.outbox.items[id];
    for (const [id, r] of Object.entries(sent.records)) if (this.outbox.records[id]?.updatedAt === r.updatedAt) delete this.outbox.records[id];
    write(OUTBOX_KEY, this.outbox);
  }
  /** Merges rows from the server; the newer updatedAt wins. */
  mergeRemote(entries: Entry[], items: CustomItem[], records: StoredRecord[] = []) {
    let changed = false;
    for (const e of entries) {
      const cur = this.state.entries[e.id];
      if (!cur || e.updatedAt > cur.updatedAt || (e.updatedAt === cur.updatedAt && JSON.stringify(e) !== JSON.stringify(cur))) { this.state.entries[e.id] = e; changed = true; }
    }
    for (const i of items) {
      const cur = this.state.items[i.id];
      if (!cur || i.updatedAt > cur.updatedAt) { this.state.items[i.id] = i; changed = true; }
    }
    for (const r of records) {
      const cur = this.state.records[r.id];
      if (!cur || r.updatedAt > cur.updatedAt) { this.state.records[r.id] = r; changed = true; }
    }
    if (changed) this.emit();
  }
  hasLocalData() { return Object.values(this.state.entries).some(e => !e.deleted); }
  /** Wipes this device's copy (sign-out, or declining to upload pre-sign-in data). */
  resetLocal() {
    this.state = { entries: {}, items: {}, records: {} };
    this.outbox = { entries: {}, items: {}, records: {} };
    write(OUTBOX_KEY, this.outbox);
    this.emit();
  }
  /** The prototype / backup-file shape, for export. */
  exportLegacy() {
    const snap = this.makeSnapshot();
    const customCats: Record<EType, string[]> = { income: [], expense: [], investment: [] };
    const customPeople: string[] = [];
    for (const i of snap.items) { if (i.kind === 'cat' && i.type) customCats[i.type].push(i.name); else if (i.kind === 'person') customPeople.push(i.name); }
    const entries = snap.entries.map(({ id, type, amount, date, cat, person, desc, created }) => ({ id, type, amount, date, cat, person, desc, created }));
    const loans = snap.records.filter(r => r.kind === 'loan').map(r => ({ id: r.id, ...r.data }));
    const commitments = snap.records.filter(r => r.kind === 'commitment').map(r => ({ id: r.id, ...r.data }));
    return { app: 'wealthwise-register', exported: new Date().toISOString(), entries, customCats, customPeople, loans, commitments };
  }
  /** Queues every local row for upload — used the first time a device joins a shared register. */
  queueAllLocal() {
    for (const e of Object.values(this.state.entries)) this.outbox.entries[e.id] = e;
    for (const i of Object.values(this.state.items)) this.outbox.items[i.id] = i;
    for (const r of Object.values(this.state.records)) this.outbox.records[r.id] = r;
    write(OUTBOX_KEY, this.outbox);
  }
}

export const store = new RegisterStore();
