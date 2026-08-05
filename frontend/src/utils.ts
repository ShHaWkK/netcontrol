export const fmt = (n: number) => n.toLocaleString('en-US')
export const pad = (n: number) => String(n).padStart(2, '0')

export function hms(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function sinceLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${pad(mins % 60)} min` : `${mins} min`
}

export function minutesAgo(n: number): string {
  return `${n} min ago`
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Relance `cb` quand le thème clair/sombre change (media query ou data-theme). */
export function onThemeChange(cb: () => void): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    mq.removeEventListener('change', cb)
    mo.disconnect()
  }
}
