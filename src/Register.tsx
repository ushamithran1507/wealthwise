import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { fromLegacy, newId, store, TYPES, type EType, type Entry } from './store';

const CURRENCY = '₹';
const DEFAULT_CATS: Record<EType, string[]> = {
  income: ['Salary', 'Business', 'Freelance', 'Rent received', 'Interest & dividends', 'Other income'],
  expense: ['Food & groceries', 'Rent', 'Shopping', 'Fees', 'Medical', 'Debt / EMI', 'Bills & utilities', 'Transport', 'Other expense'],
  investment: ['Savings deposit', 'SIP / mutual fund', 'Fixed deposit', 'PPF / EPF', 'Shares', 'Gold', 'Other investment'],
};
const DEFAULT_PEOPLE = ['USHA', 'Venkat', 'Mithu'];
const TYPE_LABEL: Record<EType, string> = { income: 'Income', expense: 'Expense', investment: 'Investment' };

const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const curMonth = () => todayISO().slice(0, 7);
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

type Form = { type: EType; amount: string; date: string; cat: string; desc: string; newCat: string; person: string; newPerson: string };
const blankForm = (type: EType = 'expense', person = ''): Form => ({ type, amount: '', date: todayISO(), cat: '', desc: '', newCat: '', person, newPerson: '' });

const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const money = (n: number) => (n < 0 ? '−' : '') + CURRENCY + num(Math.abs(n));
const cell = (n: number) => (n < 0 ? '−' : '') + num(Math.abs(n));
const sumOf = (arr: Entry[]) => arr.reduce((a, e) => a + (+e.amount || 0), 0);
const flow = (e: Entry) => (e.type === 'income' ? +e.amount : -+e.amount);

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// — shared inline styles (as in the design) —
const NEG = 'var(--color-accent-2-700)';
const ACC = 'var(--color-accent-700)';
const kicker: CSSProperties = { fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 };
const figure: CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 'clamp(24px,6.5vw,34px)', fontWeight: 700 };
const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600 };
const fieldCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 };
const label: CSSProperties = { fontSize: 14 };
const input: CSSProperties = { fontSize: 16, minHeight: 44, width: '100%', boxSizing: 'border-box' };
const th: CSSProperties = { padding: '8px 4px', fontSize: 14 };
const thR: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '8px 4px' };
const tdR: CSSProperties = { ...td, textAlign: 'right' };
const rule: CSSProperties = { borderTop: '2px solid var(--color-text)' };
const sub: CSSProperties = { padding: '6px 4px 6px var(--space-4)' };
const subR: CSSProperties = { padding: '6px 4px', textAlign: 'right' };
const btn: CSSProperties = { minHeight: 44 };

