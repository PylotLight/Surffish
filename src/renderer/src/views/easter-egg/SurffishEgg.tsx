import { useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { usePopoverDismiss } from "../../lib/popover-dismiss";
import "./surffish-egg.css";

// A stylised fish (nose at +x), drawn around the origin so it can ride an offset-path.
const FISH =
  "M34 0C26-10 10-15-6-11-15-9-22-4-27 0-22 4-15 9-6 11 10 15 26 10 34 0ZM-27 0-42-12C-40-5-40 5-42 12Z";
// The orbit ring of the logo, as a path the fish swims along (an ellipse, tilted by the group).
const ORBIT = "M-330 0A330 120 0 1 0 330 0A330 120 0 1 0-330 0";
const BUBBLES = [
  { x: 8, size: 10, delay: 0, duration: 9 },
  { x: 17, size: 6, delay: 2.4, duration: 7.5 },
  { x: 29, size: 14, delay: 4.1, duration: 11 },
  { x: 41, size: 7, delay: 1.2, duration: 8 },
  { x: 58, size: 11, delay: 3.3, duration: 10 },
  { x: 66, size: 5, delay: 5.6, duration: 7 },
  { x: 77, size: 13, delay: 0.8, duration: 12 },
  { x: 88, size: 8, delay: 2.9, duration: 9.5 },
  { x: 94, size: 6, delay: 6.2, duration: 8.5 },
];
const SPARKS = [
  [12, 18],
  [22, 9],
  [35, 22],
  [47, 7],
  [63, 14],
  [74, 6],
  [86, 19],
  [93, 10],
  [7, 40],
  [91, 44],
  [16, 62],
  [84, 66],
];

// One lap of the fish. The ring's dashes drift the same way at half speed, so the fish laps the
// dash pattern once every RING_SECONDS: that's the period its fade in/out of the gaps repeats on.
const FISH_SECONDS = 9;
const RING_SECONDS = FISH_SECONDS * 2;
// The ring's dash pattern (pathLength 100): dash 0–62, gap, dash 68–70, gap, dash 76–86, gap 86–100.
const RING_DASHES = "62 6 2 6 10 14";
// Fish opacity against its position in the dash pattern (= keyTime × 100, see RING_SECONDS):
// it slips under the water at each gap and surfaces again at the next dash; the 2-unit dash is a
// quick half-glimpse. Ramps straddle each dash edge by ~1.5 units (about a third of the fish).
const FISH_FADE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5],
  [1.5, 1],
  [60.5, 1],
  [63.5, 0],
  [67, 0],
  [69, 0.6],
  [71, 0],
  [74.5, 0],
  [77.5, 1],
  [84.5, 1],
  [87.5, 0],
  [98.5, 0],
  [100, 0.5],
];
const FISH_FADE_TIMES = FISH_FADE.map(([at]) => at / 100).join(";");
const FISH_FADE_VALUES = FISH_FADE.map(([, value]) => value).join(";");

/** The orbit ring; its dash drift is SMIL so it shares a clock with the fish (the fade depends on it). */
function Ring({
  still,
  front,
}: {
  still: boolean;
  front?: boolean;
}): JSX.Element {
  return (
    <path
      d={ORBIT}
      className={`surffish-egg-ring${front ? " is-front" : ""}`}
      pathLength={100}
      strokeDasharray={RING_DASHES}
      mask={front ? "url(#surffish-egg-front-mask)" : undefined}
    >
      {!still && (
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-100"
          dur={`${RING_SECONDS}s`}
          repeatCount="indefinite"
        />
      )}
    </path>
  );
}

/**
 * The fish riding the orbit ring, nose first (SMIL motion: SVG motion paths on <g> are patchy in
 * CSS). It fades out over the ring's gaps and swims with a small bob and tail wag.
 */
