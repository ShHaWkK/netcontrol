interface Props {
  data: number[]
  w: number
  h: number
  color: string
  fill?: boolean
}

export default function Sparkline({ data, w, h, color, fill }: Props) {
  const min = Math.min(...data) - 2
  const max = Math.max(...data) + 2
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / (max - min)) * h,
  ])
  const d = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')
  const last = pts[pts.length - 1]

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {fill && <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} opacity=".12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  )
}
