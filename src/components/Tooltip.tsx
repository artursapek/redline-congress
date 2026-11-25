import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;

/**
 * Lightweight hover/focus tooltip. Rendered in a portal with fixed
 * positioning so it isn't clipped by scrolling rails or overflow-hidden rows.
 */
export const Tooltip: React.FC<{ content: React.ReactNode; children: React.ReactElement }> = ({
  content,
  children,
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    let top = a.top - t.height - GAP;
    if (top < EDGE) top = a.bottom + GAP; // flip below when there's no room above
    const left = Math.min(
      Math.max(a.left + a.width / 2 - t.width / 2, EDGE),
      window.innerWidth - t.width - EDGE,
    );
    setPos({ left, top });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    // Only close when something containing the anchor scrolls (the tooltip is
    // fixed-position and would drift); unrelated scrollers like the document
    // canvas fire scroll events constantly.
    const onScroll = (e: Event) => {
      const target = e.target;
      const anchor = anchorRef.current;
      if (
        target === document ||
        (target instanceof Node && anchor && target.contains(anchor))
      ) {
        hide();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, hide]);

  return (
    <>
      <span
        ref={anchorRef}
        className="rc-tooltip-anchor"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="rc-tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};
