/**
 * The sidebar's two shapes changing into one another — the tab list becoming the icon rail, or
 * the rail opening back into the list — as one continuous change rather than one column
 * vanishing and another appearing.
 *
 * Marks shared by the two shapes travel between their measured positions. Ordinary marks follow
 * the card curve; pinned favicons use a gentler ease-in-out over the same duration, so the compact
 * cluster spreads or gathers without a front-loaded jump. What only the old shape had fades where
 * it stood; what only the new shape has fades in around the marks.
 *
 * Every step is a transform or an opacity, carried by the compositor. The only measuring is once
 * before the change (capture) and once after (the flight destinations). The planning is pure and
 * unit-tested; the capture and play below are thin DOM glue around it.
 */
import { SIDEBAR_MOTION_MS, sidebarMotionEasingCss } from "./sidebar-motion";
import { isPinMotionKey } from "./rail-pin-cluster";

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
/** Pin clusters glide at a balanced pace instead of inheriting the card's front-loaded departure. */
export const MORPH_PIN_EASING = "cubic-bezier(0.3, 0, 0.7, 1)";
/** Slow out of the shape and settling late, so a mark stays behind the card's moving edge. */
export const MORPH_TRAILING_EASING = "cubic-bezier(0.55, 0, 0.25, 1)";
/** Trailing marks take a little longer than the card so the edge leads them all the way. */
export const MORPH_TRAILING_FACTOR = 1.15;
/**
 * Titles and every other new-only part fade in a little behind the card's edge, on an eased
 * beat long enough to read as a fade at 30fps (the card's own expo curve would land them in a
 * frame or two).
 */
export const MORPH_LABEL_MS = 260;
export const MORPH_LABEL_DELAY_MS = 70;
/** Ease-out (quad): moves at once, settles gently, no linear pop at either end. */
export const MORPH_LABEL_EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
/** The outgoing shape's exit fade: shorter than the fade in, eased at both ends. */
export const MORPH_FADE_MS = 180;
export const MORPH_FADE_EASING = "cubic-bezier(0.37, 0, 0.63, 1)";
/**
 * A counterpart's own paint (the rail's active pill, the panel's active row) fades in while the
 * outgoing shape's copy of it fades out, so the highlight crossfades instead of popping.
 */
export const MORPH_PAINT_MS = 240;
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
const MARK_SELECTOR =
  ".tab-favicon, .pinned-site-mark, .sidebar-new-tab-row-icon";
/** The new surroundings of a travelling mark. */
const LABEL_SELECTOR = ".tab-title, .sidebar-new-tab-row-label";
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

/** Where each keyed mark of `column` is drawn now (`data-motion-key` -> its mark's rect). */
function measureMarks(column: HTMLElement): Record<string, MarkRect> {
  const marks: Record<string, MarkRect> = {};
  for (const element of column.querySelectorAll<HTMLElement>(COUNTERPARTS)) {
    const key = keyOf(element);
    const rect = shownRect(markOf(element));
    if (key && rect) marks[key] = rect;
  }
  return marks;
}

