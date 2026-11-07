// Pure calculations for the Statements screen: loan schedules, commitment due
// dates and the rule-based cost-cutting suggestions. No UI here.
import { DEFAULT_CATS, isoDate, money, num } from './shared';
import type { Commitment, CommitmentKind, Entry, Frequency, Loan, Receivable, ReceivableKind, StoredRecord } from './store';

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate(); // keep 31st → 30th/28th
  return isoDate(new Date(y, m - 1 + n, Math.min(d, last)));
};

// — loans —

export const calcEmi = (principal: number, ratePct: number, months: number) => {
  if (months <= 0) return 0;
  const r = ratePct / 1200;
  if (!r) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
};
export const loanEmi = (l: Loan) => (l.emi && l.emi > 0 ? l.emi : calcEmi(l.principal, l.rate, l.tenure));

export interface Instalment { n: number; date: string; emi: number; interest: number; principal: number; balance: number }

/** The full amortisation schedule: reducing balance, interest charged monthly. */
export function schedule(l: Loan): Instalment[] {
  const r = l.rate / 1200, emi = loanEmi(l), rows: Instalment[] = [];
  let bal = l.principal;
  for (let n = 1; n <= Math.max(l.tenure, 1) * 2 && bal > 0.5; n++) {
    const interest = bal * r;
    let pay = emi, princ = pay - interest;
    if (princ >= bal || n === l.tenure) { princ = bal; pay = bal + interest; }
    if (princ <= 0) break; // EMI does not cover interest; stop rather than loop
    bal -= princ;
    rows.push({ n, date: addMonths(l.firstEmi, n - 1), emi: pay, interest, principal: princ, balance: Math.max(bal, 0) });
  }
  return rows;
}

/** Outstanding principal after every instalment due on or before `onDate`. */
export const outstandingOn = (l: Loan, onDate: string) => {
  const done = schedule(l).filter(i => i.date <= onDate);
  return done.length ? done[done.length - 1].balance : l.principal;
};

/** Interest saved and months cut if `extra` is prepaid today, keeping the same EMI. */
export function prepaymentGain(l: Loan, extra: number, today: string) {
  const bal = outstandingOn(l, today);
  if (bal <= 0) return { interestSaved: 0, monthsSaved: 0 };
  const left = schedule(l).filter(i => i.date > today);
  const base = left.reduce((a, i) => a + i.interest, 0);
  const r = l.rate / 1200, emi = loanEmi(l);
  let b = Math.max(bal - extra, 0), interest = 0, months = 0;
  while (b > 0.5 && months < 1200) { const i = b * r; interest += i; b -= Math.min(emi - i, b); months++; if (emi <= i) break; }
  return { interestSaved: Math.max(base - interest, 0), monthsSaved: Math.max(left.length - months, 0) };
}

// — commitments —

const STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12, once: 0 };
export const FREQ_LABEL: Record<Frequency, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', 'half-yearly': 'Every 6 months', yearly: 'Yearly', once: 'Once' };
export const KIND_LABEL: Record<CommitmentKind | 'loan', string> = { loan: 'Loan EMI', insurance: 'Insurance', fees: 'Fees', rent: 'Rent', subscription: 'Subscription', tax: 'Tax', other: 'Other' };
/** Register category a payment of this kind is recorded under. */
export const KIND_CATEGORY: Record<CommitmentKind | 'loan', string> = { loan: 'Debt / EMI', insurance: 'Insurance', fees: 'Fees', rent: 'Rent', subscription: 'Bills & utilities', tax: 'Other expense', other: 'Other expense' };

