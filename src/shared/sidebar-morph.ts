/**
 * The sidebar's two shapes changing into one another — the tab list becoming the icon rail, or
 * the rail opening back into the list — as one continuous change rather than one column
 * vanishing and another appearing.
 *
 * Everything the two shapes have in common is a site's mark: each one travels from where the old
 * shape drew it to where the new one does, on the same curve the card's width travels on, so the
 * column reads as one surface. What only the old shape had fades where it stood; what only the
 * new shape has fades in around the marks.
 *
 * Every step is a transform or an opacity, carried by the compositor. The only measuring is once
 * before the change (capture) and once after (the flight destinations). The planning is pure and
 * unit-tested; the capture and play below are thin DOM glue around it.
 */
import { SIDEBAR_MOTION_MS, sidebarMotionEasingCss } from "./sidebar-motion";

/** A shape or mark's bounding box, in viewport coordinates. */
export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The outgoing shape, measured before it left the document. */
export interface MorphSnapshot {
  /** The outgoing shape's root (still referenced after it is detached from the host). */
  column: HTMLElement | null;
  /** The host the shapes swap inside (the sidebar body). */
  host: HTMLElement;
  /** The outgoing shape's rect, in viewport coordinates. */
  rect: MarkRect;
  /** `data-motion-key` → the mark's rect: the part of each counterpart the eye follows. */
  marks: Record<string, MarkRect>;
  /** Scrollers and their offsets, which an element loses when it leaves the document. */
  scrolled: [HTMLElement, number][];
}

/** A keyed element of the incoming shape, measured once it is drawn. */
export interface MorphTarget {
  element: HTMLElement;
  key: string | null;
  rect: MarkRect | null;
  /** Its titles, measured on the DOM side so the plan stays pure. */
  labels: HTMLElement[];
}

/** One travelling element and how far it must move. */
export interface FlightPlan {
  element: HTMLElement;
  dx: number;
  dy: number;
  /**
   * The mark lands in the part of the card the card does not show yet (it is growing on the
   * open/close timeline): it waits for room, then travels on the slow-out curve that keeps it
   * behind the card's moving edge.
   */
  trailing: boolean;
  /** The mark's destination right edge, in viewport coordinates, for the room check. */
  roomRight: number;
}

export interface MorphPlan {
  flights: FlightPlan[];
  /** Titles that arrive behind their marks. */
  labels: HTMLElement[];
  /** Keyed elements whose marks are settled (they hold while their surroundings arrive). */
  settled: HTMLElement[];
  /** Longest animation the plan runs, so the caller knows when the morph has landed. */
  durationMs: number;
}

/** The card's open/close curve (shared/sidebar-motion.ts): marks travel with it. */
export const MORPH_EASING = sidebarMotionEasingCss();
/** Slow out of the shape and settling late, so a mark stays behind the card's moving edge. */
export const MORPH_TRAILING_EASING = "cubic-bezier(0.55, 0, 0.25, 1)";
/** Trailing marks take a little longer than the card so the edge leads them all the way. */
export const MORPH_TRAILING_FACTOR = 1.15;
/** New-only parts fade in on a slow beat, arriving behind the marks. */
export const MORPH_LABEL_MS = 300;
export const MORPH_LABEL_DELAY_MS = 120;
/** The outgoing shape's exit fade. */
export const MORPH_FADE_MS = 200;
/** A mark that must wait for room is released by the fallback if the card never gives it. */
export const MORPH_ROOM_FALLBACK_MS =
  Math.round(SIDEBAR_MOTION_MS * MORPH_TRAILING_FACTOR) + 80;
/** How long the incoming column holds its final width: the card's whole transition, plus slack. */
export const MORPH_RESHAPE_MS = SIDEBAR_MOTION_MS + 40;

/** The class both shapes carry, so the host's current shape is found without knowing which. */
export const MORPH_COLUMN_CLASS = "sidebar-morph-column";
/** The class the outgoing shape takes when it is re-attached and faded. */
export const MORPH_GHOST_CLASS = "sidebar-morph-ghost";
/**
 * The class the inactive shape keeps while it stays mounted (out of flow and invisible): the
 * framework keeps drawing it — automation and smokes read its DOM — but it neither shows nor
 * hit-tests.
 */
export const MORPH_HIDDEN_CLASS = "is-shape-hidden";
/** The shape on screen: the only column that is neither hidden nor a fading ghost. */
export const ACTIVE_COLUMN_SELECTOR = `:scope > .${MORPH_COLUMN_CLASS}:not(.${MORPH_HIDDEN_CLASS}):not(.${MORPH_GHOST_CLASS})`;
/** The part of a counterpart the eye follows: its site's mark, if it has one. */
const MARK_SELECTOR = ".tab-favicon, .pinned-site-mark";
/** The new surroundings of a travelling mark. */
const LABEL_SELECTOR = ".tab-title";
/** Scrollers whose offsets are measured, so the outgoing shape fades where it stood. */
const SCROLLER_SELECTOR = "[data-glide-scroller]";
const COUNTERPARTS = "[data-motion-key], [data-morph]";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function keyOf(element: HTMLElement): string | null {
  return element.dataset.motionKey ?? element.dataset.morph ?? null;
}