/** Before the change: where the current shape is, and where every one of its marks is drawn. */
export function captureSidebarMorph(
  host: HTMLElement | null,
): MorphSnapshot | null {
  if (!host) return null;
  const column = host.querySelector<HTMLElement>(ACTIVE_COLUMN_SELECTOR);
  if (!column) return null;
  return {
    column,
    host,
    rect: rectOf(column),
    marks: measureMarks(column),
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
  {
    edgeFrom,
    widening,
    hold = false,
    glide,
  }: {
    edgeFrom: number;
    widening: boolean;
    hold?: boolean;
    /**
     * Keys that travel even under `hold`: the pins, a stacked cluster in the rail and a row in the
     * panel. They glide over the card's duration with a gentle ease-in-out, never trailing: a pin
     * bound inside the card's final width stays inside its moving edge all the way, both ends being
     * inside it, so the row spreads out of the cluster or gathers into it smoothly.
     */
    glide?: (key: string) => boolean;
  },
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
    // Whole pixels: a fractional translate re-rasterises the mark (and any text riding with it)
    // off the pixel grid for the length of the flight, which reads as a shimmer.
    const dx = Math.round(from.x + from.width / 2 - (to.x + to.width / 2));
    const dy = Math.round(from.y + from.height / 2 - (to.y + to.height / 2));
    const gliding = Boolean(target.key && glide?.(target.key));
    if ((hold && !gliding) || (dx === 0 && dy === 0)) {
      // The mark stands where it should; its surroundings simply arrive.
      settled.push(target.element);
      durationMs = Math.max(durationMs, MORPH_LABEL_MS + MORPH_LABEL_DELAY_MS);
      continue;
    }
    const trailing = !gliding && widening && to.x + to.width / 2 > edgeFrom;
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
  captured: MorphSnapshot | null,
  host: HTMLElement,
): number {
  if (!captured) return 0;
  const snapshot = captured;
  // Reduced motion: nothing travels. The pins, which would glide between their cluster and row
  // slots, crossfade instead (their outgoing copies fade with the old shape, the new ones fade in);
  // everything else stands in place as it does with motion.
  const reduce = prefersReducedMotion();
  const incoming = host.querySelector<HTMLElement>(ACTIVE_COLUMN_SELECTOR);
  if (!incoming || incoming === snapshot.column) return 0;
  // A re-toggle while an earlier morph is still running: drop the earlier ghost (it has faded or
  // is mid-fade) so the host holds exactly one outgoing shape.
  for (const ghost of host.querySelectorAll<HTMLElement>(
    `:scope > .${MORPH_GHOST_CLASS}`,
  ))
    ghost.remove();
  lateArrivalWatchers.get(host)?.();
  const targets = measureSidebarTargets(incoming).map((target) =>
    reduce && target.key && isPinMotionKey(target.key)
      ? { ...target, key: null }
      : target,
  );
  const incomingKeys = new Set(
    targets.flatMap((target) => (target.key ? [target.key] : [])),
  );
  const oldRight = snapshot.rect.x + snapshot.rect.width;
  const newRight = incoming.getBoundingClientRect().right;
  releaseColumn(snapshot, incomingKeys);
  const card = host.parentElement ?? host;
  const plan = planSidebarMorph(snapshot.marks, targets, {
    edgeFrom: oldRight,
    widening: newRight - oldRight > 1,
    // The rail draws every mark where the panel does (SidebarRail's alignRailToPanel), so a
    // counterpart never travels: it is shown in place from the first frame. A measured
    // difference here is the outgoing shape being measured somewhere it is not drawn (a hidden
    // overlay view, a shape mid-reflow), and flying from it is the jitter. Pinned sites, a row
    // in the panel and one stacked cluster in the rail, are the exception: they are laid out on
    // the same line in the same order (rail-pin-cluster.ts), the first pin on the row's first, and
    // each glides between its cluster slot and its row slot; pins behind the "+N" chip have no
    // counterpart and fade where the row draws them.
    hold: true,
    glide: reduce ? undefined : isPinMotionKey,
  });
  let total = MORPH_FADE_MS;
  for (const flight of plan.flights) {
    const durationMs =
      SIDEBAR_MOTION_MS * (flight.trailing ? MORPH_TRAILING_FACTOR : 1);
    const key = flight.element.dataset.motionKey;
    const pinGlide = Boolean(key && isPinMotionKey(key));
    const animation = flight.element.animate(
      [
        { transform: `translate(${flight.dx}px, ${flight.dy}px)` },
        { transform: "none" },
      ],
      {
        duration: durationMs,
        easing: flight.trailing
          ? MORPH_TRAILING_EASING
          : pinGlide
            ? MORPH_PIN_EASING
            : MORPH_EASING,
        fill: "backwards",
      },
    );
    if (flight.trailing) holdUntilRoom(animation, flight, card);
    total = Math.max(total, durationMs);
  }
  // Whatever in the incoming shape has no counterpart in the old one fades in: the parts the
  // eye follows are the marks, which are already drawn throughout.
  const beat: LabelBeat = {
    present: new WeakSet(incoming.querySelectorAll("*")),
    faded: new WeakSet(),
    clock: null,
    startedAt: performance.now(),
  };
  const travelling = new Set<HTMLElement>();
  for (const flight of plan.flights) travelling.add(flight.element);
  for (const element of plan.settled) travelling.add(element);
  for (const element of travelling) {
    const mark = markOf(element);
    // A counterpart with no site mark (the sidebar pin) is one element drawn throughout: its
    // outgoing copy is withdrawn whole (releaseColumn), so it has nothing to crossfade.
    if (mark === element) continue;
    // Its own paint crossfades with the outgoing copy's (which keeps its paint and fades with the
    // ghost): the gradient is scaled by --sidebar-row-paint (Browser.css), the rest interpolate.
    element.animate(
      [
        {
          offset: 0,
          "--sidebar-row-paint": 0,
          backgroundColor: "transparent",
          borderColor: "transparent",
          boxShadow: "none",
          outlineColor: "transparent",
        },
      ],
      {
        duration: MORPH_PAINT_MS,
        easing: MORPH_LABEL_EASING,
        fill: "backwards",
      },
    );
    // Everything around the mark (title, close button, sleep moon, audio and private badges)
    // arrives on the label beat, together, instead of standing at full strength from frame one.
    revealColumn(element, new Set([mark]), beat);
  }
  revealColumn(incoming, travelling, beat);
  total = Math.max(
    total,
    MORPH_PAINT_MS,
    MORPH_LABEL_MS + MORPH_LABEL_DELAY_MS,
    MORPH_ROOM_FALLBACK_MS + SIDEBAR_MOTION_MS * MORPH_TRAILING_FACTOR,
  );
  watchLateArrivals(host, incoming, beat, total);
  return total;
}

/**
 * Land whatever morph is running in `host` at once: its fades and flights finish, the outgoing
 * shape's copy leaves, and nothing more joins its beat. For a surface that is not drawing (its
 * view hidden behind a live page, or the overlay hidden over New Tab): Chromium starts an
 * animation on the document's next frame, so a morph played there would wait, and run in full
 * (the panel's copy at full width, the active row highlighted, its title across the page) the
 * moment the surface is shown again, long after the change it was for.
 */
export function settleSidebarMorph(host: HTMLElement | null): void {
  if (!host) return;
  lateArrivalWatchers.get(host)?.();
  for (const ghost of host.querySelectorAll<HTMLElement>(
    `:scope > .${MORPH_GHOST_CLASS}`,
  ))
    ghost.remove();
  for (const animation of host.getAnimations({ subtree: true })) {
    // CSS transitions and animations (spinners, hover fades) are the stylesheet's; only the
    // morph's own script animations are landed here.
    if (
      typeof CSSTransition !== "undefined" &&
      animation instanceof CSSTransition
    )
      continue;
    if (
      typeof CSSAnimation !== "undefined" &&
      animation instanceof CSSAnimation
    )
      continue;
    try {
      animation.finish();
    } catch {
      animation.cancel();
    }
  }
}

/** The label beat of one morph: every part it faded in, and one of those fades to keep time by. */
interface LabelBeat {
  /** What the incoming shape held when the morph began: moved later (a reorder), not arrived. */
  present: WeakSet<Element>;
  faded: WeakSet<Element>;
  clock: Animation | null;
  startedAt: number;
}

/** How each morph's late-arrival watch is stopped (the next morph on the same host stops it). */
const lateArrivalWatchers = new WeakMap<HTMLElement, () => void>();

/**
 * Where a part that arrives in the incoming shape while it is still being revealed (a new tab's
 * row, a tab that slept or woke and gained or lost its moon, a badge) joins the label beat.
 * Pure, so it is tested without a document.
 *
 * Returns the beat time (ms, the fade's currentTime) to start its fade at, or null to leave it
 * as drawn:
 *  - inside a part that is already fading in: it inherits that fade;
 *  - inside a site mark, unless it is a whole keyed row: marks are drawn throughout;
 *  - after the beat has landed: its siblings are at full strength too.
 *
 * Without this a row mounted mid-morph skipped the fade every other new part got and painted at
 * full strength, highlight and title across the whole panel width, while the rest of the panel
 * was still transparent: on a rail click that opened the panel and created a tab, the new row
 * flashed on its own before the sidebar settled back on its rail.
 */
export function lateArrivalBeatMs({
  elapsedMs,
  insideFading,
  insideMark,
  keyed,
}: {
  elapsedMs: number;
  insideFading: boolean;
  insideMark: boolean;
  keyed: boolean;
}): number | null {
  if (insideFading) return null;
  if (insideMark && !keyed) return null;
  if (!(elapsedMs < MORPH_LABEL_DELAY_MS + MORPH_LABEL_MS)) return null;
  return Math.max(0, elapsedMs);
}

/**
 * For the length of the morph, anything the framework adds to the incoming shape (a new row, a
 * badge, a moon) fades in on the same beat as the parts that were there when it started, at the
 * point the beat has reached, so nothing arrives at full strength mid-reveal.
 */
function watchLateArrivals(
  host: HTMLElement,
  incoming: HTMLElement,
  beat: LabelBeat,
  durationMs: number,
): void {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver((records) => {
    const clockTime = beat.clock?.currentTime;
    const elapsedMs =
      typeof clockTime === "number"
        ? clockTime
        : performance.now() - beat.startedAt;
    for (const record of records)
      for (const node of record.addedNodes) {
        if (
          !(node instanceof HTMLElement) ||
          beat.present.has(node) ||
          !incoming.contains(node)
        )
          continue;
        let insideFading = false;
        for (
          let ancestor: HTMLElement | null = node;
          ancestor && ancestor !== incoming;
          ancestor = ancestor.parentElement
        )
          if (beat.faded.has(ancestor)) {
            insideFading = true;
            break;
          }
        const keyed = keyOf(node) !== null;
        const at = lateArrivalBeatMs({
          elapsedMs,
          insideFading,
          insideMark: !keyed && node.closest(MARK_SELECTOR) !== null,
          keyed,
        });
        if (at === null) continue;
        fadeIn(node, beat).currentTime = at;
      }
  });
  observer.observe(incoming, { childList: true, subtree: true });
  const timer = setTimeout(stop, durationMs);
  function stop(): void {
    clearTimeout(timer);
    observer.disconnect();
    if (lateArrivalWatchers.get(host) === stop)
      lateArrivalWatchers.delete(host);
  }
  lateArrivalWatchers.set(host, stop);
}

/**
 * Fades in whatever in `root` has no counterpart, at the highest level at which it has none, so
 * each travelling mark stays fully drawn throughout.
 */
function revealColumn(
  root: HTMLElement,
  travelling: Set<HTMLElement>,
  beat: LabelBeat,
): void {
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
      revealColumn(child, travelling, beat);
      continue;
    }
    fadeIn(child, beat);
  }
}

