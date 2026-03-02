import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CoinDice.module.css'

// ─── Pip SVG face ─────────────────────────────────────────────────────────────

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[34, 34], [66, 66]],
  3: [[34, 34], [50, 50], [66, 66]],
  4: [[34, 34], [66, 34], [34, 66], [66, 66]],
  5: [[34, 34], [66, 34], [50, 50], [34, 66], [66, 66]],
  6: [[34, 28], [66, 28], [34, 50], [66, 50], [34, 72], [66, 72]],
}

function PipFace({ value }: { value: number }) {
  const pips = PIP_POSITIONS[value] ?? []
  return (
    <svg viewBox="0 0 100 100" className={styles.pipSvg}>
      {pips.map(([cx, cy], i) => (
        <rect key={i} x={cx - 7} y={cy - 7} width={14} height={14} fill="#1a1a1a" />
      ))}
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type Phase = 'idle' | 'spinning' | 'settling' | 'snapping' | 'landed'

const MAX_VEL     = 14
const ACCEL       = 0.18
const DECEL_MIN   = 0.982
const DECEL_MAX   = 0.990
const COAST_MIN   = 360
const COAST_MAX   = 900
const MAX_HOLD_MS = 2000

function randomFace(exclude?: number): number {
  let n: number
  do { n = Math.floor(Math.random() * 6) + 1 } while (n === exclude)
  return n
}

export interface CoinDiceProps {
  /** True while the user is holding; false when they release. */
  pressing: boolean
  /** Date.now() captured when pressing became true. */
  pressStart: number
  onResult?: (value: number) => void
}

export function CoinDice({ pressing, pressStart, onResult }: CoinDiceProps) {
  const [phase, setPhase]       = useState<Phase>('idle')
  const [result, setResult]     = useState<number | null>(null)
  const [frontFace, setFrontFace] = useState(1)
  const [backFace,  setBackFace]  = useState(4)

  const coinRef         = useRef<HTMLDivElement>(null)
  const phaseRef        = useRef<Phase>('idle')
  const angleRef        = useRef(0)
  const velRef          = useRef(0)
  const resultRef       = useRef<number | null>(null)
  const rafRef          = useRef<number>(0)
  const frontFaceRef    = useRef(1)
  const backFaceRef     = useRef(4)
  const lastHalfRotRef  = useRef(0)
  const casinoTargetRef = useRef(0)
  const decelRef        = useRef(DECEL_MIN)
  const snapTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapAngleRef    = useRef(0)

  const setCoinTransform = (deg: number, transition?: string) => {
    const el = coinRef.current
    if (!el) return
    el.style.transition = transition ?? ''
    el.style.transform  = `rotateY(${deg}deg)`
  }

  const setPhaseSync = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  const tick = useCallback(() => {
    const ph = phaseRef.current

    if (ph === 'spinning') {
      velRef.current = Math.min(velRef.current + ACCEL, MAX_VEL)

    } else if (ph === 'settling') {
      velRef.current *= decelRef.current

      const pastTarget      = angleRef.current >= casinoTargetRef.current
      const nearlyStop      = velRef.current < 0.25
      const essentiallyStop = velRef.current < 0.05
      if ((pastTarget && nearlyStop) || essentiallyStop) {
        velRef.current   = 0
        // Determine which face is currently showing
        const curHalf         = lastHalfRotRef.current
        const isBackShowing   = curHalf % 2 === 1
        const resultFaceValue = isBackShowing ? backFaceRef.current : frontFaceRef.current
        // Always land with front face carrying the result
        frontFaceRef.current  = resultFaceValue
        setFrontFace(resultFaceValue)
        // Snap to nearest 0° (front-face-forward) multiple of 360
        snapAngleRef.current  = Math.round(angleRef.current / 360) * 360
        phaseRef.current = 'snapping'
        setPhase('snapping')
        // Drive the snap transition directly on the DOM — no React state update needed
        setCoinTransform(snapAngleRef.current, 'transform 220ms ease-out')
        snapTimerRef.current = setTimeout(() => {
          angleRef.current  = snapAngleRef.current
          phaseRef.current  = 'landed'
          setPhase('landed')
          resultRef.current = resultFaceValue
          setResult(resultFaceValue)
          onResult?.(resultFaceValue)
          setCoinTransform(snapAngleRef.current)
        }, 350)
        return
      }
    }

    angleRef.current += velRef.current

    if (ph === 'spinning' || ph === 'settling') {
      const halfRot = Math.floor((angleRef.current + 90) / 180)
      if (halfRot !== lastHalfRotRef.current) {
        lastHalfRotRef.current = halfRot
        const isBackNowShowing = halfRot % 2 === 1
        if (isBackNowShowing) {
          // Back just came into view — randomise hidden front face
          const next = randomFace(backFaceRef.current)
          frontFaceRef.current = next
          setFrontFace(next)
        } else {
          // Front just came into view — randomise hidden back face
          const next = randomFace(frontFaceRef.current)
          backFaceRef.current = next
          setBackFace(next)
        }
      }
    }

    // Write transform directly to DOM — bypasses React reconciler each frame
    setCoinTransform(angleRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [onResult])

  // ── React to external pressing signal ─────────────────────────────────────
  useEffect(() => {
    if (pressing) {
      // Start / restart spin
      const ph = phaseRef.current
      if (ph === 'snapping') return
      cancelAnimationFrame(rafRef.current)
      if (snapTimerRef.current) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
      lastHalfRotRef.current = Math.floor((angleRef.current + 90) / 180)
      setResult(null)
      resultRef.current = null
      // Re-sync back face so both faces differ from each other
      const newBack = randomFace(frontFaceRef.current)
      backFaceRef.current = newBack
      setBackFace(newBack)
      velRef.current = ph === 'landed' ? 3 : velRef.current || 3
      setPhaseSync('spinning')
      rafRef.current = requestAnimationFrame(tick)
    } else {
      // Release — settle with coast scaled to hold duration
      if (phaseRef.current !== 'spinning') return
      const holdMs = Date.now() - pressStart
      const t      = Math.min(holdMs / MAX_HOLD_MS, 1)
      decelRef.current = DECEL_MIN + t * (DECEL_MAX - DECEL_MIN)
      const baseCoast     = COAST_MIN + t * (COAST_MAX - COAST_MIN)
      const extraRotation = baseCoast * (0.85 + Math.random() * 0.3)
      casinoTargetRef.current = angleRef.current + extraRotation
      const minVel = extraRotation * (1 - decelRef.current)
      velRef.current = Math.min(Math.max(velRef.current, minVel), MAX_VEL)
      setPhaseSync('settling')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressing])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
  }, [])

  return (
    <div className={styles.root}>
      <div className={styles.scene}>
        <div className={styles.coinWrap}>
          <div
            ref={coinRef}
            className={styles.coin}
            onTransitionEnd={() => {
              if (phaseRef.current !== 'snapping') return
              if (snapTimerRef.current) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
              const snap        = snapAngleRef.current
              angleRef.current  = snap
              phaseRef.current  = 'landed'
              setPhase('landed')
              const rv = frontFaceRef.current
              resultRef.current = rv
              setResult(rv)
              onResult?.(rv)
              setCoinTransform(snap)
            }}
          >
            {/* Front face */}
            <div className={`${styles.face} ${styles.faceFront}`}>
              {phase === 'idle' ? (
                <span className={styles.idleLabel}>D6</span>
              ) : (
                <PipFace value={frontFace} />
              )}
            </div>

            {/* Back face */}
            <div className={`${styles.face} ${styles.faceBack}`}>
              <PipFace value={backFace} />
            </div>

            {/* Thickness edges */}
            <div className={`${styles.edge} ${styles.edgeTop}`} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} />
            <div className={`${styles.edge} ${styles.edgeRight}`} />
          </div>
        </div>
      </div>

      {/* Small result badge inside tile */}
      {phase === 'landed' && result !== null && (
        <span className={styles.resultNum}>{result}</span>
      )}
    </div>
  )
}