function FishRider({ still }: { still: boolean }): JSX.Element {
  return (
    <g
      className="surffish-egg-fish-rider"
      transform={still ? "translate(250 78) rotate(160)" : undefined}
    >
      {!still && (
        <animateMotion
          dur={`${FISH_SECONDS}s`}
          repeatCount="indefinite"
          rotate="auto"
          path={ORBIT}
          calcMode="linear"
        />
      )}
      {!still && (
        <animate
          attributeName="opacity"
          dur={`${RING_SECONDS}s`}
          repeatCount="indefinite"
          keyTimes={FISH_FADE_TIMES}
          values={FISH_FADE_VALUES}
          calcMode="linear"
        />
      )}
      <g>
        {/* Bob across the line (local y is perpendicular to the path) and wag a little. */}
        {!still && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 -5;0 0;0 5;0 0"
            dur="1.8s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.25;0.5;0.75;1"
            keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"
          />
        )}
        {!still && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0;-7;0;7;0"
            dur="0.9s"
            repeatCount="indefinite"
            additive="sum"
            calcMode="spline"
            keyTimes="0;0.25;0.5;0.75;1"
            keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"
          />
        )}
        <path d={FISH} fill="url(#surffish-egg-fish)" />
        <circle cx="22" cy="-3" r="2.6" fill="#05223f" />
      </g>
    </g>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The logo easter egg: a near-window-sized card with the Surffish logo floating on an animated sea
 * (orbit ring, a fish swimming the ring, waves, bubbles, sparkles). Pure CSS/SVG, no new assets
 * (the logo is the toolbar's own icon). Closes on a click anywhere, Escape, or anything that closes
 * a popover. prefers-reduced-motion gets the same scene, still.
 */
export default function SurffishEgg({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [still] = useState(prefersReducedMotion);
  // Escape, window blur, tab switch, … (a click anywhere is handled below: the card fills the view).
  usePopoverDismiss(true, dialogRef, onClose, { preventEscapeDefault: true });
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  return createPortal(
    <div className="surffish-egg-root">
      <div
        ref={dialogRef}
        className={`surffish-egg${still ? " is-still" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Surffish"
        tabIndex={-1}
        onClick={onClose}
      >
        <div className="surffish-egg-sky" aria-hidden="true">
          {SPARKS.map(([x, y], index) => (
            <span
              key={index}
              className="surffish-egg-spark"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                animationDelay: `${(index * 0.37) % 3}s`,
              }}
            />
          ))}
        </div>
        <div className="surffish-egg-stage" aria-hidden="true">
          <div className="surffish-egg-glow" />
          <svg
            className="surffish-egg-orbit is-back"
            viewBox="-400 -200 800 400"
          >
            <defs>
              <linearGradient id="surffish-egg-fish" x1="0" x2="1">
                <stop offset="0" stopColor="#3aa0ff" />
                <stop offset="1" stopColor="#9ef0ff" />
              </linearGradient>
              {/* Depth: the half of the ring behind the logo is dimmer. A soft band (not a hard clip)
                  so the fish fades from back to front instead of snapping at a seam. */}
              <linearGradient
                id="surffish-egg-depth"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="-44"
                x2="0"
                y2="20"
              >
                <stop offset="0" stopColor="#000" />
                <stop offset="1" stopColor="#fff" />
              </linearGradient>
              <linearGradient
                id="surffish-egg-depth-back"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="-44"
                x2="0"
                y2="20"
              >
                <stop offset="0" stopColor="#fff" />
                <stop offset="1" stopColor="#000" />
              </linearGradient>
              <mask
                id="surffish-egg-back-mask"
                maskUnits="userSpaceOnUse"
                x="-400"
                y="-200"
                width="800"
                height="400"
              >
                <rect
                  x="-400"
                  y="-200"
                  width="800"
                  height="400"
                  fill="url(#surffish-egg-depth-back)"
                />
              </mask>
              <mask
                id="surffish-egg-front-mask"
                maskUnits="userSpaceOnUse"
                x="-400"
                y="-200"
                width="800"
                height="400"
              >
                <rect
                  x="-400"
                  y="-200"
                  width="800"
                  height="400"
                  fill="url(#surffish-egg-depth)"
                />
              </mask>
            </defs>
            <g transform="rotate(-18)">
              <Ring still={still} />
              <g mask="url(#surffish-egg-back-mask)" opacity="0.55">
                <FishRider still={still} />
              </g>
            </g>
          </svg>
          <div className="surffish-egg-logo">
            <img src="./surffish-brand-icon.png" alt="" draggable={false} />
            <span className="surffish-egg-shine" />
          </div>
          <svg
            className="surffish-egg-orbit is-front"
            viewBox="-400 -200 800 400"
          >
            <g transform="rotate(-18)">
              <Ring still={still} front />
              <g mask="url(#surffish-egg-front-mask)">
                <FishRider still={still} />
              </g>
            </g>
          </svg>
        </div>
        <div className="surffish-egg-sea" aria-hidden="true">
          {BUBBLES.map((bubble, index) => (
            <span
              key={index}
              className="surffish-egg-bubble"
              style={{
                left: `${bubble.x}%`,
                width: bubble.size,
                height: bubble.size,
                animationDelay: `${bubble.delay}s`,
                animationDuration: `${bubble.duration}s`,
              }}
            />
          ))}
          <svg
            className="surffish-egg-wave is-far"
            viewBox="0 0 1600 200"
            preserveAspectRatio="none"
          >
            <path d="M0 90C200 40 400 140 600 90S1000 40 1200 90 1400 140 1600 90V200H0Z" />
          </svg>
          <svg
            className="surffish-egg-wave is-mid"
            viewBox="0 0 1600 200"
            preserveAspectRatio="none"
          >
            <path d="M0 110C150 70 250 150 400 110S650 70 800 110 1050 150 1200 110 1450 70 1600 110V200H0Z" />
          </svg>
          <svg
            className="surffish-egg-wave is-near"
            viewBox="0 0 1600 200"
            preserveAspectRatio="none"
          >
            <path d="M0 130C200 100 300 170 500 130S800 100 1000 130 1300 170 1600 130V200H0Z" />
          </svg>
        </div>
        <div className="surffish-egg-caption">
          <strong>Surffish</strong>
          <span>you found the wave · click anywhere or press Esc</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