export function dueDates(c: { frequency: Frequency; firstDue: string; endDate?: string }, from: string, to: string): string[] {
  const step = STEP[c.frequency], out: string[] = [];
  if (!step) return c.firstDue >= from && c.firstDue <= to ? [c.firstDue] : [];
  for (let k = 0; k < 2400; k++) {
    const d = addMonths(c.firstDue, k * step);
    if (d > to || (c.endDate && d > c.endDate)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** A commitment's cost spread per month (yearly premium → /12). */
export const monthlyCost = (c: Commitment) => (STEP[c.frequency] ? c.amount / STEP[c.frequency] : 0);

export interface Due { key: string; recordId: string; date: string; name: string; kind: CommitmentKind | 'loan'; amount: number; person: string; detail: string }

/** Every loan EMI and commitment falling due between two dates, oldest first. */
export function duesBetween(records: StoredRecord[], from: string, to: string): Due[] {
  const out: Due[] = [];
  for (const r of records) {
    if (r.kind === 'loan') {
      const l = r.data as Loan;
      for (const i of schedule(l)) if (i.date >= from && i.date <= to)
        out.push({ key: `pay:${r.id}:${i.date}`, recordId: r.id, date: i.date, name: l.name, kind: 'loan', amount: i.emi, person: l.person, detail: `EMI ${i.n} · interest ${money(i.interest)}` });
    } else if (r.kind === 'commitment') {
      const c = r.data as Commitment;
      for (const d of dueDates(c, from, to))
        out.push({ key: `pay:${r.id}:${d}`, recordId: r.id, date: d, name: c.name, kind: c.kind, amount: c.amount, person: c.person, detail: (c.reference ? c.reference + ' · ' : '') + FREQ_LABEL[c.frequency] });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// — money still to come in —

export const RECV_LABEL: Record<ReceivableKind, string> = { rent: 'Rent to collect', claim: 'Insurance / medical claim', refund: 'Refund', lent: 'Money lent / dues', maturity: 'Deposit maturity', other: 'Other' };
/** Register income category a receipt of this kind is recorded under. */
export const RECV_CATEGORY: Record<ReceivableKind, string> = { rent: 'Rent received', claim: 'Claims & refunds', refund: 'Claims & refunds', lent: 'Other income', maturity: 'Interest & dividends', other: 'Other income' };

export interface Expected { key: string; recordId: string; date: string; name: string; kind: ReceivableKind; amount: number; from: string; person: string; detail: string }

/** Every expected receipt between two dates, oldest first. Keys are the register entry ids used when marked received. */
export function expectedBetween(records: StoredRecord[], from: string, to: string): Expected[] {
  const out: Expected[] = [];
  for (const r of records) {
    if (r.kind !== 'receivable') continue;
    const v = r.data as Receivable;
    for (const d of dueDates(v, from, to))
      out.push({ key: `recv:${r.id}:${d}`, recordId: r.id, date: d, name: v.name, kind: v.kind, amount: v.amount, from: v.from, person: v.person, detail: [v.from, v.reference, FREQ_LABEL[v.frequency]].filter(Boolean).join(' · ') });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Outstanding receivables up to `upTo` that have no matching receipt in the register. */
export function stillToReceive(records: StoredRecord[], received: Set<string>, upTo: string, today: string) {
  const open = expectedBetween(records, '1900-01-01', upTo).filter(x => !received.has(x.key));
  const overdue = open.filter(x => x.date < today);
  return { open, overdue, total: open.reduce((a, x) => a + x.amount, 0), overdueTotal: overdue.reduce((a, x) => a + x.amount, 0) };
}

// — cost-cutting suggestions (rule-based) —

/** Most a category should take of monthly income; common household-budget rules of thumb. */
const SHARE_LIMIT: Record<string, number> = { 'Food & groceries': 0.15, Shopping: 0.1, Transport: 0.1, 'Bills & utilities': 0.08, 'Other expense': 0.05 };
const DISCRETIONARY_LIMIT = 0.05; // for categories the family added themselves

export interface Suggestion { area: string; spent: number | null; usual: string; saving: number; remark: string }

export function suggestions(entries: Entry[], records: StoredRecord[], month: string, today: string): Suggestion[] {
  const out: Suggestion[] = [];
  const inMonth = (ym: string) => entries.filter(e => e.date.slice(0, 7) === ym);
  const cur = inMonth(month);
  const income = cur.filter(e => e.type === 'income').reduce((a, e) => a + e.amount, 0);
  const spent = (es: Entry[], cat: string) => es.filter(e => e.type === 'expense' && e.cat === cat).reduce((a, e) => a + e.amount, 0);
  const prevMonths = [1, 2, 3].map(k => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() - k); return isoDate(d).slice(0, 7); })
    .filter(ym => inMonth(ym).some(e => e.type === 'expense'));

  const cats = [...new Set(cur.filter(e => e.type === 'expense').map(e => e.cat))];
  for (const cat of cats) {
    if (cat === 'Debt / EMI' || cat === 'Rent' || cat === 'Medical' || cat === 'Insurance' || cat === 'Fees') continue; // committed or essential
    const amt = spent(cur, cat);
    const avg = prevMonths.length ? prevMonths.reduce((a, ym) => a + spent(inMonth(ym), cat), 0) / prevMonths.length : 0;
    const limitShare = SHARE_LIMIT[cat] ?? (DEFAULT_CATS.expense.includes(cat) ? null : DISCRETIONARY_LIMIT);
    const limit = income && limitShare ? income * limitShare : 0;
    let saving = 0; const why: string[] = [];
    if (avg > 0 && amt > avg * 1.2 && amt - avg >= 500) { saving = Math.max(saving, amt - avg); why.push(`${Math.round((amt / avg - 1) * 100)}% above your ${prevMonths.length}-month average of ${money(avg)}`); }
    if (limit && amt > limit) { saving = Math.max(saving, amt - limit); why.push(`${(amt / income * 100).toFixed(0)}% of income, against a guide of ${Math.round(limitShare! * 100)}%`); }
    if (saving > 0) out.push({ area: cat, spent: amt, usual: [avg ? money(avg) + ' avg' : '', limit ? money(limit) + ' guide' : ''].filter(Boolean).join(' · '), saving, remark: `Spending is ${why.join(', and ')}. Bringing it back saves about ${money(saving)} a month.` });
  }

  const loans = records.filter(r => r.kind === 'loan').map(r => ({ id: r.id, l: r.data as Loan })).filter(({ l }) => outstandingOn(l, today) > 0);
  const emiTotal = loans.reduce((a, { l }) => a + loanEmi(l), 0);
  if (income && emiTotal / income > 0.4)
    out.push({ area: 'Loan EMIs', spent: emiTotal, usual: money(income * 0.4) + ' guide', saving: 0, remark: `EMIs take ${(emiTotal / income * 100).toFixed(0)}% of income; above 40% leaves little room. Avoid new loans and clear the costliest one first.` });
  const costly = loans.filter(({ l }) => l.rate >= 10).sort((a, b) => b.l.rate - a.l.rate)[0];
  if (costly) {
    const extra = Math.min(10000, outstandingOn(costly.l, today));
    const g = prepaymentGain(costly.l, extra, today);
    if (g.interestSaved >= 100)
      out.push({ area: costly.l.name, spent: null, usual: `${costly.l.rate}% interest`, saving: g.interestSaved / Math.max(costly.l.tenure, 12), remark: `Prepaying ${money(extra)} on this loan saves about ${money(g.interestSaved)} of interest${g.monthsSaved ? ` and ends it ${g.monthsSaved} month${g.monthsSaved > 1 ? 's' : ''} sooner` : ''}. Check the lender's prepayment charges first.` });
  }

  const commits = records.filter(r => r.kind === 'commitment').map(r => r.data as Commitment).filter(c => !c.endDate || c.endDate >= today);
  const monthlyInsurance = commits.filter(c => c.kind === 'insurance' && c.frequency !== 'yearly' && c.frequency !== 'once');
  if (monthlyInsurance.length) {
    const yearly = monthlyInsurance.reduce((a, c) => a + monthlyCost(c) * 12, 0);
    out.push({ area: 'Insurance premiums', spent: null, usual: monthlyInsurance.map(c => c.name).join(', '), saving: yearly * 0.03 / 12, remark: `Paying ${monthlyInsurance.length > 1 ? 'these premiums' : 'this premium'} yearly instead of in instalments is often 2–5% cheaper: about ${money(yearly * 0.03)} a year at 3%.` });
  }
  const subs = commits.filter(c => c.kind === 'subscription');
  if (subs.length) {
    const yearly = subs.reduce((a, c) => a + monthlyCost(c) * 12, 0);
    out.push({ area: 'Subscriptions', spent: yearly / 12, usual: `${subs.length} active`, saving: 0, remark: `Subscriptions cost ${money(yearly)} a year. Cancel any you have not used in the last month.` });
  }

  const inv = cur.filter(e => e.type === 'investment').reduce((a, e) => a + e.amount, 0);
  if (income) {
    const rate = inv / income;
    if (rate < 0.2) out.push({ area: 'Saving rate', spent: inv, usual: money(income * 0.2) + ' guide', saving: 0, remark: `You saved or invested ${(rate * 100).toFixed(0)}% of income. Aim for 20%: put ${money(income * 0.2 - inv)} more into savings each month, for example as a SIP on salary day.` });
  }
  return out.sort((a, b) => b.saving - a.saving);
}

/** Monthly income / expense / investment totals for the 12 months ending `month`. */
export function monthlyTotals(entries: Entry[], month: string) {
  const months: string[] = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() - k); months.push(isoDate(d).slice(0, 7)); }
  return months.map(ym => {
    const es = entries.filter(e => e.date.slice(0, 7) === ym);
    const by = (t: Entry['type']) => es.filter(e => e.type === t).reduce((a, e) => a + e.amount, 0);
    const income = by('income'), expense = by('expense'), invested = by('investment');
    return { month: ym, income, expense, invested, rate: income ? (invested / income) * 100 : null as number | null };
  });
}

export const fmtCompact = (n: number) => (Math.abs(n) >= 100000 ? (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'K' : num(n));