export function markOf(element: HTMLElement): HTMLElement {
  return element.querySelector(MARK_SELECTOR) ?? element;
}

/** On screen, not merely in the document: a row scrolled out of view has nothing to follow from. */
export function shownRect(element: Element): MarkRect | null {
  if (element.getClientRects().length === 0) return null;
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectOf(element: Element): MarkRect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Before the change: where the current shape is, and where every one of its marks is drawn. */
export function captureSidebarMorph(
  host: HTMLElement | null,
): MorphSnapshot | null {
  if (!host || prefersReducedMotion()) return null;
  const column = host.querySelector<HTMLElement>(ACTIVE_COLUMN_SELECTOR);
  if (!column) return null;
  const marks: Record<string, MarkRect> = {};
  for (const element of column.querySelectorAll<HTMLElement>(COUNTERPARTS)) {
    const key = keyOf(element);
    const rect = shownRect(markOf(element));
    if (key && rect) marks[key] = rect;
  }
  return {
    column,
    host,
    rect: rectOf(column),
    marks,
    scrolled: [...column.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR)].map(
      (scroller): [HTMLElement, number] => [scroller, scroller.scrollTop],
    ),
  };
}

/** Measure the incoming shape's keyed marks and titles, in the order they are drawn. */
export function measureSidebarTargets(column: HTMLElement): MorphTarget[] {
  return [...column.querySelectorAll<HTMLElement>(COUNTERPARTS)].map(
    (element) => ({
      element,
      key: keyOf(element),
      rect: shownRect(markOf(element)),
      labels: [...element.querySelectorAll<HTMLElement>(LABEL_SELECTOR)],
    }),
  );
}

/**
 * The flight plan for a shape change. Pure: everything in is numbers, everything out is
 * numbers, so it is tested without a document. `edgeFrom` is the outgoing shape's right edge;
 * `widening` says the incoming shape is wider than it (the card is growing to reveal it).
 */
export function planSidebarMorph(
  marks: Record<string, MarkRect>,
  targets: MorphTarget[],
  { edgeFrom, widening }: { edgeFrom: number; widening: boolean },
): MorphPlan {
  const flights: FlightPlan[] = [];
  const labels: HTMLElement[] = [];
  const settled: HTMLElement[] = [];
  let durationMs = 0;
  for (const target of targets) {
    if (!target.element) continue;
    const from = target.key ? marks[target.key] : undefined;
    const to = target.rect;
    if (!from || !to) continue;
    labels.push(...target.labels);
    const dx = from.x + from.width / 2 - (to.x + to.width / 2);
    const dy = from.y + from.height / 2 - (to.y + to.height / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      // The mark stands where it should; its surroundings simply arrive.
      settled.push(target.element);
      durationMs = Math.max(durationMs, MORPH_LABEL_MS + MORPH_LABEL_DELAY_MS);
      continue;
    }
    const trailing = widening && to.x + to.width / 2 > edgeFrom;
    flights.push({
      element: target.element,
      dx,
      dy,
      trailing,
      roomRight: to.x + to.width,
    });
    durationMs = Math.max(
      durationMs,
      MORPH_ROOM_FALLBACK_MS +
        SIDEBAR_MOTION_MS * (trailing ? MORPH_TRAILING_FACTOR : 1),
    );
  }
  return {
    flights,
    labels,
    settled,
    durationMs: Math.max(durationMs, MORPH_FADE_MS),
  };
}

/**
 * Play the captured change: the outgoing shape fades where it stood, every travelling mark
 * flies to its destination, and whatever the old shape did not have fades in. Returns how long
 * the whole thing takes (0: reduced motion, or nothing to play).
 */
