import { ReactNode, useEffect, useRef } from 'react'

/** Bottom sheet: grabber, drag-down to dismiss, Escape, scroll lock, focus return. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const openedAt = useRef(performance.now())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
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
  }, [onClose])

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
    <div className="backdrop" onClick={() => performance.now() - openedAt.current > 450 && onClose()}>
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
