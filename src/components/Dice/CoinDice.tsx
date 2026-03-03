import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CoinDice.module.css'

// ─── Pip helpers (pure DOM — no React re-renders during animation) ────────────

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[34, 34], [66, 66]],
  3: [[34, 34], [50, 50], [66, 66]],
  4: [[34, 34], [66, 34], [34, 66], [66, 66]],
  5: [[34, 34], [66, 34], [50, 50], [34, 66], [66, 66]],
  6: [[34, 28], [66, 28], [34, 50], [66, 50], [34, 72], [66, 72]],
}

function makePipSVG(value: number): string {
  const pips = PIP_POSITIONS[value] ?? []
  const rects = pips
    .map(([cx, cy]) => `<rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" fill="#1a1a1a"/>`)
    .join('')
  return `<svg viewBox="0 0 100 100" class="${styles.pipSvg}">${rects}</svg>`
}

const IDLE_HTML = `<span class="${styles.idleLabel}">D6</span>`

function setFaceEl(el: HTMLDivElement | null, value: number | 'idle') {
  if (el) el.innerHTML = value === 'idle' ? IDLE_HTML : makePipSVG(value)
}

// ─── Main component ───────────────────────────────────────────────────────────

type Phase = 'idle' | 'spinning' | 'settling' | 'snapping' | 'landed'

const MAX_VEL      = 14
const ACCEL        = 0.18
const DECEL_MIN    = 0.982
const DECEL_MAX    = 0.990
const COAST_MIN    = 360
const COAST_MAX    = 900
const MAX_HOLD_MS  = 2000
const TARGET_MS    = 1000 / 60  // reference frame time (60 fps)

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
  /** 
   * Optional predetermined outcome (1-6). When set, the dice will land on this value.
   * Perfect for multiplayer where one player rolls and others see the same result.
   */
  targetValue?: number
  /**
   * Optional hold duration in milliseconds. Used for cross-device multiplayer sync.
   * When set, overrides the local hold time calculation with the roller's hold time.
   * Send this value from roller to spectators along with targetValue.
   */
  holdDuration?: number
}

