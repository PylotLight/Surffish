import { useEffect, useRef, useState } from "react";
import {
  groupCollapseSnapshot,
  newlyExpandedGroups,
  type GroupCollapseSnapshot,
} from "../../../../shared/tab-group-reveal";

/** How long a just-expanded group's rows keep the reveal class (a little over the CSS animation). */
const REVEAL_MS = 260;
const NONE: ReadonlySet<string> = new Set();

/**
 * Group ids expanded in the last moment: their rows get `is-group-revealing` (motion.css) and
 * ease in instead of popping into the list. Collapsing stays instant (rows unmount).
 */
export function useGroupReveal(
  tabs: readonly { group?: { id: string; collapsed: boolean } }[],
): ReadonlySet<string> {
  const previous = useRef<GroupCollapseSnapshot>(new Map());
  const [revealing, setRevealing] = useState<ReadonlySet<string>>(NONE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const next = groupCollapseSnapshot(tabs);
    const expanded = newlyExpandedGroups(previous.current, next);
    previous.current = next;
    if (expanded.length === 0) return;
    setRevealing(new Set(expanded));
    // Not tied to `tabs`: tab updates keep arriving while a page loads and must not keep it stuck on.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setRevealing(NONE);
    }, REVEAL_MS);
  }, [tabs]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return revealing;
}
