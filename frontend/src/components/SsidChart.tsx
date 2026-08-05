import { useEffect, useRef, useState } from 'react'
import type { SsidHistory, SsidKey } from '../types'
import { cssVar, onThemeChange, pad } from '../utils'

const P = { l: 34, r: 12, t: 10, b: 22 }
const H = 190

export default function SsidChart({ hist }: { hist: SsidHistory }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [colors, setColors] = useState({ staff: '#2a78d6', members: '#eb6834', guests: '#1baf7a' })
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const readColors = () =>
      setColors({ staff: cssVar('--s1'), members: cssVar('--s2'), guests: cssVar('--s3') })
    readColors()
    const offTheme = onThemeChange(readColors)
    const ro = new ResizeObserver(() =>
      setWidth(wrapRef.current?.clientWidth || 560),
    )
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => {
      offTheme()
      ro.disconnect()
    }
  }, [])

  const n = hist.t.length
  if (n < 2) return null

  const max = Math.max(...hist.staff, ...hist.members, ...hist.guests) * 1.15 || 10
  const X = (i: number) => P.l + (i / (n - 1)) * (width - P.l - P.r)
  const Y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b)
  const line = (k: SsidKey) =>
    'M' + hist[k].map((v, i) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' L')
  const area = (k: SsidKey) =>
    `${line(k)} L${X(n - 1).toFixed(1)} ${H - P.b} L${P.l} ${H - P.b} Z`
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f))
  const hourIdx = [0, 36, 72, 108, 144].filter((i) => i < n)
  const hourAt = (i: number) => pad(new Date(hist.t[i]).getHours())

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    setHover(Math.max(0, Math.min(n - 1, Math.round(((x - P.l) / (width - P.l - P.r)) * (n - 1)))))
  }

  const hoverDate = hover !== null ? new Date(hist.t[hover]) : null

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={width - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={P.l - 6} y={Y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </text>
          </g>
        ))}
        {hourIdx.map((i) => (
          <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {hourAt(i)}h
          </text>
        ))}
        {(Object.keys(colors) as SsidKey[]).map((k) => (
          <g key={k}>
            <path d={area(k)} fill={colors[k]} opacity=".10" />
            <path d={line(k)} fill="none" stroke={colors[k]} strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        {hover !== null && (
          <line x1={X(hover)} x2={X(hover)} y1={P.t} y2={H - P.b} stroke="var(--baseline)" strokeDasharray="3 3" />
        )}
      </svg>
      {hover !== null && hoverDate && (
        <div
          className="ap-tip"
          style={{ left: X(hover), top: P.t + 8, transform: 'translate(-50%,-100%)' }}
        >
          <b>{pad(hoverDate.getHours())}:{pad(hoverDate.getMinutes())}</b>
          <table>
            <tbody>
              {(['staff', 'members', 'guests'] as SsidKey[]).map((k) => (
                <tr key={k}>
                  <td>
                    <i className="swatch" style={{ background: colors[k] }} />{' '}
                    {k === 'staff' ? 'Staff' : k === 'members' ? 'Members' : 'Guests'}
                  </td>
                  <td>{hist[k][hover]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
