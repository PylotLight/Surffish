import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverDismiss } from '../../lib/popover-dismiss'
import './surffish-egg.css'

// A stylised fish (nose at +x), drawn around the origin so it can ride an offset-path.
const FISH = 'M34 0C26-10 10-15-6-11-15-9-22-4-27 0-22 4-15 9-6 11 10 15 26 10 34 0ZM-27 0-42-12C-40-5-40 5-42 12Z'
// The orbit ring of the logo, as a path the fish swims along (an ellipse, tilted by the group).
const ORBIT = 'M-330 0A330 120 0 1 0 330 0A330 120 0 1 0-330 0'
const BUBBLES = [
  { x: 8, size: 10, delay: 0, duration: 9 },
  { x: 17, size: 6, delay: 2.4, duration: 7.5 },
  { x: 29, size: 14, delay: 4.1, duration: 11 },
  { x: 41, size: 7, delay: 1.2, duration: 8 },
  { x: 58, size: 11, delay: 3.3, duration: 10 },
  { x: 66, size: 5, delay: 5.6, duration: 7 },
  { x: 77, size: 13, delay: 0.8, duration: 12 },
  { x: 88, size: 8, delay: 2.9, duration: 9.5 },
  { x: 94, size: 6, delay: 6.2, duration: 8.5 }
]
const SPARKS = [
  [12, 18], [22, 9], [35, 22], [47, 7], [63, 14], [74, 6], [86, 19], [93, 10], [7, 40], [91, 44], [16, 62], [84, 66]
]

/** The fish riding the orbit ring (SMIL motion: SVG motion paths on <g> are patchy in CSS). */
function FishRider({ still }: { still: boolean }): JSX.Element {
  return (
    <g className="surffish-egg-fish-rider" transform={still ? 'translate(250 78) rotate(160)' : undefined}>
      {!still && <animateMotion dur="9s" repeatCount="indefinite" rotate="auto" path={ORBIT} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />}
      <path d={FISH} fill="url(#surffish-egg-fish)" />
      <circle cx="22" cy="-3" r="2.6" fill="#05223f" />
    </g>
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The logo easter egg: a near-window-sized card with the Surffish logo floating on an animated sea
 * (orbit ring, a fish swimming the ring, waves, bubbles, sparkles). Pure CSS/SVG, no new assets
 * (the logo is the toolbar's own icon). Closes on a click anywhere, Escape, or anything that closes
 * a popover. prefers-reduced-motion gets the same scene, still.
 */
export default function SurffishEgg({ onClose }: { onClose: () => void }): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [still] = useState(prefersReducedMotion)
  // Escape, window blur, tab switch, … (a click anywhere is handled below: the card fills the view).
  usePopoverDismiss(true, dialogRef, onClose, { preventEscapeDefault: true })
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])
  return createPortal(
    <div className="surffish-egg-root">
      <div
        ref={dialogRef}
        className={`surffish-egg${still ? ' is-still' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Surffish"
        tabIndex={-1}
        onClick={onClose}
      >
        <div className="surffish-egg-sky" aria-hidden="true">
          {SPARKS.map(([x, y], index) => <span key={index} className="surffish-egg-spark" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${(index * 0.37) % 3}s` }} />)}
        </div>
        <div className="surffish-egg-stage" aria-hidden="true">
          <div className="surffish-egg-glow" />
          <svg className="surffish-egg-orbit is-back" viewBox="-400 -200 800 400">
            <defs>
              <linearGradient id="surffish-egg-fish" x1="0" x2="1">
                <stop offset="0" stopColor="#3aa0ff" />
                <stop offset="1" stopColor="#9ef0ff" />
              </linearGradient>
              <clipPath id="surffish-egg-back-half">
                <rect x="-400" y="-200" width="800" height="188" />
              </clipPath>
              <clipPath id="surffish-egg-front-half">
                <rect x="-400" y="-12" width="800" height="212" />
              </clipPath>
            </defs>
            <g transform="rotate(-18)">
              <path d={ORBIT} className="surffish-egg-ring" pathLength={100} />
              <g clipPath="url(#surffish-egg-back-half)" opacity="0.55"><FishRider still={still} /></g>
            </g>
          </svg>
          <div className="surffish-egg-logo">
            <img src="./surffish-brand-icon.png" alt="" draggable={false} />
            <span className="surffish-egg-shine" />
          </div>
          <svg className="surffish-egg-orbit is-front" viewBox="-400 -200 800 400">
            <g transform="rotate(-18)">
              <path d={ORBIT} className="surffish-egg-ring is-front" pathLength={100} clipPath="url(#surffish-egg-front-half)" />
              <g clipPath="url(#surffish-egg-front-half)"><FishRider still={still} /></g>
            </g>
          </svg>
        </div>
        <div className="surffish-egg-sea" aria-hidden="true">
          {BUBBLES.map((bubble, index) => (
            <span key={index} className="surffish-egg-bubble" style={{ left: `${bubble.x}%`, width: bubble.size, height: bubble.size, animationDelay: `${bubble.delay}s`, animationDuration: `${bubble.duration}s` }} />
          ))}
          <svg className="surffish-egg-wave is-far" viewBox="0 0 1600 200" preserveAspectRatio="none"><path d="M0 90C200 40 400 140 600 90S1000 40 1200 90 1400 140 1600 90V200H0Z" /></svg>
          <svg className="surffish-egg-wave is-mid" viewBox="0 0 1600 200" preserveAspectRatio="none"><path d="M0 110C150 70 250 150 400 110S650 70 800 110 1050 150 1200 110 1450 70 1600 110V200H0Z" /></svg>
          <svg className="surffish-egg-wave is-near" viewBox="0 0 1600 200" preserveAspectRatio="none"><path d="M0 130C200 100 300 170 500 130S800 100 1000 130 1300 170 1600 130V200H0Z" /></svg>
        </div>
        <div className="surffish-egg-caption">
          <strong>Surffish</strong>
          <span>you found the wave · click anywhere or press Esc</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
