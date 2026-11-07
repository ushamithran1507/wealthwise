import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Register } from './Register';
import { Statements } from './Statements';
import { supabase, useSync, type SyncStatus } from './sync';

/** User IDs map to internal Supabase accounts; no email is ever sent to these addresses. */
const LOGIN_DOMAIN = 'wealthwise.invalid';
const idToEmail = (id: string) => id.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') + '@' + LOGIN_DOMAIN;
const displayId = (email: string) => email.endsWith('@' + LOGIN_DOMAIN) ? email.slice(0, -LOGIN_DOMAIN.length - 1) : email;

const STATUS_TEXT: Record<SyncStatus, string> = {
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes will sync when you reconnect',
  error: 'Sync problem — retrying',
};

type View = 'register' | 'statements';
const VIEW_KEY = 'wealthwise_view';

function Nav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <nav className="seg" aria-label="Sections" style={{ display: 'flex', maxWidth: 420 }}>
      {([['register', 'Register'], ['statements', 'Statements']] as const).map(([v, t]) => (
        <label key={v} className="seg-opt" style={{ flex: '1 1 0', justifyContent: 'center', minHeight: 44, fontSize: 15 }}>
          <input type="radio" name="view" checked={view === v} onChange={() => { setView(v); window.scrollTo({ top: 0 }); }} />{t}
        </label>
      ))}
    </nav>
  );
}

function Screens({ footer, shared }: { footer: ReactNode; shared: boolean }) {
  const [view, setViewState] = useState<View>(() => { try { return localStorage.getItem(VIEW_KEY) === 'statements' ? 'statements' : 'register'; } catch { return 'register'; } });
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const nav = <Nav view={view} setView={setView} />;
  return view === 'statements' ? <Statements nav={nav} footer={footer} /> : <Register nav={nav} footer={footer} shared={shared} />;
}

export function App() {
  const { access, status, error, email, signOut } = useSync();

  if (access === 'local') {
    return <Screens shared={false} footer={<span style={{ fontSize: 14 }}>Your entries are saved in this browser on this device.</span>} />;
  }
  if (access === 'loading') return <Sheet><p>Opening your register…</p></Sheet>;
  if (access === 'signed-out') return <SignIn />;
  if (access === 'not-member') {
    return (
      <Sheet>
        <h2 style={h2}>This account isn’t on the family list</h2>
        <p style={{ margin: 0 }}>You signed in as <strong>{displayId(email)}</strong>, but this register only opens for accounts its owner has added.{error ? ' (' + error + ')' : ''}</p>
        <p style={{ margin: 0 }}>Ask the owner to add this account in Supabase (SQL Editor: <code>insert into members (email) values ('{email}');</code>), then reopen the app.</p>
        <div><button className="btn btn-secondary" style={{ minHeight: 44 }} onClick={signOut}>Use a different account</button></div>
      </Sheet>
    );
  }

  return (
    <Screens
      shared
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', fontSize: 14 }}>
          <span role="status" aria-live="polite" style={{ fontWeight: 600, color: status === 'error' ? 'var(--color-accent-2-700)' : status === 'synced' ? 'var(--color-accent-700)' : 'var(--color-text)' }}>
            {STATUS_TEXT[status]}
          </span>
          <span>Shared register · signed in as {displayId(email)}. A copy is kept on this phone so it works offline.</span>
          <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={signOut}>Sign out</button>
        </div>
      }
    />
  );
}

const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600 };
const input: CSSProperties = { fontSize: 16, minHeight: 44, width: '100%', boxSizing: 'border-box' };

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontSize: 16, lineHeight: 1.45 }}>
      <div style={{ maxWidth: 440, padding: 'calc(var(--space-6) + env(safe-area-inset-top)) min(var(--space-6),6vw) 80px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700 }}>WealthWise</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px,7vw,44px)', fontWeight: 600, lineHeight: 1.05 }}>Income &amp; expense register</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignIn() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: idToEmail(userId), password });
    setBusy(false);
    if (error) setMsg(/invalid/i.test(error.message) ? 'That user ID or password is wrong.' : navigator.onLine ? error.message : 'You are offline. Connect to the internet to sign in.');
  };

  return (
    <Sheet>
      <h2 style={h2}>Sign in</h2>
      <form onSubmit={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0 }}>Everyone in the family shares one register.</p>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label htmlFor="userid" style={{ fontSize: 14 }}>User ID</label>
          <input id="userid" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={userId} onChange={e => setUserId(e.target.value)} style={input} />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label htmlFor="password" style={{ fontSize: 14 }}>Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={input} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ minHeight: 44 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {msg && <p role="alert" style={{ margin: 0, color: 'var(--color-accent-2-700)' }}>{msg}</p>}
    </Sheet>
  );
}
