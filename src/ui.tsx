import { ReactNode, PointerEvent, useEffect, useRef, useState } from 'react'

/** Bottom sheet: grabber, drag-down to dismiss, Escape, scroll lock, focus return. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props
  const [dy, setDy] = useState(0)
  const startY = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

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

  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    startY.current = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (startY.current !== null) setDy(Math.max(0, e.clientY - startY.current))
  }
  const up = () => {
    if (startY.current === null) return
    startY.current = null
    if (dy > 110) onClose()
    else setDy(0)
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="sheet"
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: startY.current === null ? 'transform 0.25s ease-out' : 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
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
