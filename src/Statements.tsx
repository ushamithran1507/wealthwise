import { useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ColumnChart, Legend, LineChart, SERIES } from './Charts';
import { FREQ_LABEL, KIND_CATEGORY, KIND_LABEL, calcEmi, duesBetween, fmtCompact, loanEmi, monthlyTotals, outstandingOn, schedule, suggestions, type Due } from './finance';
import { ACC, CURRENCY, DEFAULT_PEOPLE, NEG, Page, btn, curMonth, dayMonth, fieldCol, figure, h2, input, kicker, label, money, monthName, num, rule, select, shortMonth, td, tdR, th, thR, todayISO } from './shared';
import { newId, store, type Commitment, type CommitmentKind, type Frequency, type Loan, type StoredRecord } from './store';

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };
const tableWrap: CSSProperties = { overflowX: 'auto' };
const small: CSSProperties = { fontSize: 14 };
const meta: CSSProperties = { fontSize: 13, lineHeight: 1.3 };

function Field({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  return <div className="field" style={fieldCol}><label style={label} htmlFor={id}>{text}</label>{children}</div>;
}
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-3)' };

/** Table view under a chart, for screen readers and for reading exact values. */
function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details style={small}>
      <summary style={{ cursor: 'pointer', color: ACC, minHeight: 32, display: 'flex', alignItems: 'center' }}>View as table</summary>
      <div style={tableWrap}><table className="table" style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr>{head.map((h, i) => <th key={h} style={i ? thR : th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j ? tdR : td}>{c}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  );
}

type LoanForm = { name: string; lender: string; principal: string; rate: string; tenure: string; firstEmi: string; emi: string; person: string };
const blankLoan = (person: string): LoanForm => ({ name: '', lender: '', principal: '', rate: '', tenure: '', firstEmi: todayISO(), emi: '', person });
type CommitForm = { name: string; kind: CommitmentKind; amount: string; frequency: Frequency; firstDue: string; endDate: string; reference: string; person: string };
const blankCommit = (person: string): CommitForm => ({ name: '', kind: 'insurance', amount: '', frequency: 'yearly', firstDue: todayISO(), endDate: '', reference: '', person });

