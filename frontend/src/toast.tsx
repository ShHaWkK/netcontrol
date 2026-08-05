import { useEffect, useState } from 'react'

interface ToastItem {
  id: number
  title: string
  sub: string
}

type Listener = (t: ToastItem) => void
let listener: Listener | null = null
let nextId = 1

export function showToast(title: string, sub: string) {
  listener?.({ id: nextId++, title, sub })
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    listener = (t) => {
      setToasts((cur) => [...cur, t])
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 4200)
    }
    return () => {
      listener = null
    }
  }, [])

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--good)" strokeWidth="1.8" style={{ flex: 'none', marginTop: 2 }}>
            <circle cx="8" cy="8" r="6.5" />
            <path d="M5.2 8.2l2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </span>
        </div>
      ))}
    </div>
  )
}
