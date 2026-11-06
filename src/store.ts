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

export type Outbox = { entries: Record<string, Entry>; items: Record<string, CustomItem> };

interface State {
  entries: Record<string, Entry>;
  items: Record<string, CustomItem>;
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

type LegacyShape = { entries?: Array<Partial<Entry>>; customCats?: Partial<Record<EType, string[]>>; customPeople?: string[] };

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
  return { entries, items };
}

function load(): State {
  const s = read<State>(KEY);
  if (s && s.entries && s.items) return s;
  const legacy = read<LegacyShape>(LEGACY_KEY);
  return legacy ? fromLegacy(legacy) : { entries: {}, items: {} };
}

type Listener = () => void;

class RegisterStore {
  private state: State = load();
  private outbox: Outbox = read<Outbox>(OUTBOX_KEY) || { entries: {}, items: {} };
  private listeners = new Set<Listener>();
  private snapshot = this.makeSnapshot();
  onLocalChange: (() => void) | null = null;

  private makeSnapshot() {
    return {
      entries: Object.values(this.state.entries).filter(e => !e.deleted),
      items: Object.values(this.state.items).filter(i => !i.deleted),
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
  /** Replaces everything with the given rows (restore backup / clear all). */
  replaceAll(next: State) {
    for (const e of Object.values(this.state.entries)) if (!e.deleted && !next.entries[e.id]) this.stampEntry({ ...e, deleted: true });
    for (const i of Object.values(this.state.items)) if (!i.deleted && !next.items[i.id]) this.stampItem({ ...i, deleted: true });
    for (const e of Object.values(next.entries)) this.stampEntry({ ...e, deleted: false });
    for (const i of Object.values(next.items)) this.stampItem({ ...i, deleted: false });
    this.commit();
  }

  // — sync hooks —
  pending(): Outbox { return { entries: { ...this.outbox.entries }, items: { ...this.outbox.items } }; }
  pendingCount() { return Object.keys(this.outbox.entries).length + Object.keys(this.outbox.items).length; }
  /** Drops outbox rows that were pushed, unless they changed again meanwhile. */
  acknowledge(sent: Outbox) {
    for (const [id, r] of Object.entries(sent.entries)) if (this.outbox.entries[id]?.updatedAt === r.updatedAt) delete this.outbox.entries[id];
    for (const [id, r] of Object.entries(sent.items)) if (this.outbox.items[id]?.updatedAt === r.updatedAt) delete this.outbox.items[id];
    write(OUTBOX_KEY, this.outbox);
  }
  /** Merges rows from the server; the newer updatedAt wins. */
  mergeRemote(entries: Entry[], items: CustomItem[]) {
    let changed = false;
    for (const e of entries) {
      const cur = this.state.entries[e.id];
      if (!cur || e.updatedAt > cur.updatedAt || (e.updatedAt === cur.updatedAt && JSON.stringify(e) !== JSON.stringify(cur))) { this.state.entries[e.id] = e; changed = true; }
    }
    for (const i of items) {
      const cur = this.state.items[i.id];
      if (!cur || i.updatedAt > cur.updatedAt) { this.state.items[i.id] = i; changed = true; }
    }
    if (changed) this.emit();
  }
  hasLocalData() { return Object.values(this.state.entries).some(e => !e.deleted); }
  /** Wipes this device's copy (sign-out, or declining to upload pre-sign-in data). */
  resetLocal() {
    this.state = { entries: {}, items: {} };
    this.outbox = { entries: {}, items: {} };
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
    return { app: 'wealthwise-register', exported: new Date().toISOString(), entries, customCats, customPeople };
  }
  /** Queues every local row for upload — used the first time a device joins a shared register. */
  queueAllLocal() {
    for (const e of Object.values(this.state.entries)) this.outbox.entries[e.id] = e;
    for (const i of Object.values(this.state.items)) this.outbox.items[i.id] = i;
    write(OUTBOX_KEY, this.outbox);
  }
}

export const store = new RegisterStore();
