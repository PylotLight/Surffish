import { lazy, Suspense, useCallback, useRef, useState, type JSX } from "react";
import {
  EMPTY_CLICK_BURST,
  registerClick,
} from "../../../../shared/click-burst";

/**
 * Hidden: triple-click the Surffish logo at the top right of the toolbar for a big animated logo.
 * The trigger is a few lines in the main bundle; the dialog (markup + CSS) is its own chunk, loaded
 * on the first triple-click only.
 */
export function useBrandTripleClick(): {
  open: boolean;
  onClick: () => boolean;
  close: () => void;
} {
  const [open, setOpen] = useState(false);
  const burst = useRef(EMPTY_CLICK_BURST);
  const onClick = useCallback(() => {
    const result = registerClick(burst.current, performance.now());
    burst.current = result.burst;
    if (result.fired) setOpen(true);
    return result.fired;
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { open, onClick, close };
}

const SurffishEgg = lazy(() => import("./SurffishEgg"));

export function BrandEasterEgg({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  return (
    <Suspense fallback={null}>
      <SurffishEgg onClose={onClose} />
    </Suspense>
  );
}