export function playSidebarMorph(
  snapshot: MorphSnapshot | null,
  host: HTMLElement,
): number {
  if (!snapshot || prefersReducedMotion()) return 0;
  const incoming = host.querySelector<HTMLElement>(ACTIVE_COLUMN_SELECTOR);
  if (!incoming || incoming === snapshot.column) return 0;
  // A re-toggle while an earlier morph is still running: drop the earlier ghost (it has faded or
  // is mid-fade) so the host holds exactly one outgoing shape.
  for (const ghost of host.querySelectorAll<HTMLElement>(
    `:scope > .${MORPH_GHOST_CLASS}`,
  ))
    ghost.remove();
  releaseColumn(snapshot);
  const card = host.parentElement ?? host;
  const oldRight = snapshot.rect.x + snapshot.rect.width;
  const newRight = incoming.getBoundingClientRect().right;
  const plan = planSidebarMorph(
    snapshot.marks,
    measureSidebarTargets(incoming),
    {
      edgeFrom: oldRight,
      widening: newRight - oldRight > 1,
    },
  );
  let total = MORPH_FADE_MS;
  for (const flight of plan.flights) {
    const durationMs =
      SIDEBAR_MOTION_MS * (flight.trailing ? MORPH_TRAILING_FACTOR : 1);
    const animation = flight.element.animate(
      [
        { transform: `translate(${flight.dx}px, ${flight.dy}px)` },
        { transform: "none" },
      ],
      {
        duration: durationMs,
        easing: flight.trailing ? MORPH_TRAILING_EASING : MORPH_EASING,
        fill: "backwards",
      },
    );
    if (flight.trailing) holdUntilRoom(animation, flight, card);
    total = Math.max(total, durationMs);
  }
  for (const label of plan.labels)
    label.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: MORPH_LABEL_MS,
      delay: MORPH_LABEL_DELAY_MS,
      easing: MORPH_EASING,
      fill: "backwards",
    });
  // Whatever in the incoming shape has no counterpart in the old one fades in: the parts the
  // eye follows are the marks, which are already drawn throughout.
  const travelling = new Set<HTMLElement>();
  for (const flight of plan.flights) travelling.add(flight.element);
  for (const element of plan.settled) travelling.add(element);
  revealColumn(incoming, travelling);
  total = Math.max(
    total,
    MORPH_LABEL_MS + MORPH_LABEL_DELAY_MS,
    MORPH_ROOM_FALLBACK_MS + SIDEBAR_MOTION_MS * MORPH_TRAILING_FACTOR,
  );
  return total;
}

/**
 * Fades in whatever in `root` has no counterpart, at the highest level at which it has none, so
 * each travelling mark stays fully drawn throughout.
 */
function revealColumn(root: HTMLElement, travelling: Set<HTMLElement>): void {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || travelling.has(child)) continue;
    let holds = false;
    for (const element of travelling) {
      if (child.contains(element)) {
        holds = true;
        break;
      }
    }
    if (holds) {
      revealColumn(child, travelling);
      continue;
    }
    child.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: MORPH_LABEL_MS,
      delay: MORPH_LABEL_DELAY_MS * 0.6,
      easing: MORPH_EASING,
      fill: "backwards",
    });
  }
}

/**
 * The card is still growing (on the open/close timeline) where a trailing mark is bound: the
 * mark would be drawn outside it, where the card's clip shows nothing. It waits, still where it
 * was, until the card is wide enough — or until the fallback, in case the card never gets there.
 */
function holdUntilRoom(
  flight: Animation,
  plan: FlightPlan,
  card: HTMLElement,
): void {
  flight.pause();
  let frame = 0;
  const check = (): void => {
    const cardRect = card.getBoundingClientRect();
    const localRight = plan.roomRight - cardRect.left;
    if (cardRect.width >= localRight - 1 || flight.playState !== "paused") {
      flight.play();
      return;
    }
    frame = requestAnimationFrame(check);
  };
  frame = requestAnimationFrame(check);
  setTimeout(() => {
    cancelAnimationFrame(frame);
    if (flight.playState === "paused") flight.play();
  }, MORPH_ROOM_FALLBACK_MS);
}

/**
 * The old shape, back for a moment where it was: its marks withdrawn because they are
 * travelling, made unreachable, and faded out. The real column stays in the component tree
 * (hidden there for the DOM that automation and smokes read), so the ghost is a pixel copy of
 * it: the copy leaves the document once it has faded, and the framework never touches it.
 */
function releaseColumn(snapshot: MorphSnapshot): void {
  const { column, host, rect } = snapshot;
  if (!column || !host.isConnected) return;
  const ghost = column.cloneNode(true) as HTMLElement;
  // The copy inherits the hidden shape's classes; the ghost is the one that shows and fades.
  ghost.classList.remove(MORPH_HIDDEN_CLASS);
  ghost.classList.remove(MORPH_COLUMN_CLASS);
  ghost.classList.add(MORPH_GHOST_CLASS);
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    for (const name of node.getAttributeNames()) {
      if (name === "data-motion-key" || name === "data-morph")
        node.removeAttribute(name);
    }
  }
  for (const mark of ghost.querySelectorAll<HTMLElement>(MARK_SELECTOR))
    mark.style.visibility = "hidden";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  const bounds = host.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${rect.x - bounds.x}px`,
    top: `${rect.y - bounds.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  host.append(ghost);
  // The copy's scrollers start at the top; restore the offsets the snapshot captured.
  const ghostScrollers = ghost.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR);
  snapshot.scrolled.forEach(([_, top], i) => {
    const scroller = ghostScrollers[i];
    if (scroller) scroller.scrollTop = top;
  });
  const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: MORPH_FADE_MS,
    easing: MORPH_EASING,
    fill: "forwards",
  });
  void fade.finished.catch(() => undefined).then(() => ghost.remove());
}
