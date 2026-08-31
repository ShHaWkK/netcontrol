/** Navigation inter-vues légère (même patron que toast.tsx) — permet à la
 * Heatmap de sauter directement sur le bon port du Switch Manager pour
 * résoudre un incident au plus vite, sans routeur ni prop-drilling. */

export type ViewKey = 'overview' | 'heatmap' | 'switch' | 'topology' | 'logs' | 'admin'

interface PendingPortSelection {
  swName: string
  n: number
}

let pendingSelection: PendingPortSelection | null = null
let viewListener: ((v: ViewKey) => void) | null = null

export function onViewChange(cb: (v: ViewKey) => void): () => void {
  viewListener = cb
  return () => {
    viewListener = null
  }
}

/** Bascule sur Switch Manager avec le port {swName, n} pré-sélectionné. */
export function goToPort(swName: string, n: number): void {
  pendingSelection = { swName, n }
  viewListener?.('switch')
}

/** À consommer une seule fois, au montage de SwitchManager. */
export function consumePendingSelection(): PendingPortSelection | null {
  const p = pendingSelection
  pendingSelection = null
  return p
}
