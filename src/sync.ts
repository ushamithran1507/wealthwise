import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { store, type CustomItem, type Entry, type EType, type Outbox } from './store';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const syncEnabled = !!supabase;

const OWNER_KEY = 'wealthwise_synced_email';

// — row mapping —
type EntryRow = { id: string; type: EType; amount: number | string; date: string; cat: string; person: string; description: string; created: number | string; updated_at: number | string; deleted: boolean; created_by_email?: string | null };
type ItemRow = { id: string; kind: 'cat' | 'person'; type: EType | ''; name: string; updated_at: number | string; deleted: boolean };

const toEntry = (r: EntryRow): Entry => ({ id: r.id, type: r.type, amount: +r.amount, date: r.date, cat: r.cat, person: r.person, desc: r.description, created: +r.created, updatedAt: +r.updated_at, deleted: r.deleted, createdByEmail: r.created_by_email ?? null });
const fromEntry = (e: Entry) => ({ id: e.id, type: e.type, amount: e.amount, date: e.date, cat: e.cat, person: e.person, description: e.desc, created: e.created, updated_at: e.updatedAt, deleted: !!e.deleted });
const toItem = (r: ItemRow): CustomItem => ({ id: r.id, kind: r.kind, type: r.type, name: r.name, updatedAt: +r.updated_at, deleted: r.deleted });
const fromItem = (i: CustomItem) => ({ id: i.id, kind: i.kind, type: i.type, name: i.name, updated_at: i.updatedAt, deleted: !!i.deleted });

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';

async function pullAll<T>(sb: SupabaseClient, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Runs the sync loop for a signed-in member. Returns a stop function. */
function startEngine(sb: SupabaseClient, setStatus: (s: SyncStatus) => void, setError: (m: string) => void) {
  let stopped = false, flushing = false, again = false, timer: number | undefined;
  let channel: RealtimeChannel | null = null;

  const report = () => setStatus(!navigator.onLine ? 'offline' : store.pendingCount() ? 'syncing' : 'synced');

  async function flush() {
    if (stopped) return;
    if (flushing) { again = true; return; }
    if (!navigator.onLine) { report(); return; }
    flushing = true;
    try {
      do {
        again = false;
        const batch: Outbox = store.pending();
        const entries = Object.values(batch.entries), items = Object.values(batch.items);
        if (!entries.length && !items.length) break;
        setStatus('syncing');
        for (let i = 0; i < items.length; i += 500) {
          const { error } = await sb.from('custom_items').upsert(items.slice(i, i + 500).map(fromItem));
          if (error) throw error;
        }
        for (let i = 0; i < entries.length; i += 500) {
          const { error } = await sb.from('entries').upsert(entries.slice(i, i + 500).map(fromEntry));
          if (error) throw error;
        }
        store.acknowledge(batch);
      } while (again && !stopped);
      report();
    } catch (err) {
      setError((err as Error).message || 'Could not reach the shared register.');
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally { flushing = false; }
  }

  async function pull() {
    if (stopped || !navigator.onLine) { report(); return; }
    try {
      setStatus('syncing');
      const [entries, items] = await Promise.all([pullAll<EntryRow>(sb, 'entries'), pullAll<ItemRow>(sb, 'custom_items')]);
      store.mergeRemote(entries.map(toEntry), items.map(toItem));
      await flush();
    } catch (err) {
      setError((err as Error).message || 'Could not load the shared register.');
      setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  channel = sb.channel('register')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, p => { if (p.new && 'id' in p.new) store.mergeRemote([toEntry(p.new as EntryRow)], []); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_items' }, p => { if (p.new && 'id' in p.new) store.mergeRemote([], [toItem(p.new as ItemRow)]); })
    .subscribe(s => { if (s === 'SUBSCRIBED') pull(); });

  const kick = () => { window.clearTimeout(timer); timer = window.setTimeout(flush, 250); };
  store.onLocalChange = kick;
  const onOnline = () => pull();
  const onOffline = () => report();
  const onVisible = () => { if (document.visibilityState === 'visible') pull(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const retry = window.setInterval(() => { if (store.pendingCount()) flush(); }, 30000);

  pull();
  return () => {
    stopped = true;
    store.onLocalChange = null;
    window.clearTimeout(timer); window.clearInterval(retry);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    if (channel) sb.removeChannel(channel);
  };
}

export type Access = 'local' | 'loading' | 'signed-out' | 'not-member' | 'member';

export function useSync() {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access>(supabase ? 'loading' : 'local');
  const [status, setStatus] = useState<SyncStatus>('syncing');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setAccess('signed-out'); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) setAccess('signed-out'); });
    return () => data.subscription.unsubscribe();
  }, []);

  const email = session?.user.email?.toLowerCase() || '';

  // Membership check, then device ownership hand-over.
  useEffect(() => {
    if (!supabase || !email) return;
    let cancelled = false;
    setAccess('loading');
    supabase.from('members').select('email').eq('email', email).maybeSingle().then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { setError(err.message); setAccess(navigator.onLine ? 'not-member' : 'member'); return; }
      if (!data) { setAccess('not-member'); return; }
      let owner: string | null = null;
      try { owner = localStorage.getItem(OWNER_KEY); } catch { /* ignore */ }
      if (owner !== email) {
        if (owner) store.resetLocal(); // another family member used this device before
        else if (store.hasLocalData()) {
          if (confirm('This phone already has entries saved on it. Add them to the shared register?\n\nOK adds them. Cancel removes them from this phone and shows only the shared register.')) store.queueAllLocal();
          else store.resetLocal();
        }
        try { localStorage.setItem(OWNER_KEY, email); } catch { /* ignore */ }
      }
      setAccess('member');
    });
    return () => { cancelled = true; };
  }, [email]);

  useEffect(() => {
    if (!supabase || access !== 'member') return;
    return startEngine(supabase, setStatus, setError);
  }, [access]);

  const signOut = async () => {
    if (!supabase) return;
    if (store.pendingCount() && !confirm('Some changes have not reached the shared register yet and will be lost. Sign out anyway?')) return;
    await supabase.auth.signOut();
    store.resetLocal();
    try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
  };

  return { access, status, error, email, signOut };
}
