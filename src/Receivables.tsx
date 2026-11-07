import { useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { FREQ_LABEL, RECV_CATEGORY, RECV_LABEL, expectedBetween, stillToReceive, type Expected } from './finance';
import { ACC, CURRENCY, DEFAULT_PEOPLE, NEG, Page, btn, dayMonth, fieldCol, figure, h2, input, kicker, label, money, num, rule, select, td, tdR, th, thR, todayISO } from './shared';
import { newId, store, type Frequency, type Receivable, type ReceivableKind, type StoredRecord } from './store';

const small: CSSProperties = { fontSize: 14 };
const meta: CSSProperties = { fontSize: 13, lineHeight: 1.3 };
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-3)' };
const KINDS: ReceivableKind[] = ['rent', 'claim', 'refund', 'lent', 'maturity', 'other'];

function Field({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  return <div className="field" style={fieldCol}><label style={label} htmlFor={id}>{text}</label>{children}</div>;
}

type Form = { name: string; kind: ReceivableKind; amount: string; frequency: Frequency; firstDue: string; endDate: string; from: string; reference: string; person: string };
const blank = (person: string): Form => ({ name: '', kind: 'rent', amount: '', frequency: 'monthly', firstDue: todayISO(), endDate: '', from: '', reference: '', person });
const NAME_HINT: Record<ReceivableKind, string> = { rent: 'e.g. Flat 2B rent', claim: 'e.g. Star Health claim', refund: 'e.g. Income tax refund', lent: 'e.g. Loan to Ravi', maturity: 'e.g. FD maturity', other: 'e.g. Bonus due' };
const FROM_HINT: Record<ReceivableKind, string> = { rent: 'Tenant name', claim: 'Insurer', refund: 'e.g. Income Tax Dept', lent: 'Person', maturity: 'Bank', other: 'Who pays' };

export function Receivables({ nav, footer }: { nav: ReactNode; footer: ReactNode }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const today = todayISO(), thisYear = today.slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [form, setForm] = useState<Form | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [got, setGot] = useState<{ amount: string; date: string }>({ amount: '', date: today });
  const [show, setShow] = useState<'pending' | 'all'>('pending');

  const people = useMemo(() => DEFAULT_PEOPLE.concat([...new Set(snap.items.filter(i => i.kind === 'person').map(i => i.name))].filter(p => !DEFAULT_PEOPLE.includes(p))), [snap.items]);
  const recs = snap.records.filter(r => r.kind === 'receivable') as (StoredRecord & { data: Receivable })[];
  const receipts = useMemo(() => new Map(snap.entries.filter(e => e.id.startsWith('recv:')).map(e => [e.id, e])), [snap.entries]);
  const receivedKeys = useMemo(() => new Set(receipts.keys()), [receipts]);

  const from = year + '-01-01', to = year + '-12-31';
  const yearItems = useMemo(() => expectedBetween(snap.records, from, to), [snap.records, from, to]);
  const in30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const pendingNow = stillToReceive(snap.records, receivedKeys, in30, today);
  const yearExpected = yearItems.reduce((a, x) => a + x.amount, 0);
  const yearReceived = yearItems.reduce((a, x) => a + (receipts.get(x.key)?.amount ?? 0), 0);
  const yearPending = yearItems.filter(x => !receivedKeys.has(x.key)).reduce((a, x) => a + x.amount, 0);
  const years = useMemo(() => {
    const ys = new Set([thisYear, String(+thisYear + 1)]);
    recs.forEach(r => ys.add(r.data.firstDue.slice(0, 4)));
    return [...ys].sort().reverse();
  }, [recs, thisYear]);

  // Overdue items from earlier years stay visible in the current year's list until received.
  const carried = year === thisYear ? expectedBetween(snap.records, '1900-01-01', (+year - 1) + '-12-31').filter(x => !receivedKeys.has(x.key)) : [];
  const rows = [...carried, ...yearItems].filter(x => show === 'all' || !receivedKeys.has(x.key));

  const statusOf = (x: Expected) => {
    const r = receipts.get(x.key);
    if (r) return { text: r.amount < x.amount ? `Received ${money(r.amount)} of ${money(x.amount)}` : 'Received', color: ACC };
    if (x.date < today) { const days = Math.round((+new Date(today + 'T00:00:00') - +new Date(x.date + 'T00:00:00')) / 864e5); return { text: `Overdue ${days} day${days > 1 ? 's' : ''}`, color: NEG }; }
    const days = Math.round((+new Date(x.date + 'T00:00:00') - +new Date(today + 'T00:00:00')) / 864e5);
    return days === 0 ? { text: 'Expected today', color: 'var(--color-text)' } : days <= 30 ? { text: `In ${days} day${days > 1 ? 's' : ''}`, color: 'var(--color-text)' } : { text: 'Expected', color: 'var(--color-text)' };
  };

  const open = (x: Expected) => {
    if (sel === x.key) { setSel(null); return; }
    setSel(x.key);
    setGot({ amount: String(Math.round(x.amount * 100) / 100), date: x.date <= today ? today : x.date });
  };
  const markReceived = (x: Expected) => {
    const amount = +got.amount; if (!(amount > 0)) return;
    store.putEntry({ id: x.key, type: 'income', amount, date: got.date || today, cat: RECV_CATEGORY[x.kind], person: x.person || people[0], desc: x.name + (x.from ? ' · ' + x.from : ''), created: Date.now(), updatedAt: 0 });
    setSel(null);
  };

  const save = (e: FormEvent) => {
    e.preventDefault(); if (!form) return;
    const amount = +form.amount;
    if (!(amount > 0) || !form.name.trim()) return;
    store.putRecord(editId || 'rcv' + newId(), 'receivable', { name: form.name.trim(), kind: form.kind, amount, frequency: form.frequency, firstDue: form.firstDue || today, endDate: form.endDate || undefined, from: form.from.trim(), reference: form.reference.trim() || undefined, person: form.person || people[0] });
    setForm(null); setEditId(null);
  };
  const ff = (k: keyof Form) => (e: { target: { value: string } }) => setForm(f => f && { ...f, [k]: e.target.value } as Form);

  // By-type summary for the selected year
  const byKind = KINDS.map(k => {
    const its = yearItems.filter(x => x.kind === k);
    const exp = its.reduce((a, x) => a + x.amount, 0), rec = its.reduce((a, x) => a + (receipts.get(x.key)?.amount ?? 0), 0);
    return { k, exp, rec, pending: its.filter(x => !receivedKeys.has(x.key)).reduce((a, x) => a + x.amount, 0) };
  }).filter(r => r.exp > 0);

  return (
    <Page>
      {nav}
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700 }}>WealthWise</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px,7vw,44px)', fontWeight: 600, lineHeight: 1.05 }}>Amounts to receive</h1>
        </div>
        <div className="field" style={{ ...fieldCol, minWidth: 140 }}>
          <label style={label} htmlFor="r-year">Year</label>
          <select id="r-year" className="input" value={year} onChange={e => { setYear(e.target.value); setSel(null); }} style={select}>{years.map(y => <option key={y}>{y}</option>)}</select>
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ ...kicker, color: ACC }}>Yet to receive</span><span style={{ ...figure, color: ACC }}>{money(pendingNow.total)}</span><span style={small}>Due up to {dayMonth(in30)}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ ...kicker, color: pendingNow.overdue.length ? NEG : undefined }}>Overdue</span><span style={{ ...figure, color: pendingNow.overdue.length ? NEG : undefined }}>{money(pendingNow.overdueTotal)}</span><span style={small}>{pendingNow.overdue.length ? `${pendingNow.overdue.length} item${pendingNow.overdue.length > 1 ? 's' : ''} past the expected date` : 'Nothing overdue'}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kicker}>Expected in {year}</span><span style={figure}>{money(yearExpected)}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kicker}>Received in {year}</span><span style={figure}>{money(yearReceived)}</span><span style={small}>{money(yearPending)} still to come</span></div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h2 style={h2}>{form ? (editId ? 'Edit amount to receive' : 'Add amount to receive') : 'Expected receipts'}</h2>
          {!form && <button className="btn btn-primary" style={btn} onClick={() => { setEditId(null); setForm(blank(people[0])); }}>Add amount to receive</button>}
        </div>
        {form && (
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 520 }}>
            <Field id="r-kind" text="Type"><select id="r-kind" className="input" value={form.kind} onChange={ff('kind')} style={select}>{KINDS.map(k => <option key={k} value={k}>{RECV_LABEL[k]}</option>)}</select></Field>
            <div style={grid2}>
              <Field id="r-name" text="Description"><input id="r-name" className="input" required value={form.name} onChange={ff('name')} placeholder={NAME_HINT[form.kind]} style={input} /></Field>
              <Field id="r-from" text="From"><input id="r-from" className="input" value={form.from} onChange={ff('from')} placeholder={FROM_HINT[form.kind]} style={input} /></Field>
              <Field id="r-amount" text={`Amount (${CURRENCY})`}><input id="r-amount" className="input" type="number" min="1" step="any" inputMode="decimal" required value={form.amount} onChange={ff('amount')} style={input} /></Field>
              <Field id="r-freq" text="How often"><select id="r-freq" className="input" value={form.frequency} onChange={ff('frequency')} style={select}>{(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}</select></Field>
              <Field id="r-first" text={form.frequency === 'once' ? 'Expected on' : 'First expected on'}><input id="r-first" className="input" type="date" required value={form.firstDue} onChange={ff('firstDue')} style={input} /></Field>
              <Field id="r-end" text="Ends on (optional)"><input id="r-end" className="input" type="date" value={form.endDate} onChange={ff('endDate')} disabled={form.frequency === 'once'} style={input} /></Field>
              <Field id="r-ref" text="Claim / reference no."><input id="r-ref" className="input" value={form.reference} onChange={ff('reference')} placeholder="Optional" style={input} /></Field>
              <Field id="r-person" text="Received by"><select id="r-person" className="input" value={form.person} onChange={ff('person')} style={select}>{people.map(p => <option key={p}>{p}</option>)}</select></Field>
            </div>
            <span style={small}>When it arrives, mark it received: it is added to the register as {RECV_CATEGORY[form.kind]} income.</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <button className="btn btn-primary" type="submit" style={{ ...btn, flex: '1 1 auto' }}>{editId ? 'Save' : 'Add'}</button>
              <button className="btn btn-ghost" type="button" style={btn} onClick={() => { setForm(null); setEditId(null); }}>Cancel</button>
            </div>
          </form>
        )}

        <div className="seg" style={{ display: 'flex', maxWidth: 360 }} role="radiogroup" aria-label="Show">
          {([['pending', 'Still to come'], ['all', 'All in ' + year]] as const).map(([v, t]) => (
            <label key={v} className="seg-opt" style={{ flex: '1 1 0', justifyContent: 'center', minHeight: 44, fontSize: 15 }}><input type="radio" name="rshow" checked={show === v} onChange={() => { setShow(v); setSel(null); }} />{t}</label>
          ))}
        </div>

        <table className="table" style={{ width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <colgroup><col style={{ width: '27%' }} /><col style={{ width: 'auto' }} /><col style={{ width: '24%' }} /></colgroup>
          <thead><tr><th style={th}>Expected</th><th style={th}>Item</th><th style={thR}>Amount</th></tr></thead>
          <tbody>{rows.map(x => {
            const st = statusOf(x), isOpen = sel === x.key, rec = receipts.get(x.key);
            return [
              <tr key={x.key} onClick={() => open(x)} style={{ cursor: 'pointer', background: isOpen ? 'var(--color-accent-100)' : 'transparent' }} tabIndex={0} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); open(x); } }} aria-expanded={isOpen}>
                <td style={{ ...td, verticalAlign: 'top' }}><div>{dayMonth(x.date)}{x.date.slice(0, 4) !== year ? ' ' + x.date.slice(0, 4) : ''}</div><div style={{ ...meta, color: st.color, fontWeight: st.color === NEG ? 600 : 400 }}>{st.text}</div></td>
                <td style={{ ...td, verticalAlign: 'top', overflowWrap: 'anywhere' }}><div style={{ fontWeight: 600 }}>{x.name}</div><div style={meta}>{RECV_LABEL[x.kind]}{x.detail ? ' · ' + x.detail : ''}</div></td>
                <td style={{ ...tdR, verticalAlign: 'top', color: rec ? ACC : undefined }}>{num(rec ? rec.amount : x.amount)}</td>
              </tr>,
              isOpen && (
                <tr key={x.key + '-a'} style={{ background: 'var(--color-accent-100)' }}><td colSpan={3} style={{ padding: '4px 4px 12px' }}>
                  {rec ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <span style={meta}>Received {money(rec.amount)} on {dayMonth(rec.date)}, recorded in the register as {rec.cat}.</span>
                      <button className="btn btn-secondary" style={{ ...btn, fontSize: 14 }} onClick={() => { store.deleteEntry(x.key); setSel(null); }}>Undo receipt</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={grid2}>
                        <Field id="g-amt" text={`Amount received (${CURRENCY})`}><input id="g-amt" className="input" type="number" min="1" step="any" inputMode="decimal" value={got.amount} onChange={e => setGot(g => ({ ...g, amount: e.target.value }))} style={input} /></Field>
                        <Field id="g-date" text="Received on"><input id="g-date" className="input" type="date" value={got.date} onChange={e => setGot(g => ({ ...g, date: e.target.value }))} style={input} /></Field>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <button className="btn btn-primary" style={{ ...btn, fontSize: 14 }} onClick={() => markReceived(x)}>Mark received</button>
                        <button className="btn btn-secondary" style={{ ...btn, fontSize: 14 }} onClick={() => { const r = recs.find(c => c.id === x.recordId); if (!r) return; const v = r.data; setEditId(r.id); setForm({ name: v.name, kind: v.kind, amount: String(v.amount), frequency: v.frequency, firstDue: v.firstDue, endDate: v.endDate || '', from: v.from, reference: v.reference || '', person: v.person }); setSel(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                        <button className="btn btn-ghost" style={{ ...btn, fontSize: 14, color: NEG }} onClick={() => { if (confirm(`Delete ${x.name}${x.date ? ' and all its expected dates' : ''}? Amounts already received stay in the register.`)) { store.deleteRecord(x.recordId); setSel(null); } }}>Delete</button>
                      </div>
                      <span style={meta}>Adds {RECV_CATEGORY[x.kind]} income to the register. Change the amount if less was paid (for example a partly settled claim).</span>
                    </div>
                  )}
                </td></tr>
              ),
            ];
          })}</tbody>
          <tfoot>
            <tr><td colSpan={2} style={{ ...td, fontWeight: 700, ...rule }}>Expected in {year}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yearExpected)}</td></tr>
            <tr><td colSpan={2} style={td}>Received</td><td style={{ ...tdR, color: ACC }}>{num(yearReceived)}</td></tr>
            <tr><td colSpan={2} style={{ ...td, fontWeight: 700 }}>Still to come</td><td style={{ ...tdR, fontWeight: 700 }}>{num(yearPending)}</td></tr>
          </tfoot>
        </table>
        {!rows.length && <p style={{ margin: 0 }}>{recs.length ? (show === 'pending' ? 'Everything expected has been received.' : `Nothing expected in ${year}.`) : 'Nothing added yet. Add rent you collect, insurance or medical claims, refunds, money you have lent, or deposits maturing.'}</p>}
      </section>

      {byKind.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 640 }}>
          <h2 style={h2}>By type · {year}</h2>
          <table className="table" style={{ width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Type</th><th style={thR}>Expected</th><th style={thR}>Received</th><th style={thR}>To come</th></tr></thead>
            <tbody>{byKind.map(r => <tr key={r.k}><td style={{ ...td, fontWeight: 600, overflowWrap: 'anywhere' }}>{RECV_LABEL[r.k]}</td><td style={tdR}>{num(r.exp)}</td><td style={{ ...tdR, color: ACC }}>{num(r.rec)}</td><td style={tdR}>{num(r.pending)}</td></tr>)}</tbody>
            <tfoot><tr><td style={{ ...td, fontWeight: 700, ...rule }}>Total</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yearExpected)}</td><td style={{ ...tdR, fontWeight: 700, ...rule, color: ACC }}>{num(yearReceived)}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yearPending)}</td></tr></tfoot>
          </table>
        </section>
      )}

      <footer style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>{footer}</footer>
    </Page>
  );
}
