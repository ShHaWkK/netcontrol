import { useEffect, useRef, useState } from 'react'
import { cssVar, onThemeChange, hms } from '../utils'

interface Props {
  t: string[]
  values: (number | null)[]
  unit: string
  color: string
  min?: number
  max?: number
}

const P = { l: 34, r: 10, t: 10, b: 20 }
const H = 120

/** Découpe la série en segments continus — un trou (valeur null, lecture
 * ratée) casse la ligne au lieu de la relier faussement. */
function segments(values: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = []
  let cur: { i: number; v: number }[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur)
      cur = []
    } else {
      cur.push({ i, v })
    }
  })
  if (cur.length) out.push(cur)
  return out
}

export default function MetricChart({ t, values, unit, color, min: fixedMin, max: fixedMax }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(280)
  const [hover, setHover] = useState<number | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(wrapRef.current?.clientWidth || 280))
    if (wrapRef.current) ro.observe(wrapRef.current)
    const off = onThemeChange(() => force((x) => x + 1))
    return () => { ro.disconnect(); off() }
  }, [])

  const known = values.filter((v): v is number => v !== null)
  if (known.length < 2) {
    return <div className="pp-empty" style={{ padding: '14px 4px', fontSize: 11.5 }}>Pas encore assez de données — collecte en cours…</div>
  }

  const n = values.length
  const min = fixedMin ?? Math.min(...known)
  const max = fixedMax ?? Math.max(...known)
  const pad = (max - min) * 0.15 || 1
  const lo = min - pad
  const hi = max + pad

  const X = (i: number) => P.l + (i / (n - 1)) * (width - P.l - P.r)
  const Y = (v: number) => H - P.b - ((v - lo) / (hi - lo)) * (H - P.t - P.b)
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - P.l) / (width - P.l - P.r)) * (n - 1))))
    setHover(values[i] !== null ? i : null)
  }

  const fmt = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 100) / 100)
  const last = fmt(known[known.length - 1])
  const hoverColor = cssVar('--accent') || color

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{last}{unit}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>actuel</span>
      </div>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={width - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={P.l - 6} y={Y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(v)}
            </text>
          </g>
        ))}
        {segments(values).map((seg, si) => {
          const d = 'M' + seg.map((p) => `${X(p.i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' L')
          const area = `${d} L${X(seg[seg.length - 1].i).toFixed(1)} ${H - P.b} L${X(seg[0].i).toFixed(1)} ${H - P.b} Z`
          return (
            <g key={si}>
              <path d={area} fill={color} opacity=".1" />
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          )
        })}
        {hover !== null && (
          <line x1={X(hover)} x2={X(hover)} y1={P.t} y2={H - P.b} stroke="var(--baseline)" strokeDasharray="3 3" />
        )}
      </svg>
      {hover !== null && values[hover] !== null && (
        <div className="ap-tip" style={{ left: X(hover), top: P.t, transform: 'translate(-50%,-100%)' }}>
          <b>{hms(t[hover])}</b>
          <table><tbody><tr><td style={{ color: hoverColor, fontWeight: 700 }}>{fmt(values[hover]!)}{unit}</td></tr></tbody></table>
        </div>
      )}
    </div>
  )
}
