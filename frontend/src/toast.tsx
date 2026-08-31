import { useEffect, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  title: string
  sub: string
  kind: ToastKind
}

type Listener = (t: ToastItem) => void
let listener: Listener | null = null
let nextId = 1

/** Durée d'affichage plus longue pour les erreurs — on laisse le temps de lire. */
const DURATION: Record<ToastKind, number> = { success: 4200, error: 7000, info: 4200 }

export function showToast(title: string, sub: string, kind: ToastKind = 'success') {
  listener?.({ id: nextId++, title, sub, kind })
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'error') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--critical)" strokeWidth="1.8" style={{ flex: 'none', marginTop: 2 }}>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'info') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.8" style={{ flex: 'none', marginTop: 2 }}>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7.2v4M8 5.2v.1" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--good)" strokeWidth="1.8" style={{ flex: 'none', marginTop: 2 }}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.2 8.2l2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    listener = (t) => {
      setToasts((cur) => [...cur, t])
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), DURATION[t.kind])
    }
    return () => {
      listener = null
    }
  }, [])

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          <ToastIcon kind={t.kind} />
          <span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </span>
        </div>
      ))}
    </div>
  )
}