export function Statements({ nav, footer }: { nav: ReactNode; footer: ReactNode }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const today = todayISO(), thisYear = today.slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [loanSel, setLoanSel] = useState<string>('');
  const [loanForm, setLoanForm] = useState<LoanForm | null>(null);
  const [loanEdit, setLoanEdit] = useState<string | null>(null);
  const [commitForm, setCommitForm] = useState<CommitForm | null>(null);
  const [commitEdit, setCommitEdit] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'loan' | 'insurance' | 'other'>('all');
  const [dueSel, setDueSel] = useState<string | null>(null);

  const people = useMemo(() => DEFAULT_PEOPLE.concat([...new Set(snap.items.filter(i => i.kind === 'person').map(i => i.name))].filter(p => !DEFAULT_PEOPLE.includes(p))), [snap.items]);
  const loans = snap.records.filter(r => r.kind === 'loan') as (StoredRecord & { data: Loan })[];
  const commits = snap.records.filter(r => r.kind === 'commitment') as (StoredRecord & { data: Commitment })[];
  const paid = useMemo(() => new Set(snap.entries.map(e => e.id)), [snap.entries]);

  const years = useMemo(() => {
    const ys = new Set([thisYear, String(+thisYear + 1)]);
    snap.entries.forEach(e => ys.add(e.date.slice(0, 4)));
    loans.forEach(l => { const s = schedule(l.data); if (s.length) { ys.add(s[0].date.slice(0, 4)); ys.add(s[s.length - 1].date.slice(0, 4)); } });
    return [...ys].sort().reverse();
  }, [snap.entries, loans, thisYear]);

  const from = year + '-01-01', to = year + '-12-31';
  const dues = useMemo(() => duesBetween(snap.records, from, to), [snap.records, from, to]);
  const in30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const upcoming = duesBetween(snap.records, today, in30).filter(d => !paid.has(d.key));
  const outstanding = loans.reduce((a, l) => a + outstandingOn(l.data, today), 0);
  const emiYear = dues.filter(d => d.kind === 'loan').reduce((a, d) => a + d.amount, 0);
  const insYear = dues.filter(d => d.kind === 'insurance').reduce((a, d) => a + d.amount, 0);

  // — loan statement —
  const activeLoan = loans.find(l => l.id === loanSel) || loans[0];
  const sched = activeLoan ? schedule(activeLoan.data) : [];
  const yearRows = sched.filter(i => i.date.slice(0, 4) === year);
  const before = sched.filter(i => i.date < from);
  const openingBal = activeLoan ? (before.length ? before[before.length - 1].balance : activeLoan.data.principal) : 0;
  const yTot = yearRows.reduce((a, i) => ({ emi: a.emi + i.emi, interest: a.interest + i.interest, principal: a.principal + i.principal }), { emi: 0, interest: 0, principal: 0 });

  // — commitments table —
  const shown = dues.filter(d => filter === 'all' || (filter === 'other' ? d.kind !== 'loan' && d.kind !== 'insurance' : d.kind === filter));
  const shownTotal = shown.reduce((a, d) => a + d.amount, 0), shownPaid = shown.filter(d => paid.has(d.key)).reduce((a, d) => a + d.amount, 0);
  const statusOf = (d: Due) => {
    if (paid.has(d.key)) return { text: 'Paid', color: ACC };
    if (d.date < today) return { text: 'Overdue', color: NEG };
    const days = Math.round((+new Date(d.date + 'T00:00:00') - +new Date(today + 'T00:00:00')) / 864e5);
    return days === 0 ? { text: 'Due today', color: NEG } : days <= 30 ? { text: `Due in ${days} day${days > 1 ? 's' : ''}`, color: 'var(--color-text)' } : { text: 'Upcoming', color: 'var(--color-text)' };
  };
  const recordPayment = (d: Due) => {
    store.putEntry({ id: d.key, type: 'expense', amount: Math.round(d.amount * 100) / 100, date: d.date, cat: KIND_CATEGORY[d.kind], person: d.person || people[0], desc: d.name + (d.kind === 'loan' ? ' EMI' : ''), created: Date.now(), updatedAt: 0 });
    setDueSel(null);
  };

  // — suggestions & graphs —
  const month = year === thisYear ? curMonth() : year + '-12';
  const tips = suggestions(snap.entries, snap.records, month, today);
  const tipSaving = tips.reduce((a, t) => a + t.saving, 0);
  const totals = monthlyTotals(snap.entries, month);
  const loanLine = Array.from({ length: 12 }, (_, m) => {
    const end = new Date(+year, m + 1, 0).toISOString().slice(0, 10);
    const ym = year + '-' + String(m + 1).padStart(2, '0');
    return { label: shortMonth(ym), full: monthName(ym), value: loans.length ? loans.reduce((a, l) => a + outstandingOn(l.data, end), 0) : null };
  });

  // — forms —
  const saveLoan = (e: FormEvent) => {
    e.preventDefault(); if (!loanForm) return;
    const principal = +loanForm.principal, rate = +loanForm.rate, tenure = Math.round(+loanForm.tenure);
    if (!(principal > 0) || !(rate >= 0) || !(tenure > 0) || !loanForm.name.trim()) return;
    const id = loanEdit || 'loan' + newId();
    store.putRecord(id, 'loan', { name: loanForm.name.trim(), lender: loanForm.lender.trim(), principal, rate, tenure, firstEmi: loanForm.firstEmi || today, emi: +loanForm.emi > 0 ? +loanForm.emi : undefined, person: loanForm.person || people[0] });
    setLoanForm(null); setLoanEdit(null); setLoanSel(id);
  };
  const saveCommit = (e: FormEvent) => {
    e.preventDefault(); if (!commitForm) return;
    const amount = +commitForm.amount;
    if (!(amount > 0) || !commitForm.name.trim()) return;
    store.putRecord(commitEdit || 'cmt' + newId(), 'commitment', { name: commitForm.name.trim(), kind: commitForm.kind, amount, frequency: commitForm.frequency, firstDue: commitForm.firstDue || today, endDate: commitForm.endDate || undefined, reference: commitForm.reference.trim() || undefined, person: commitForm.person || people[0] });
    setCommitForm(null); setCommitEdit(null);
  };
  const lf = (k: keyof LoanForm) => (e: { target: { value: string } }) => setLoanForm(f => f && { ...f, [k]: e.target.value });
  const cf = (k: keyof CommitForm) => (e: { target: { value: string } }) => setCommitForm(f => f && { ...f, [k]: e.target.value } as CommitForm);
  const previewEmi = loanForm && +loanForm.principal > 0 && +loanForm.tenure > 0 ? calcEmi(+loanForm.principal, +loanForm.rate || 0, Math.round(+loanForm.tenure)) : 0;

  return (
    <Page>
      {nav}
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700 }}>WealthWise</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px,7vw,44px)', fontWeight: 600, lineHeight: 1.05 }}>Statements</h1>
        </div>
        <div className="field" style={{ ...fieldCol, minWidth: 140 }}>
          <label style={label} htmlFor="year">Year</label>
          <select id="year" className="input" value={year} onChange={e => { setYear(e.target.value); setDueSel(null); }} style={select}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kicker}>Loans outstanding</span><span style={figure}>{money(outstanding)}</span><span style={small}>{loans.length ? `${loans.length} loan${loans.length > 1 ? 's' : ''}, as of today` : 'No loans added'}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kicker}>EMIs in {year}</span><span style={figure}>{money(emiYear)}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kicker}>Insurance in {year}</span><span style={figure}>{money(insYear)}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ ...kicker, color: upcoming.length ? NEG : undefined }}>Due in 30 days</span><span style={{ ...figure, color: upcoming.length ? NEG : undefined }}>{money(upcoming.reduce((a, d) => a + d.amount, 0))}</span><span style={small}>{upcoming.length ? upcoming.slice(0, 3).map(d => `${d.name} ${dayMonth(d.date)}`).join(' · ') : 'Nothing unpaid'}</span></div>
      </section>

      {/* — Loans — */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h2 style={h2}>Loans</h2>
          {!loanForm && <button className="btn btn-secondary" style={btn} onClick={() => { setLoanEdit(null); setLoanForm(blankLoan(people[0])); }}>Add a loan</button>}
        </div>
        {loanForm && (
          <form onSubmit={saveLoan} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 520 }}>
            <div style={grid2}>
              <Field id="l-name" text="Loan name"><input id="l-name" className="input" required value={loanForm.name} onChange={lf('name')} placeholder="e.g. Home loan" style={input} /></Field>
              <Field id="l-lender" text="Bank / lender"><input id="l-lender" className="input" value={loanForm.lender} onChange={lf('lender')} placeholder="e.g. SBI" style={input} /></Field>
              <Field id="l-principal" text={`Loan amount (${CURRENCY})`}><input id="l-principal" className="input" type="number" min="1" step="any" inputMode="decimal" required value={loanForm.principal} onChange={lf('principal')} style={input} /></Field>
              <Field id="l-rate" text="Interest (% per year)"><input id="l-rate" className="input" type="number" min="0" step="any" inputMode="decimal" required value={loanForm.rate} onChange={lf('rate')} style={input} /></Field>
              <Field id="l-tenure" text="Tenure (months)"><input id="l-tenure" className="input" type="number" min="1" step="1" inputMode="numeric" required value={loanForm.tenure} onChange={lf('tenure')} placeholder="e.g. 240" style={input} /></Field>
              <Field id="l-first" text="First EMI date"><input id="l-first" className="input" type="date" required value={loanForm.firstEmi} onChange={lf('firstEmi')} style={input} /></Field>
              <Field id="l-emi" text={`EMI (${CURRENCY}, optional)`}><input id="l-emi" className="input" type="number" min="0" step="any" inputMode="decimal" value={loanForm.emi} onChange={lf('emi')} placeholder={previewEmi ? num(previewEmi) : 'Calculated'} style={input} /></Field>
              <Field id="l-person" text="Paid by"><select id="l-person" className="input" value={loanForm.person} onChange={lf('person')} style={select}>{people.map(p => <option key={p}>{p}</option>)}</select></Field>
            </div>
            <span style={small}>{previewEmi ? `Calculated EMI: ${money(previewEmi)} a month. Enter your bank's EMI if it is different.` : 'Leave EMI empty to calculate it from the amount, interest and tenure.'}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <button className="btn btn-primary" type="submit" style={{ ...btn, flex: '1 1 auto' }}>{loanEdit ? 'Save loan' : 'Add loan'}</button>
              <button className="btn btn-ghost" type="button" style={btn} onClick={() => { setLoanForm(null); setLoanEdit(null); }}>Cancel</button>
            </div>
          </form>
        )}
        {loans.length > 0 && (
          <div style={tableWrap}><table className="table" style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Loan</th><th style={thR}>Outstanding</th><th style={thR}>EMI</th><th style={thR}>Ends</th></tr></thead>
            <tbody>{loans.map(l => {
              const s = schedule(l.data), active = activeLoan?.id === l.id;
              return (
                <tr key={l.id} onClick={() => setLoanSel(l.id)} style={{ cursor: 'pointer', background: active ? 'var(--color-accent-100)' : 'transparent' }} tabIndex={0} onKeyDown={k => { if (k.key === 'Enter') setLoanSel(l.id); }}>
                  <td style={{ ...td, verticalAlign: 'top' }}><div style={{ fontWeight: 600 }}>{l.data.name}</div><div style={meta}>{[l.data.lender, l.data.rate + '%', l.data.person].filter(Boolean).join(' · ')}</div></td>
                  <td style={{ ...tdR, verticalAlign: 'top' }}>{num(outstandingOn(l.data, today))}</td>
                  <td style={{ ...tdR, verticalAlign: 'top' }}>{num(loanEmi(l.data))}</td>
                  <td style={{ ...tdR, verticalAlign: 'top' }}>{s.length ? shortMonth(s[s.length - 1].date.slice(0, 7)) + ' ' + s[s.length - 1].date.slice(0, 4) : '—'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {!loans.length && !loanForm && <p style={{ margin: 0 }}>No loans yet. Add one to see its EMIs, interest and balance month by month.</p>}
      </section>

      {activeLoan && (
        <section style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <h2 style={h2}>Loan statement · {activeLoan.data.name} · {year}</h2>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" style={{ ...btn, fontSize: 14 }} onClick={() => { const d = activeLoan.data; setLoanEdit(activeLoan.id); setLoanForm({ name: d.name, lender: d.lender, principal: String(d.principal), rate: String(d.rate), tenure: String(d.tenure), firstEmi: d.firstEmi, emi: d.emi ? String(d.emi) : '', person: d.person }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit loan</button>
              <button className="btn btn-ghost" style={{ ...btn, fontSize: 14, color: NEG }} onClick={() => { if (confirm(`Delete ${activeLoan.data.name}? Payments already recorded in the register stay there.`)) { store.deleteRecord(activeLoan.id); setLoanSel(''); } }}>Delete</button>
            </div>
          </div>
          <div style={tableWrap}><table className="table" style={{ width: '100%', minWidth: 420, fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Month</th><th style={thR}>EMI</th><th style={thR}>Interest</th><th style={thR}>Principal</th><th style={thR}>Balance</th></tr></thead>
            <tbody>
              <tr><td style={{ ...td, fontStyle: 'italic' }}>Opening balance</td><td style={td} /><td style={td} /><td style={td} /><td style={{ ...tdR, fontWeight: 600 }}>{num(openingBal)}</td></tr>
              {yearRows.map(i => {
                const key = `pay:${activeLoan.id}:${i.date}`, isPaid = paid.has(key);
                return (
                  <tr key={i.n}>
                    <td style={td}><div>{dayMonth(i.date)}</div><div style={{ ...meta, color: isPaid ? ACC : i.date < today ? NEG : 'var(--color-text)' }}>{isPaid ? 'Paid' : i.date < today ? 'Not recorded' : 'EMI ' + i.n}</div></td>
                    <td style={tdR}>{num(i.emi)}</td><td style={tdR}>{num(i.interest)}</td><td style={tdR}>{num(i.principal)}</td><td style={{ ...tdR, fontWeight: 600 }}>{num(i.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700, ...rule }}>Total {year}</td>
              <td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yTot.emi)}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yTot.interest)}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yTot.principal)}</td>
              <td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(yearRows.length ? yearRows[yearRows.length - 1].balance : openingBal)}</td>
            </tr></tfoot>
          </table></div>
          {!yearRows.length && <p style={{ margin: 0 }}>No EMIs fall in {year} for this loan.</p>}
          <span style={small}>Interest is worked out on the reducing balance each month, so it can differ from the bank's statement by a few rupees. Record EMIs as paid under Commitments below.</span>
        </section>
      )}

      {/* — Commitments — */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h2 style={h2}>Commitments · {year}</h2>
          {!commitForm && <button className="btn btn-secondary" style={btn} onClick={() => { setCommitEdit(null); setCommitForm(blankCommit(people[0])); }}>Add insurance or other commitment</button>}
        </div>
        {commitForm && (
          <form onSubmit={saveCommit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 520 }}>
            <div style={grid2}>
              <Field id="c-name" text="Name"><input id="c-name" className="input" required value={commitForm.name} onChange={cf('name')} placeholder="e.g. LIC policy" style={input} /></Field>
              <Field id="c-kind" text="Type"><select id="c-kind" className="input" value={commitForm.kind} onChange={cf('kind')} style={select}>{(['insurance', 'fees', 'rent', 'subscription', 'tax', 'other'] as CommitmentKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
              <Field id="c-amount" text={`Amount (${CURRENCY})`}><input id="c-amount" className="input" type="number" min="1" step="any" inputMode="decimal" required value={commitForm.amount} onChange={cf('amount')} style={input} /></Field>
              <Field id="c-freq" text="How often"><select id="c-freq" className="input" value={commitForm.frequency} onChange={cf('frequency')} style={select}>{(Object.keys(FREQ_LABEL) as Frequency[]).map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}</select></Field>
              <Field id="c-first" text="Next due date"><input id="c-first" className="input" type="date" required value={commitForm.firstDue} onChange={cf('firstDue')} style={input} /></Field>
              <Field id="c-end" text="Ends on (optional)"><input id="c-end" className="input" type="date" value={commitForm.endDate} onChange={cf('endDate')} style={input} /></Field>
              <Field id="c-ref" text="Policy / reference no."><input id="c-ref" className="input" value={commitForm.reference} onChange={cf('reference')} placeholder="Optional" style={input} /></Field>
              <Field id="c-person" text="Paid by"><select id="c-person" className="input" value={commitForm.person} onChange={cf('person')} style={select}>{people.map(p => <option key={p}>{p}</option>)}</select></Field>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <button className="btn btn-primary" type="submit" style={{ ...btn, flex: '1 1 auto' }}>{commitEdit ? 'Save commitment' : 'Add commitment'}</button>
              <button className="btn btn-ghost" type="button" style={btn} onClick={() => { setCommitForm(null); setCommitEdit(null); }}>Cancel</button>
            </div>
          </form>
        )}
        <div className="seg" style={{ display: 'flex', maxWidth: 520 }} role="radiogroup" aria-label="Show">
          {([['all', 'All'], ['loan', 'Loan EMIs'], ['insurance', 'Insurance'], ['other', 'Other']] as const).map(([v, t]) => (
            <label key={v} className="seg-opt" style={{ flex: '1 1 0', justifyContent: 'center', minHeight: 44, fontSize: 15 }}><input type="radio" name="cfilter" checked={filter === v} onChange={() => { setFilter(v); setDueSel(null); }} />{t}</label>
          ))}
        </div>
        <div style={tableWrap}><table className="table" style={{ width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <colgroup><col style={{ width: '24%' }} /><col style={{ width: 'auto' }} /><col style={{ width: '24%' }} /></colgroup>
          <thead><tr><th style={th}>Due</th><th style={th}>Commitment</th><th style={thR}>Amount</th></tr></thead>
          <tbody>{shown.map(d => {
            const st = statusOf(d), open = dueSel === d.key, isPaid = paid.has(d.key);
            return [
              <tr key={d.key} onClick={() => setDueSel(open ? null : d.key)} style={{ cursor: 'pointer', background: open ? 'var(--color-accent-100)' : 'transparent' }} tabIndex={0} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setDueSel(open ? null : d.key); } }} aria-expanded={open}>
                <td style={{ ...td, verticalAlign: 'top' }}><div>{dayMonth(d.date)}</div><div style={{ ...meta, color: st.color, fontWeight: st.color === NEG ? 600 : 400 }}>{st.text}</div></td>
                <td style={{ ...td, verticalAlign: 'top', overflowWrap: 'anywhere' }}><div style={{ fontWeight: 600 }}>{d.name}</div><div style={meta}>{KIND_LABEL[d.kind]} · {d.detail}</div></td>
                <td style={{ ...tdR, verticalAlign: 'top' }}>{num(d.amount)}</td>
              </tr>,
              open && (
                <tr key={d.key + '-a'} style={{ background: 'var(--color-accent-100)' }}><td colSpan={3} style={{ padding: '4px 4px 10px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {isPaid
                      ? <button className="btn btn-secondary" style={{ ...btn, fontSize: 14 }} onClick={() => { store.deleteEntry(d.key); setDueSel(null); }}>Undo payment</button>
                      : <button className="btn btn-primary" style={{ ...btn, fontSize: 14 }} onClick={() => recordPayment(d)}>Mark paid</button>}
                    {d.kind !== 'loan' && <button className="btn btn-secondary" style={{ ...btn, fontSize: 14 }} onClick={() => { const r = commits.find(c => c.id === d.recordId); if (!r) return; const c = r.data; setCommitEdit(r.id); setCommitForm({ name: c.name, kind: c.kind, amount: String(c.amount), frequency: c.frequency, firstDue: c.firstDue, endDate: c.endDate || '', reference: c.reference || '', person: c.person }); }}>Edit</button>}
                    {d.kind !== 'loan' && <button className="btn btn-ghost" style={{ ...btn, fontSize: 14, color: NEG }} onClick={() => { if (confirm(`Delete ${d.name} and all its due dates?`)) { store.deleteRecord(d.recordId); setDueSel(null); } }}>Delete</button>}
                    <span style={meta}>{isPaid ? 'Recorded in the register.' : `Mark paid adds a ${KIND_CATEGORY[d.kind]} expense of ${money(d.amount)} to the register.`}</span>
                  </div>
                </td></tr>
              ),
            ];
          })}</tbody>
          <tfoot>
            <tr><td colSpan={2} style={{ ...td, fontWeight: 700, ...rule }}>Total {year}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(shownTotal)}</td></tr>
            <tr><td colSpan={2} style={td}>Paid</td><td style={{ ...tdR, color: ACC }}>{num(shownPaid)}</td></tr>
            <tr><td colSpan={2} style={{ ...td, fontWeight: 700 }}>Still to pay</td><td style={{ ...tdR, fontWeight: 700 }}>{num(shownTotal - shownPaid)}</td></tr>
          </tfoot>
        </table></div>
        {!shown.length && <p style={{ margin: 0 }}>No commitments in {year}{filter !== 'all' ? ' for this filter' : ''}. Add loans, insurance premiums, school fees and other regular payments to see every due date here.</p>}
      </section>

      {/* — Suggestions — */}
      <section style={sectionStyle}>
        <h2 style={h2}>Where to cut costs · {monthName(month)}</h2>
        {tips.length ? (
          <div style={tableWrap}><table className="table" style={{ width: '100%', minWidth: 560, fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Area</th><th style={thR}>This month</th><th style={thR}>Usual / guide</th><th style={thR}>Could save / month</th><th style={th}>Suggestion</th></tr></thead>
            <tbody>{tips.map(t => (
              <tr key={t.area}>
                <td style={{ ...td, fontWeight: 600, verticalAlign: 'top' }}>{t.area}</td>
                <td style={{ ...tdR, verticalAlign: 'top' }}>{t.spent === null ? '—' : num(t.spent)}</td>
                <td style={{ ...tdR, verticalAlign: 'top', fontSize: 14 }}>{t.usual || '—'}</td>
                <td style={{ ...tdR, verticalAlign: 'top', fontWeight: 600, color: t.saving ? ACC : undefined }}>{t.saving ? num(t.saving) : '—'}</td>
                <td style={{ ...td, verticalAlign: 'top', fontSize: 14, minWidth: 220 }}>{t.remark}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td colSpan={3} style={{ ...td, fontWeight: 700, ...rule }}>Possible saving</td>
              <td style={{ ...tdR, fontWeight: 700, ...rule, color: ACC }}>{num(tipSaving)}</td>
              <td style={{ ...td, fontWeight: 700, ...rule }}>{money(tipSaving * 12)} a year</td>
            </tr></tfoot>
          </table></div>
        ) : <p style={{ margin: 0 }}>No suggestions for {monthName(month)} yet. They appear once this month has income and expense entries, and get sharper with a few months of history.</p>}
        <span style={small}>Worked out from your own entries with simple budgeting rules: each category against your last 3 months and a common share-of-income guide, EMIs against 40% of income, and a 20% saving target. It is a guide, not financial advice.</span>
      </section>

      {/* — Graphs — */}
      <section style={sectionStyle}>
        <h2 style={h2}>Progress</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Income, expenses and savings · last 12 months</h3>
          <Legend items={[{ label: 'Income', color: SERIES.income }, { label: 'Expenses', color: SERIES.expense }, { label: 'Saved & invested', color: SERIES.invested }]} />
          <ColumnChart title="Monthly income, expenses and savings" series={[{ label: 'Income', color: SERIES.income }, { label: 'Expenses', color: SERIES.expense }, { label: 'Saved & invested', color: SERIES.invested }]}
            data={totals.map(t => ({ label: shortMonth(t.month), full: monthName(t.month), values: [t.income, t.expense, t.invested] }))} />
          <TableView head={['Month', 'Income', 'Expenses', 'Saved & invested']} rows={totals.map(t => [monthName(t.month), num(t.income), num(t.expense), num(t.invested)])} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Saving rate · share of income saved or invested</h3>
          <LineChart title="Saving rate by month" color={SERIES.invested} format={v => Math.round(v) + '%'} target={20} targetLabel="20% target"
            data={totals.map(t => ({ label: shortMonth(t.month), full: monthName(t.month), value: t.rate }))} />
          <TableView head={['Month', 'Saving rate']} rows={totals.map(t => [monthName(t.month), t.rate === null ? '—' : t.rate.toFixed(1) + '%'])} />
        </div>
        {loans.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Loans outstanding · end of each month, {year}</h3>
            <LineChart title={`Total loan balance through ${year}`} color={SERIES.income} format={v => CURRENCY + fmtCompact(v)} data={loanLine} />
            <TableView head={['Month', 'Outstanding']} rows={loanLine.map(p => [p.full, p.value === null ? '—' : num(p.value)])} />
          </div>
        )}
      </section>

      <footer style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>{footer}</footer>
    </Page>
  );
}