/**
 * One fade for every arriving part, from transparent to the part's own opacity (an implicit end
 * keyframe): a close button at 0.42 or a restored moon at 0.5 must not reach 1 and snap back.
 */
function fadeIn(element: HTMLElement, beat: LabelBeat): Animation {
  const animation = element.animate([{ offset: 0, opacity: 0 }], {
    duration: MORPH_LABEL_MS,
    delay: MORPH_LABEL_DELAY_MS,
    easing: MORPH_LABEL_EASING,
    fill: "backwards",
  });
  beat.faded.add(element);
  beat.clock ??= animation;
  return animation;
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
function releaseColumn(
  snapshot: MorphSnapshot,
  incomingKeys: ReadonlySet<string>,
): void {
  const { column, host, rect } = snapshot;
  if (!column || !host.isConnected) return;
  // Marks the incoming shape does not draw (the panel's pins row vs the rail's pin cluster) stay
  // in the copy and fade out with it while their new form fades in: a crossfade, not a blink.
  const fading = new Set<HTMLElement>();
  const ghost = column.cloneNode(true) as HTMLElement;
  // The copy inherits the hidden shape's classes; the ghost is the one that shows and fades.
  ghost.classList.remove(MORPH_HIDDEN_CLASS);
  ghost.classList.remove(MORPH_COLUMN_CLASS);
  ghost.classList.add(MORPH_GHOST_CLASS);
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    // A keyed counterpart is drawn by the incoming shape throughout (travelling or settled), so
    // its copy here is withdrawn too, even when it has no site mark (the sidebar pin): fading a
    // second copy over the one that stays reads as a flash.
    const key = keyOf(node);
    if (key && incomingKeys.has(key)) markOf(node).style.visibility = "hidden";
    else if (key) fading.add(markOf(node));
    for (const name of node.getAttributeNames()) {
      if (name === "data-motion-key" || name === "data-morph")
        node.removeAttribute(name);
    }
  }
  for (const mark of ghost.querySelectorAll<HTMLElement>(MARK_SELECTOR))
    if (!fading.has(mark) && !mark.closest("[data-morph-fade]"))
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
    easing: MORPH_FADE_EASING,
    fill: "forwards",
  });
  void fade.finished.catch(() => undefined).then(() => ghost.remove());
}
