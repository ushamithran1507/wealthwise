// Small SVG charts on the Broadsheet ink: thin marks, hairline grid, hover tooltip.
// Palette validated with the dataviz validator against the white sheet:
// cyan #0088b0, magenta #d6006c, gold #b07d00 (all checks pass, light mode).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtCompact } from './finance';
import { money } from './shared';

export const SERIES = { income: '#0088b0', expense: '#d6006c', invested: '#b07d00' };
const GRID = '#e6e4e3', AXIS_TEXT = '#605d5d';
const H = 220, PAD = { t: 12, r: 8, b: 26, l: 44 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 90, 0), w - 180);
  return <div role="tooltip" style={{ position: 'absolute', left, top: Math.max(y - 8, 0), transform: 'translateY(-100%)', width: 180, pointerEvents: 'none', background: '#ffffff', boxShadow: 'var(--shadow-md)', borderRadius: 'var(--radius-lg)', padding: '8px 10px', fontSize: 13, lineHeight: 1.4, zIndex: 2 }}>{children}</div>;
}
const Swatch = ({ color, line }: { color: string; line?: boolean }) => <span aria-hidden style={{ display: 'inline-block', width: 12, height: line ? 2 : 10, borderRadius: line ? 1 : 2, background: color, verticalAlign: 'middle', marginRight: 6 }} />;

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', fontSize: 14 }}>{items.map(i => <span key={i.label}><Swatch color={i.color} line={i.line} />{i.label}</span>)}</div>;
}

export interface ColumnDatum { label: string; full: string; values: number[] }

/** Grouped columns: one group per month, one column per series. */
export function ColumnChart({ data, series, title }: { data: ColumnDatum[]; series: { label: string; color: string }[]; title: string }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.flatMap(d => d.values)));
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, band = iw / data.length;
  const bw = Math.min(24, Math.max(3, (band * 0.7 - (series.length - 1) * 2) / series.length));
  const groupW = bw * series.length + (series.length - 1) * 2;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const showEvery = band < 34 ? 2 : 1;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={H} role="img" aria-label={title} style={{ display: 'block' }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
        {ticks.map(t => <g key={t}><line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} /><text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>{fmtCompact(t)}</text></g>)}
        {data.map((d, i) => {
          const x0 = PAD.l + i * band + (band - groupW) / 2;
          return (
            <g key={d.full}>
              {d.values.map((v, s) => {
                const h = Math.max(0, ih - (y(v) - PAD.t)), x = x0 + s * (bw + 2), top = y(v), r = Math.min(4, bw / 2, h);
                return h > 0 ? <path key={s} d={`M${x},${PAD.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${PAD.t + ih} Z`} fill={series[s].color} opacity={hover === null || hover === i ? 1 : 0.35} /> : null;
              })}
              {i % showEvery === 0 && <text x={PAD.l + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>{d.label}</text>}
              <rect x={PAD.l + i * band} y={PAD.t} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tip x={PAD.l + hover * band + band / 2} y={y(Math.max(...data[hover].values))} w={w}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{data[hover].full}</div>
          {series.map((s, k) => <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span><Swatch color={s.color} />{s.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(data[hover].values[k])}</span></div>)}
        </Tip>
      )}
    </div>
  );
}

export interface LinePoint { label: string; full: string; value: number | null }

/** One series as a 2px line with end-dot; optional dashed-free target reference line. */
export function LineChart({ data, color, title, format, target, targetLabel, minZero = true }: { data: LinePoint[]; color: string; title: string; format: (v: number) => string; target?: number; targetLabel?: string; minZero?: boolean }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map(d => d.value).filter((v): v is number => v !== null);
  const max = niceMax(Math.max(target ?? 0, ...vals, 0));
  const min = minZero ? 0 : Math.min(0, ...vals);
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, step = data.length > 1 ? iw / (data.length - 1) : iw;
  const x = (i: number) => PAD.l + i * step, y = (v: number) => PAD.t + ih - ((v - min) / (max - min || 1)) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => min + f * (max - min));
  const segs: string[] = []; let cur = '';
  data.forEach((d, i) => { if (d.value === null) { if (cur) segs.push(cur); cur = ''; } else cur += (cur ? ' L' : 'M') + x(i) + ',' + y(d.value); });
  if (cur) segs.push(cur);
  const lastIdx = data.map(d => d.value !== null).lastIndexOf(true);
  const showEvery = step < 34 ? 2 : 1;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={H} role="img" aria-label={title} style={{ display: 'block' }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
        {ticks.map(t => <g key={t}><line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} /><text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>{format(t)}</text></g>)}
        {target !== undefined && <g><line x1={PAD.l} x2={w - PAD.r} y1={y(target)} y2={y(target)} stroke="#201e1d" strokeWidth={1} /><text x={w - PAD.r} y={y(target) - 4} textAnchor="end" fontSize={11} fill="#201e1d">{targetLabel}</text></g>}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {data.map((d, i) => d.value !== null && (i === lastIdx || hover === i) ? <circle key={i} cx={x(i)} cy={y(d.value)} r={4} fill={color} stroke="#ffffff" strokeWidth={2} /> : null)}
        {lastIdx >= 0 && <text x={Math.min(x(lastIdx) + 6, w - PAD.r)} y={y(data[lastIdx].value!) - 8} textAnchor={x(lastIdx) + 60 > w ? 'end' : 'start'} fontSize={12} fontWeight={600} fill="#201e1d">{format(data[lastIdx].value!)}</text>}
        {data.map((d, i) => i % showEvery === 0 ? <text key={'l' + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>{d.label}</text> : null)}
        {data.map((_, i) => <rect key={'h' + i} x={x(i) - step / 2} y={PAD.t} width={step} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <Tip x={x(hover)} y={data[hover].value !== null ? y(data[hover].value!) : PAD.t + ih / 2} w={w}>
          <div style={{ fontWeight: 600 }}>{data[hover].full}</div>
          <div style={{ fontVariantNumeric: 'tabular-nums' }}>{data[hover].value === null ? 'No data' : format(data[hover].value!)}</div>
        </Tip>
      )}
    </div>
  );
}
