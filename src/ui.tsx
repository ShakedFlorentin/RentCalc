import { ReactNode, useEffect, useRef, useState } from 'react'
import { Icon, type LucideIcon } from './icons'

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** Bottom sheet: grabber, drag-down to dismiss, Escape, scroll lock, focus return. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const openedAt = useRef(performance.now())

  // runs once per opening: re-running on every parent render would pull focus out of the field being typed in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const opener = document.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      opener?.focus?.({ preventScroll: true })
    }
  }, [])

  // Pull down anywhere on the sheet to close it: from the header always, from the content once it is scrolled to
  // the top. A short fast flick closes it too. Touch listeners are attached by hand because React's are passive
  // and the pull has to stop the content from scrolling.
  useEffect(() => {
    const sheet = ref.current
    const body = sheet?.querySelector<HTMLElement>('.sheet-body')
    if (!sheet || !body) return
    let y0 = 0
    let t0 = 0
    let dy = 0
    let dragging = false
    let canDrag = false
    const set = (y: number, animate: boolean) => {
      sheet.style.transition = animate ? 'transform 0.22s ease-out' : 'none'
      sheet.style.transform = y ? `translateY(${y}px)` : ''
    }
    const release = () => {
      if (!dragging) return
      dragging = false
      const speed = dy / Math.max(1, performance.now() - t0)
      if (dy > Math.min(120, sheet.offsetHeight * 0.25) || (dy > 30 && speed > 0.5)) {
        set(sheet.offsetHeight, true)
        setTimeout(() => close.current(), 200)
      } else set(0, true)
    }
    const start = (y: number, target: EventTarget | null) => {
      const el = target as HTMLElement
      canDrag = !el.closest('input, textarea, select, .leaflet-container') && (!!el.closest('.sheet-head') || body.scrollTop <= 0)
      y0 = y
      dy = 0
      dragging = false
    }
    const move = (y: number) => {
      if (!canDrag) return false
      const d = y - y0
      if (!dragging) {
        // pulling up means scrolling the content, so leave it to the browser
        if (d < 0) {
          canDrag = false
          return false
        }
        // claim a downward pull from its first pixel: once iOS starts its own scroll/bounce, touchmove can no longer
        // be cancelled and the sheet would never move
        if (d < 6) return true
        dragging = true
        y0 = y
        t0 = performance.now()
      }
      dy = Math.max(0, y - y0)
      set(dy, false)
      return true
    }

    const ts = (e: TouchEvent) => start(e.touches[0].clientY, e.target)
    const tm = (e: TouchEvent) => {
      if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault()
    }
    // mouse: only from the header, like a window title bar
    const md = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.sheet-head') || (e.target as HTMLElement).closest('button')) return
      start(e.clientY, e.target)
      const mm = (ev: MouseEvent) => move(ev.clientY)
      const mu = () => {
        release()
        window.removeEventListener('mousemove', mm)
        window.removeEventListener('mouseup', mu)
      }
      window.addEventListener('mousemove', mm)
      window.addEventListener('mouseup', mu)
    }
    sheet.addEventListener('touchstart', ts, { passive: true })
    sheet.addEventListener('touchmove', tm, { passive: false })
    sheet.addEventListener('touchend', release)
    sheet.addEventListener('touchcancel', release)
    sheet.addEventListener('mousedown', md)
    return () => {
      sheet.removeEventListener('touchstart', ts)
      sheet.removeEventListener('touchmove', tm)
      sheet.removeEventListener('touchend', release)
      sheet.removeEventListener('touchcancel', release)
      sheet.removeEventListener('mousedown', md)
    }
  }, [])

  return (
    // the click that follows the tap which opened the sheet lands on the backdrop; don't let it close the sheet
    <div
      className="backdrop"
      onClick={() => performance.now() - openedAt.current > 450 && onClose()}
      // a sheet opened from inside a swipe card is portalled, but React still bubbles its pointer events to the
      // card, where a sideways drift while closing the sheet would swipe the card
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="grabber" aria-hidden="true" />
          <button className="sheet-close" onClick={onClose}>
            סגור
          </button>
          <h2>{props.title}</h2>
          <span />
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  )
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

export function Empty(props: { children: ReactNode }) {
  return <p className="empty">{props.children}</p>
}

/** A row of tabs pinned under the top bar; `counts` adds a badge to tabs that have items. */
export function Tabs(props: {
  label: string
  /** a plain label, or a label with a line icon */
  tabs: Record<string, string | { label: string; icon: LucideIcon }>
  current: string
  counts?: Record<string, number>
  onPick: (key: string) => void
}) {
  return (
    <div className="tabs-bar" role="tablist" aria-label={props.label}>
      {Object.entries(props.tabs).map(([k, v]) => (
        <button
          key={k}
          role="tab"
          aria-selected={props.current === k}
          className={'chip' + (props.current === k ? ' on' : '')}
          onClick={() => props.onPick(k)}
        >
          {typeof v === 'string' ? (
            v
          ) : (
            <>
              <Icon as={v.icon} />
              {v.label}
            </>
          )}
          {!!props.counts?.[k] && <span className="count">{props.counts[k]}</span>}
        </button>
      ))}
    </div>
  )
}

/** useState that is also remembered in this browser, for per-viewer choices like the open tab. */
export function useRemembered(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial
    } catch {
      return initial
    }
  })
  const set = (v: string) => {
    setValue(v)
    try {
      localStorage.setItem(key, v)
    } catch {
      // it just won't be remembered
    }
  }
  return [value, set] as const
}

/** Shown when a list couldn't be refreshed; the rows already on screen stay. */
export function LoadNote({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="msg" role="alert">
      לא הצלחתי לעדכן מהשרת – בדקו את החיבור.{' '}
      <button className="link" onClick={onRetry}>
        לנסות שוב
      </button>
    </p>
  )
}
