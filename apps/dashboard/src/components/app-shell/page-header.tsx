import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Page-header slot system. The slim app-shell top bar carries two zones:
 *
 *  - the GLOBAL slot (shell-owned, persistent — see `global-actions.tsx`), and
 *  - the PAGE slot (this file): the active route portals its full control row
 *    (window/range selectors, tabs, filters) into the bar, so each page owns its
 *    actions without a separate in-body header. The breadcrumb already names the page.
 *
 * Why a portal and not route `staticData`: the controls are live — they close over the
 * page's search-param handlers, query data, and local state — so they must render inside
 * the page's React subtree while appearing in the bar. See DESIGN.md (Realized chrome) +
 * docs/MANTINE-THEMING.md.
 */

const TargetContext = createContext<HTMLElement | null>(null)
const SetTargetContext = createContext<(el: HTMLElement | null) => void>(() => {})

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  return (
    <SetTargetContext.Provider value={setTarget}>
      <TargetContext.Provider value={target}>{children}</TargetContext.Provider>
    </SetTargetContext.Provider>
  )
}

/** Renders in the app-shell header — the DOM node the active page portals its actions into. */
export function PageActionsOutlet({ className }: { className?: string }) {
  const setTarget = useContext(SetTargetContext)
  return <div ref={setTarget} className={className} />
}

/** Used by a page to render its control row into the top-bar page slot. */
export function PageActions({ children }: { children: ReactNode }) {
  const target = useContext(TargetContext)
  return target ? createPortal(children, target) : null
}
