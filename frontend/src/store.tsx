import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Snapshot } from './types'

interface Store {
  snap: Snapshot | null
  connected: boolean
}

const StoreContext = createContext<Store>({ snap: null, connected: false })

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const retryRef = useRef(0)

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        retryRef.current = 0
        setConnected(true)
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'snapshot') setSnap(msg.data)
      }
      ws.onclose = () => {
        setConnected(false)
        if (closed) return
        const delay = Math.min(10_000, 500 * 2 ** retryRef.current++)
        reconnectTimer = setTimeout(connect, delay)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    // premier chargement immédiat sans attendre le WS
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setSnap((prev) => prev ?? s))
      .catch(() => {})

    return () => {
      closed = true
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  return (
    <StoreContext.Provider value={{ snap, connected }}>
      {children}
    </StoreContext.Provider>
  )
}

export const useStore = () => useContext(StoreContext)

/** Snapshot garanti non nul — à n'utiliser que sous le garde de chargement de App. */
export function useSnapshot(): Snapshot {
  const { snap } = useStore()
  if (!snap) throw new Error('Snapshot indisponible')
  return snap
}