export function Register({ footer, shared = false }: { footer: ReactNode; shared?: boolean }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [month, setMonth] = useState(curMonth());
  const [form, setForm] = useState<Form>(blankForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const catsFor = (type: EType) => {
    const extra = snap.items.filter(i => i.kind === 'cat' && i.type === type).map(i => i.name).filter(c => !DEFAULT_CATS[type].includes(c));
    return DEFAULT_CATS[type].concat([...new Set(extra)]);
  };
  const plist = useMemo(() => DEFAULT_PEOPLE.concat([...new Set(snap.items.filter(i => i.kind === 'person').map(i => i.name))].filter(p => !DEFAULT_PEOPLE.includes(p))), [snap.items]);

  const all = month === 'all';
  const sorted = useMemo(() => snap.entries.slice().sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created), [snap.entries]);
  const months = new Set(sorted.map(e => e.date.slice(0, 7))); months.add(curMonth());
  const monthOpts = [...months].sort().reverse().map(v => ({ v, label: monthName(v) })).concat({ v: 'all', label: 'All months' });
  const view = all ? sorted : sorted.filter(e => e.date.slice(0, 7) === month);
  const opening = all ? 0 : sorted.filter(e => e.date.slice(0, 7) < month).reduce((a, e) => a + flow(e), 0);
  const monthLabel = all ? 'All months' : monthName(month);

  const inc = sumOf(view.filter(e => e.type === 'income')), exp = sumOf(view.filter(e => e.type === 'expense')), inv = sumOf(view.filter(e => e.type === 'investment'));
  const out = exp + inv, net = inc - out, closing = opening + net;
  const pct = (v: number) => (inc ? (v / inc * 100).toFixed(1) + '%' : '—');
  const byCat = (type: EType) => {
    const m: Record<string, number> = {};
    view.filter(e => e.type === type).forEach(e => { m[e.cat] = (m[e.cat] || 0) + +e.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, amt: num(v), pct: pct(v) }));
  };
  const balColor = closing < 0 ? NEG : 'var(--color-text)';

  const type = form.type, cats = catsFor(type);
  const catVal = form.cat === '__new' || cats.includes(form.cat) ? form.cat : cats[0];
  const personVal = form.person === '__new' || plist.includes(form.person) ? form.person : plist[0];
  const extraPeople = [...new Set(view.map(e => e.person).filter(p => p && !plist.includes(p)))];
  const people = plist.concat(extraPeople).map(name => {
    const pe = view.filter(e => e.person === name), by = (t: EType) => sumOf(pe.filter(e => e.type === t));
    return { name, inc: num(by('income')), exp: num(by('expense')), inv: num(by('investment')) };
  });

  let running = opening;
  const rows = view.map(e => { running += flow(e); return { e, bal: running }; });

  const scrollToForm = () => { const el = formRef.current; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' }); };
  const onForm = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { const { name, value } = ev.target; setForm(f => ({ ...f, cat: catVal, person: personVal, [name]: value })); };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const amount = +form.amount; if (!(amount > 0)) return;
    let cat = catVal;
    if (cat === '__new') { cat = form.newCat.trim(); if (!cat) return; if (!cats.includes(cat)) store.addItem('cat', type, cat); }
    let person = personVal;
    if (person === '__new') { person = form.newPerson.trim(); if (!person) return; if (!plist.includes(person)) store.addItem('person', '', person); }
    const prev = editId ? snap.entries.find(x => x.id === editId) : undefined;
    const entry: Entry = { id: editId || newId(), type, amount, date: form.date || todayISO(), cat, person, desc: form.desc.trim(), created: prev?.created || Date.now(), updatedAt: 0, createdByEmail: prev?.createdByEmail };
    store.putEntry(entry);
    setEditId(null);
    setForm({ ...blankForm(type, person), date: form.date || todayISO(), cat });
    if (!all) setMonth(entry.date.slice(0, 7));
  };

  const startEdit = (ev: MouseEvent, e: Entry) => {
    ev.stopPropagation();
    setEditId(e.id); setSel(null);
    setForm({ type: e.type, amount: String(e.amount), date: e.date, cat: e.cat, desc: e.desc || '', newCat: '', person: e.person || '', newPerson: '' });
    requestAnimationFrame(scrollToForm);
  };
  const del = (ev: MouseEvent, e: Entry) => {
    ev.stopPropagation();
    if (!confirm('Delete this entry?')) return;
    store.deleteEntry(e.id); setSel(null);
    if (editId === e.id) setEditId(null);
  };

  const exportCsv = () => {
    const q = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
    let b = opening;
    const lines = [['Date', 'Type', 'Category', 'Person', 'Description', 'Income', 'Expense', 'Balance'].join(',')];
    if (!all) lines.push(['', '', '', '', 'Opening balance', '', '', opening].map(q).join(','));
    view.forEach(e => { b += flow(e); lines.push([e.date, TYPE_LABEL[e.type], e.cat, e.person || '', e.desc, e.type === 'income' ? e.amount : '', e.type !== 'income' ? e.amount : '', b].map(q).join(',')); });
    lines.push(['', '', '', '', 'Total', inc, out, closing].map(q).join(','));
    lines.push(['', '', '', '', 'Saved & invested', '', inv, ''].map(q).join(','));
    download('wealthwise-register-' + (all ? 'all' : month) + '.csv', new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  };
  const exportJson = () => download('wealthwise-backup.json', new Blob([JSON.stringify(store.exportLegacy(), null, 2)], { type: 'application/json' }));
  const importJson = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return;
    file.text().then(t => {
      try {
        const d = JSON.parse(t);
        if (!Array.isArray(d.entries)) throw new Error('bad');
        if (confirm('Replace ' + (shared ? 'the shared register' : 'your entries') + ' with this backup (' + d.entries.length + ' entries)?' + (shared ? ' Everyone in the family will see the change.' : ''))) { store.replaceAll(fromLegacy(d)); setSel(null); setEditId(null); }
      } catch { alert('That file isn’t a WealthWise backup.'); }
    });
  };
  const clearAll = () => {
    if (confirm('Delete every entry and custom category' + (shared ? ' from the shared register, on every phone' : '') + '? Download a backup first if you may need them.')) { store.replaceAll({ entries: {}, items: {} }); setSel(null); setEditId(null); setForm(blankForm()); }
  };

  const personLabel = type === 'income' ? 'Received by' : type === 'investment' ? 'Invested by' : 'Expense incurred by';
  const descHint = type === 'income' ? 'e.g. November salary' : type === 'investment' ? 'e.g. Monthly SIP' : 'e.g. School term fees';
  const typeHint = type === 'investment' ? 'Investments sit in the Expense column of the register, but are counted at the top as money saved.' : type === 'income' ? 'Income goes in the Income column and raises the balance.' : 'Expenses go in the Expense column and reduce the balance.';

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.45 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'calc(var(--space-4) + env(safe-area-inset-top)) min(var(--space-6),4vw) 80px', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700 }}>WealthWise</span>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px,7vw,44px)', fontWeight: 600, lineHeight: 1.05 }}>Income &amp; expense register</h1>
          </div>
          <div className="field" style={{ ...fieldCol, minWidth: 160 }}>
            <label style={label} htmlFor="month">Showing</label>
            <select id="month" className="input" value={month} onChange={e => { setMonth(e.target.value); setSel(null); }} style={{ fontSize: 16, minHeight: 44 }}>
              {monthOpts.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </div>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={kicker}>Income received</span>
            <span style={figure}>{money(inc)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={kicker}>Expenses</span>
            <span style={figure}>{money(exp)}</span>
            <span style={{ fontSize: 14 }}>{inc ? pct(exp) + ' of income' : ''}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ ...kicker, color: ACC }}>Saved &amp; invested</span>
            <span style={{ ...figure, color: ACC }}>{money(inv)}</span>
            <span style={{ fontSize: 14 }}>{inc ? pct(inv) + ' of income' : 'Investments are listed as outflows'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={kicker}>Balance</span>
            <span style={{ ...figure, color: balColor }}>{money(closing)}</span>
            <span style={{ fontSize: 14 }}>{all || !opening ? 'Income − expenses − investments' : 'Includes ' + money(opening) + ' brought forward'}</span>
          </div>
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)', alignItems: 'flex-start' }}>
          <form ref={formRef} onSubmit={submit} style={{ flex: '1 1 300px', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <h2 style={h2}>{editId ? 'Edit entry' : 'Add entry'}</h2>
            <div className="seg" style={{ display: 'flex' }} role="radiogroup" aria-label="Entry type">
              {TYPES.map(v => (
                <label key={v} className="seg-opt" style={{ flex: '1 1 0', justifyContent: 'center', minHeight: 44, fontSize: 15 }}>
                  <input type="radio" name="type" value={v} checked={type === v} onChange={() => setForm(f => ({ ...f, type: v, cat: '', newCat: '' }))} />{TYPE_LABEL[v]}
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'var(--space-3)' }}>
              <div className="field" style={fieldCol}><label style={label} htmlFor="f-amount">Amount ({CURRENCY})</label><input id="f-amount" className="input" name="amount" type="number" min="0" step="any" inputMode="decimal" required value={form.amount} onChange={onForm} style={input} /></div>
              <div className="field" style={fieldCol}><label style={label} htmlFor="f-date">Date</label><input id="f-date" className="input" name="date" type="date" required value={form.date} onChange={onForm} style={input} /></div>
            </div>
            <div className="field" style={fieldCol}><label style={label} htmlFor="f-cat">Category</label>
              <select id="f-cat" className="input" name="cat" value={catVal} onChange={onForm} style={{ fontSize: 16, minHeight: 44 }}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new">+ Add new category…</option>
              </select>
            </div>
            {catVal === '__new' && (
              <div className="field" style={fieldCol}><label style={label} htmlFor="f-newcat">New category name</label><input id="f-newcat" className="input" name="newCat" required value={form.newCat} onChange={onForm} placeholder="e.g. School fees" style={input} /></div>
            )}
            <div className="field" style={fieldCol}><label style={label} htmlFor="f-person">{personLabel}</label>
              <select id="f-person" className="input" name="person" value={personVal} onChange={onForm} style={{ fontSize: 16, minHeight: 44 }}>
                {plist.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="__new">+ Add new name…</option>
              </select>
            </div>
            {personVal === '__new' && (
              <div className="field" style={fieldCol}><label style={label} htmlFor="f-newperson">New name</label><input id="f-newperson" className="input" name="newPerson" required value={form.newPerson} onChange={onForm} placeholder="e.g. Ravi" style={input} /></div>
            )}
            <div className="field" style={fieldCol}><label style={label} htmlFor="f-desc">Description (optional)</label><input id="f-desc" className="input" name="desc" value={form.desc} onChange={onForm} placeholder={descHint} style={input} /></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <button className="btn btn-primary" type="submit" style={{ ...btn, flex: '1 1 auto' }}>{editId ? 'Save changes' : 'Add ' + TYPE_LABEL[type].toLowerCase()}</button>
              {editId && <button className="btn btn-ghost" type="button" onClick={() => { setEditId(null); setForm(blankForm(form.type, personVal)); }} style={btn}>Cancel</button>}
            </div>
            <span style={{ fontSize: 14 }}>{typeHint}</span>
          </form>

          <section style={{ flex: '3 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <h2 style={h2}>Register · {monthLabel}</h2>
              <span style={{ fontSize: 14 }}>Amounts in {CURRENCY} · tap a row to edit</span>
            </div>
            <table className="table" style={{ width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
              <colgroup><col style={{ width: 'auto' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '23%' }} /></colgroup>
              <thead><tr><th style={th}>Particulars</th><th style={thR}>Income</th><th style={thR}>Expense</th><th style={thR}>Balance</th></tr></thead>
              <tbody>
                {!all && opening !== 0 && (
                  <tr><td style={{ ...td, fontStyle: 'italic' }}>Opening balance</td><td style={td} /><td style={td} /><td style={{ ...tdR, fontWeight: 600 }}>{cell(opening)}</td></tr>
                )}
                {rows.map(({ e, bal }) => {
                  const isInv = e.type === 'investment', selected = sel === e.id;
                  const d = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  const meta = d + ' · ' + (e.desc ? e.cat : TYPE_LABEL[e.type]) + (isInv ? ' · Investment' : '') + (e.person ? ' · ' + e.person : '');
                  const top: CSSProperties = { ...td, verticalAlign: 'top', overflowWrap: 'anywhere' };
                  return [
                    <tr key={e.id} onClick={() => setSel(selected ? null : e.id)} style={{ cursor: 'pointer', background: selected ? 'var(--color-accent-100)' : 'transparent' }}
                      tabIndex={0} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); setSel(selected ? null : e.id); } }} aria-expanded={selected}>
                      <td style={top}>
                        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>{e.desc || e.cat}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.3, color: isInv ? ACC : 'var(--color-text)' }}>{meta}</div>
                      </td>
                      <td style={{ ...top, textAlign: 'right', fontSize: 15, color: ACC }}>{e.type === 'income' ? cell(+e.amount) : ''}</td>
                      <td style={{ ...top, textAlign: 'right', fontSize: 15 }}>{e.type !== 'income' ? cell(+e.amount) : ''}</td>
                      <td style={{ ...top, textAlign: 'right', fontSize: 15, fontWeight: 600, color: bal < 0 ? NEG : 'var(--color-text)' }}>{cell(bal)}</td>
                    </tr>,
                    selected && (
                      <tr key={e.id + '-actions'} style={{ background: 'var(--color-accent-100)' }}><td colSpan={4} style={{ padding: '4px 4px 10px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <button className="btn btn-secondary" onClick={ev => startEdit(ev, e)} style={{ ...btn, fontSize: 14 }}>Edit</button>
                          <button className="btn btn-ghost" onClick={ev => del(ev, e)} style={{ ...btn, fontSize: 14, color: NEG }}>Delete</button>
                          <button className="btn btn-ghost" onClick={ev => { ev.stopPropagation(); setSel(null); }} style={{ ...btn, fontSize: 14 }}>Close</button>
                          {e.createdByEmail && <span style={{ fontSize: 13 }}>Entered by {e.createdByEmail.replace(/@wealthwise\.invalid$/, '')}</span>}
                        </div>
                      </td></tr>
                    ),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: '10px 4px', fontWeight: 700, ...rule }}>Total</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, ...rule, color: ACC, overflowWrap: 'anywhere' }}>{cell(inc)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, ...rule, overflowWrap: 'anywhere' }}>{cell(out)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, ...rule, color: balColor, overflowWrap: 'anywhere' }}>{cell(closing)}</td>
                </tr>
              </tfoot>
            </table>
            {!view.length && <p style={{ margin: 'var(--space-2) 0 0' }}>No entries yet. Add your first income or expense — every row shows the balance left after it.</p>}
          </section>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 640 }}>
          <h2 style={h2}>Summary · {monthLabel}</h2>
          <table className="table" style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Item</th><th style={thR}>Amount ({CURRENCY})</th><th style={{ ...thR, width: '22%' }}>% of income</th></tr></thead>
            <tbody>
              <tr><td style={{ ...td, fontWeight: 700 }}>Income received</td><td style={{ ...tdR, fontWeight: 700, color: ACC }}>{num(inc)}</td><td style={tdR}>100%</td></tr>
              {byCat('expense').map(c => <tr key={'x' + c.name}><td style={sub}>{c.name}</td><td style={subR}>{c.amt}</td><td style={subR}>{c.pct}</td></tr>)}
              <tr><td style={{ ...td, fontWeight: 700 }}>Total expenses</td><td style={{ ...tdR, fontWeight: 700 }}>{num(exp)}</td><td style={{ ...tdR, fontWeight: 700 }}>{pct(exp)}</td></tr>
              {byCat('investment').map(c => <tr key={'i' + c.name}><td style={sub}>{c.name}</td><td style={subR}>{c.amt}</td><td style={subR}>{c.pct}</td></tr>)}
              <tr><td style={{ ...td, fontWeight: 700, color: ACC }}>Total saved &amp; invested</td><td style={{ ...tdR, fontWeight: 700, color: ACC }}>{num(inv)}</td><td style={{ ...tdR, fontWeight: 700, color: ACC }}>{pct(inv)}</td></tr>
            </tbody>
            <tfoot>
              <tr><td style={{ ...td, ...rule }}>Total outflow (expenses + investments)</td><td style={{ ...tdR, ...rule }}>{num(out)}</td><td style={{ ...tdR, ...rule }}>{pct(out)}</td></tr>
              <tr><td style={{ ...td, fontWeight: 700 }}>Balance (income − outflow)</td><td style={{ ...tdR, fontWeight: 700, color: balColor }}>{cell(net)}</td><td style={{ ...tdR, fontWeight: 700 }}>{pct(net)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 640 }}>
          <h2 style={h2}>By person · {monthLabel}</h2>
          <table className="table" style={{ width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr><th style={th}>Name</th><th style={thR}>Income</th><th style={thR}>Expenses</th><th style={thR}>Invested</th></tr></thead>
            <tbody>
              {people.map(p => <tr key={p.name}><td style={{ ...td, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.name}</td><td style={{ ...tdR, color: ACC }}>{p.inc}</td><td style={tdR}>{p.exp}</td><td style={tdR}>{p.inv}</td></tr>)}
            </tbody>
            <tfoot><tr><td style={{ ...td, fontWeight: 700, ...rule }}>Total</td><td style={{ ...tdR, fontWeight: 700, ...rule, color: ACC }}>{num(inc)}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(exp)}</td><td style={{ ...tdR, fontWeight: 700, ...rule }}>{num(inv)}</td></tr></tfoot>
          </table>
        </section>

        <footer style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <button className="btn btn-secondary" onClick={exportCsv} style={btn}>Download table (CSV)</button>
            <button className="btn btn-secondary" onClick={exportJson} style={btn}>Backup</button>
            <label className="btn btn-secondary" style={{ ...btn, cursor: 'pointer' }}>Restore backup<input type="file" accept=".json,application/json" onChange={importJson} style={{ display: 'none' }} /></label>
            <button className="btn btn-ghost" onClick={clearAll} style={{ ...btn, color: NEG }}>Clear all data</button>
          </div>
          {footer}
        </footer>
      </div>
    </div>
  );
}
