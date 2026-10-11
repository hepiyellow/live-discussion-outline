/** How long a checkbox takes to fly to the Send button. */
const FLIGHT_MS = 650

/** The ease of the flight: slow to leave, quick into the button. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Flies a copy of `from` along a curved path onto `to`, then removes it: a quadratic curve that bows up and to the left
 * of the straight line, shrinking and fading as it lands. Returns false when either element is missing, so the caller can
 * fall back to a plain message. Reduced motion skips the flight and only pulses the target.
 */
export function flyTo(from: Element, to: Element): boolean {
    const a = from.getBoundingClientRect()
    const b = to.getBoundingClientRect()
    if (!a.width || !b.width) return false
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300 })
        return true
    }

    const size = a.width
    const ghost = from.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-num')
    Object.assign(ghost.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: `${size}px`,
        height: `${a.height}px`,
        margin: '0',
        zIndex: '100',
        pointerEvents: 'none',
        transformOrigin: 'center',
    })
    document.body.appendChild(ghost)

    // The path runs from the checkbox's centre to the button's, bowed out by a control point off the straight line.
    const x0 = a.left + a.width / 2
    const y0 = a.top + a.height / 2
    const x2 = b.left + b.width / 2
    const y2 = b.top + b.height / 2
    const dx = x2 - x0
    const dy = y2 - y0
    const length = Math.hypot(dx, dy) || 1
    const bow = Math.min(240, length * 0.35)
    const x1 = (x0 + x2) / 2 - (dy / length) * bow
    const y1 = (y0 + y2) / 2 + (dx / length) * bow

    const start = performance.now()
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / FLIGHT_MS)
        const e = ease(t)
        const u = 1 - e
        const x = u * u * x0 + 2 * u * e * x1 + e * e * x2
        const y = u * u * y0 + 2 * u * e * y1 + e * e * y2
        const scale = 1 - 0.6 * e
        ghost.style.transform = `translate(${x - size / 2}px, ${y - a.height / 2}px) scale(${scale})`
        ghost.style.opacity = String(t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2)
        if (t < 1) return requestAnimationFrame(step)
        ghost.remove()
        to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 250 })
    }
    requestAnimationFrame(step)
    return true
}
