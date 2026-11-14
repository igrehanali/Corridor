import { animate, motion, useDragControls, useMotionValue } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const MOBILE_QUERY = "(max-width: 760px)";

/** Fraction of the viewport the collapsed sheet leaves for the map. */
const PEEK = 0.5;
const OPEN = 0.07;

/**
 * Desktop: a floating side panel. Mobile: a bottom sheet with two detents.
 * Releasing the sheet projects its velocity forward (like a thrown object)
 * and settles on the nearest detent with a spring that inherits that velocity,
 * so a flick feels continuous rather than snapping.
 */
export function Panel({
  children,
  expanded,
  onExpandedChange,
  onSheetHeight,
}: {
  children: ReactNode;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  onSheetHeight: (px: number) => void;
}) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const controls = useDragControls();
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const y = useMotionValue(vh * PEEK);

  useEffect(() => {
    if (!mobile) return;
    const target = vh * (expanded ? OPEN : PEEK);
    const a = animate(y, target, { type: "spring", stiffness: 380, damping: 40 });
    onSheetHeight(vh - vh * PEEK);
    return () => a.stop();
  }, [expanded, mobile, vh, y, onSheetHeight]);

  if (!mobile) return <aside className="panel">{children}</aside>;

  return (
    <motion.aside
      className="panel panel--sheet"
      style={{ y, height: vh * (1 - OPEN) }}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: vh * OPEN, bottom: vh * PEEK }}
      dragElastic={0.12}
      onDragEnd={(_, info) => {
        const projected = y.get() + info.velocity.y * 0.2;
        const open = Math.abs(projected - vh * OPEN) < Math.abs(projected - vh * PEEK);
        animate(y, vh * (open ? OPEN : PEEK), {
          type: "spring",
          stiffness: 380,
          damping: 40,
          velocity: info.velocity.y,
        });
        onExpandedChange(open);
      }}
    >
      <div
        className="sheet-handle"
        onPointerDown={(e) => controls.start(e)}
        onClick={() => onExpandedChange(!expanded)}
        role="button"
        aria-label={expanded ? "Collapse panel" : "Expand panel"}
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onExpandedChange(!expanded)}
      >
        <span />
      </div>
      {children}
    </motion.aside>
  );
}