export function CoinDice({ pressing, pressStart, onResult, targetValue, holdDuration }: CoinDiceProps) {
  // Only phase + result drive React renders — faces & transform are pure DOM
  const [phase, setPhase]   = useState<Phase>('idle')
  const [result, setResult] = useState<number | null>(null)

  const coinRef        = useRef<HTMLDivElement>(null)
  const frontFaceElRef = useRef<HTMLDivElement>(null)
  const backFaceElRef  = useRef<HTMLDivElement>(null)

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
  const lastTickTimeRef = useRef<number>(0)
  const targetLockRef   = useRef(false)

  const setCoinTransform = (deg: number, transition?: string) => {
    const el = coinRef.current
    if (!el) return
    el.style.transition = transition ?? ''
    el.style.transform  = `rotateY(${deg}deg)`
  }

  const setPhaseSync = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  // tick receives the RAF high-res timestamp for delta-time–normalised physics
  const tick = useCallback((now: number) => {
    // Normalise elapsed time to 60 fps so physics is framerate-independent.
    // Clamp to 3× target to avoid huge jumps after tab switches.
    const raw = lastTickTimeRef.current ? now - lastTickTimeRef.current : TARGET_MS
    const dt  = Math.min(raw, TARGET_MS * 3) / TARGET_MS
    lastTickTimeRef.current = now

    const ph = phaseRef.current

    if (ph === 'spinning') {
      velRef.current = Math.min(velRef.current + ACCEL * dt, MAX_VEL)

    } else if (ph === 'settling') {
      velRef.current *= Math.pow(decelRef.current, dt)

      const pastTarget      = angleRef.current >= casinoTargetRef.current
      const nearlyStop      = velRef.current < 0.25
      const essentiallyStop = velRef.current < 0.05
      if ((pastTarget && nearlyStop) || essentiallyStop) {
        velRef.current = 0
        // Determine which face is currently forward
        const isBackShowing   = lastHalfRotRef.current % 2 === 1
        // Use the visible face (which was strategically placed during settling)
        const resultFaceValue = isBackShowing ? backFaceRef.current : frontFaceRef.current
        frontFaceRef.current  = resultFaceValue
        setFaceEl(frontFaceElRef.current, resultFaceValue)
        // Snap to nearest 0° (front-face-forward)
        snapAngleRef.current = Math.round(angleRef.current / 360) * 360
        phaseRef.current = 'snapping'
        setPhase('snapping')
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

    angleRef.current += velRef.current * dt

    // Randomise hidden face at each half-rotation — pure DOM, no React re-render
    if (ph === 'spinning' || ph === 'settling') {
      const halfRot = Math.floor((angleRef.current + 90) / 180)
      if (halfRot !== lastHalfRotRef.current) {
        lastHalfRotRef.current = halfRot
        
        // In settling mode with targetValue, strategically place the target
        if (ph === 'settling' && targetValue && !targetLockRef.current) {
          const currentAngle = angleRef.current
          const targetAngle = casinoTargetRef.current
          const remainingRotation = targetAngle - currentAngle
          const remainingHalfRots = Math.floor(remainingRotation / 180)
          
          // If we're within the last few flips, lock in the target value
          if (remainingHalfRots <= 2) {
            targetLockRef.current = true
            // Determine if target angle will show front or back
            const finalHalfRot = Math.floor((targetAngle + 90) / 180)
            const willShowFront = finalHalfRot % 2 === 0
            
            if (willShowFront) {
              // Target needs to be on front face
              frontFaceRef.current = targetValue
              setFaceEl(frontFaceElRef.current, targetValue)
              // Back can be anything different
              backFaceRef.current = randomFace(targetValue)
              setFaceEl(backFaceElRef.current, backFaceRef.current)
            } else {
              // Target needs to be on back face
              backFaceRef.current = targetValue
              setFaceEl(backFaceElRef.current, targetValue)
              // Front can be anything different
              frontFaceRef.current = randomFace(targetValue)
              setFaceEl(frontFaceElRef.current, frontFaceRef.current)
            }
            return // Skip normal randomization
          }
        }
        
        // Normal randomization for spinning or early settling
        if (halfRot % 2 === 1) {
          // Back now visible — randomise hidden front
          const next = randomFace(backFaceRef.current)
          frontFaceRef.current = next
          setFaceEl(frontFaceElRef.current, next)
        } else {
          // Front now visible — randomise hidden back
          const next = randomFace(frontFaceRef.current)
          backFaceRef.current = next
          setFaceEl(backFaceElRef.current, next)
        }
      }
    }

    setCoinTransform(angleRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }, [onResult])

  // ── React to external pressing signal ─────────────────────────────────────
  useEffect(() => {
    if (pressing) {
      const ph = phaseRef.current
      if (ph === 'snapping') return
      cancelAnimationFrame(rafRef.current)
      if (snapTimerRef.current) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
      lastHalfRotRef.current  = Math.floor((angleRef.current + 90) / 180)
      lastTickTimeRef.current = 0  // reset dt on new press
      targetLockRef.current = false  // reset target lock
      setResult(null)
      resultRef.current = null
      const newBack = randomFace(frontFaceRef.current)
      backFaceRef.current = newBack
      setFaceEl(frontFaceElRef.current, frontFaceRef.current)
      setFaceEl(backFaceElRef.current,  newBack)
      velRef.current = ph === 'landed' ? 3 : velRef.current || 3
      setPhaseSync('spinning')
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (phaseRef.current !== 'spinning') return
      // Use provided holdDuration for multiplayer sync, or calculate locally
      const holdMs = holdDuration ?? (Date.now() - pressStart)
      const t      = Math.min(holdMs / MAX_HOLD_MS, 1)
      decelRef.current = DECEL_MIN + t * (DECEL_MAX - DECEL_MIN)
      const baseCoast     = COAST_MIN + t * (COAST_MAX - COAST_MIN)
      const extraRotation = baseCoast * (0.85 + Math.random() * 0.3)
      casinoTargetRef.current = angleRef.current + extraRotation
      // Ensure enough velocity to actually coast to target
      const minVel = (extraRotation / TARGET_MS) * (1 - decelRef.current)
      velRef.current = Math.min(Math.max(velRef.current, minVel), MAX_VEL)
      setPhaseSync('settling')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressing])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
  }, [])

  // Sync face DOM when going back to idle (after mount / diceCount reset)
  useEffect(() => {
    if (phase === 'idle') setFaceEl(frontFaceElRef.current, 'idle')
  }, [phase])

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
              const snap = snapAngleRef.current
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
            {/* Faces: content is written via setFaceEl (direct DOM), not React state */}
            <div ref={frontFaceElRef} className={`${styles.face} ${styles.faceFront}`} />
            <div ref={backFaceElRef}  className={`${styles.face} ${styles.faceBack}`} />

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
