/**
 * A spring in Apple's terms: damping ratio (1 = no overshoot) and response (roughly seconds to settle).
 * It starts from wherever the card is and with whatever speed it has, so a gesture can grab it mid-flight.
 */
export function springTo(
  from: number,
  to: number,
  velocity: number,
  { damping, response }: { damping: number; response: number },
  onFrame: (x: number) => boolean | void,
  onDone: () => void,
) {
  const k = ((2 * Math.PI) / response) ** 2
  const c = (4 * Math.PI * damping) / response
  let x = from
  let v = velocity
  let last = performance.now()
  let id = requestAnimationFrame(function tick(now) {
    let dt = Math.min(0.064, (now - last) / 1000)
    last = now
    while (dt > 0) {
      const h = Math.min(dt, 0.004)
      v += (-k * (x - to) - c * v) * h
      x += v * h
      dt -= h
    }
    const settled = Math.abs(x - to) < 0.5 && Math.abs(v) < 5
    if (settled) x = to
    if (onFrame(x) === true || settled) return onDone()
    id = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(id)
}

/** Where a flick would come to rest, like scroll deceleration (Apple's projection, rate 0.998). */
export const project = (v: number) => ((v / 1000) * 0.998) / (1 - 0.998)
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

