// Constants, formatters and inline styles shared by the Register and Statements screens.
import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { EType, Entry } from './store';

export const CURRENCY = '₹';
export const DEFAULT_CATS: Record<EType, string[]> = {
  income: ['Salary', 'Business', 'Freelance', 'Rent received', 'Interest & dividends', 'Claims & refunds', 'Other income'],
  expense: ['Food & groceries', 'Rent', 'Shopping', 'Fees', 'Medical', 'Insurance', 'Debt / EMI', 'Bills & utilities', 'Transport', 'Other expense'],
  investment: ['Savings deposit', 'SIP / mutual fund', 'Fixed deposit', 'PPF / EPF', 'Shares', 'Gold', 'Other investment'],
};
export const DEFAULT_PEOPLE = ['USHA', 'Venkat', 'Mithu'];
export const TYPE_LABEL: Record<EType, string> = { income: 'Income', expense: 'Expense', investment: 'Investment' };

export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayISO = () => isoDate(new Date());
export const curMonth = () => todayISO().slice(0, 7);
export const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
export const shortMonth = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
export const dayMonth = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export const num = (n: number) => Math.round(n).toLocaleString('en-IN');
export const money = (n: number) => (n < 0 ? '−' : '') + CURRENCY + num(Math.abs(n));
export const cell = (n: number) => (n < 0 ? '−' : '') + num(Math.abs(n));
export const sumOf = (arr: Entry[]) => arr.reduce((a, e) => a + (+e.amount || 0), 0);
export const flow = (e: Entry) => (e.type === 'income' ? +e.amount : -+e.amount);

// — inline styles, as in the design —
export const NEG = 'var(--color-accent-2-700)';
export const ACC = 'var(--color-accent-700)';
export const kicker: CSSProperties = { fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 };
export const figure: CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 'clamp(24px,6.5vw,34px)', fontWeight: 700 };
export const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600 };
export const fieldCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 };
export const label: CSSProperties = { fontSize: 14 };
export const input: CSSProperties = { fontSize: 16, minHeight: 44, width: '100%', boxSizing: 'border-box' };
export const select: CSSProperties = { fontSize: 16, minHeight: 44 };
export const th: CSSProperties = { padding: '8px 4px', fontSize: 14 };
export const thR: CSSProperties = { ...th, textAlign: 'right' };
export const td: CSSProperties = { padding: '8px 4px' };
export const tdR: CSSProperties = { ...td, textAlign: 'right' };
export const rule: CSSProperties = { borderTop: '2px solid var(--color-text)' };
export const sub: CSSProperties = { padding: '6px 4px 6px var(--space-4)' };
export const subR: CSSProperties = { padding: '6px 4px', textAlign: 'right' };
export const btn: CSSProperties = { minHeight: 44 };

/** The white page sheet both screens sit on. */
export function Page({ children }: { children: ReactNode }) {
  return createElement('div', { style: { minHeight: '100vh', background: '#ffffff', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.45 } },
    createElement('div', { style: { maxWidth: 1100, margin: '0 auto', padding: 'calc(var(--space-4) + env(safe-area-inset-top)) min(var(--space-6),4vw) 80px', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' } }, children));
}
