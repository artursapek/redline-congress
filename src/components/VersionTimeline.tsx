import React, { useEffect, useRef, useState } from "react";
import {
  describeStage,
  getVersionStageInfo,
  type BillTextVersion,
} from "../../shared/bills";
import { LawBadge } from "./StagePill";
import { Tooltip } from "./Tooltip";

export type TimelineSelection =
  | { mode: "compare"; from: string; to: string }
  | { mode: "single"; version: string };

interface VersionTimelineProps {
  versions: BillTextVersion[];
  selection: TimelineSelection;
  onSelectSingle: (versionCode: string) => void;
  /** `range` = drag or shift-click (an explicit comparison); `click` = a single step. */
  onSelectCompare: (fromCode: string, toCode: string, via: "click" | "range") => void;
  /** When false, the document shows one clean version: highlight just that step. */
  showChanges?: boolean;
  /** e.g. "Public Law 117-169" when the bill was signed into law. */
  enactedLaw?: string | null;
  enactedDate?: string | null;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const VersionTimeline: React.FC<VersionTimelineProps> = ({
  versions,
  selection,
  onSelectSingle,
  onSelectCompare,
  enactedLaw,
  enactedDate,
  showChanges = true,
}) => {
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [dragHover, setDragHover] = useState<number | null>(null);
  const dragAnchorRef = useRef<number | null>(null);
  const dragHoverRef = useRef<number | null>(null);

  dragAnchorRef.current = dragAnchor;
  dragHoverRef.current = dragHover;

  // Commit drag/click when pointer releases anywhere on the page
  useEffect(() => {
    if (dragAnchor === null) return;

    const handlePointerUp = () => {
      const start = dragAnchorRef.current;
      const end = dragHoverRef.current ?? start;
      setDragAnchor(null);
      setDragHover(null);
      if (start === null || end === null) return;
      if (start === end) {
        // GitHub-commit style: clicking version 0 shows clean initial text;
        // clicking any subsequent version diffs it against the immediately preceding stage.
        if (start === 0) {
          const ver = versions[0];
          if (ver) onSelectSingle(ver.code);
        } else {
          const fromVer = versions[start - 1];
          const toVer = versions[start];
          if (fromVer && toVer) onSelectCompare(fromVer.code, toVer.code, "click");
        }
      } else {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        const fromVer = versions[lo];
        const toVer = versions[hi];
        if (fromVer && toVer) onSelectCompare(fromVer.code, toVer.code, "range");
      }
    };

    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragAnchor, versions, onSelectSingle, onSelectCompare]);

  // Determine active range indices (either live drag preview or committed selection)
  const isDragging = dragAnchor !== null;
  let rangeStart = -1;
  let rangeEnd = -1;

  if (isDragging) {
    const hover = dragHover ?? dragAnchor;
    rangeStart = Math.min(dragAnchor, hover);
    rangeEnd = Math.max(dragAnchor, hover);
  } else if (selection.mode === "compare" && !showChanges) {
    // Changes hidden: the document is the clean "to" version.
    const b = versions.findIndex((v) => v.code === selection.to);
    rangeStart = b;
    rangeEnd = b;
  } else if (selection.mode === "compare") {
    const a = versions.findIndex((v) => v.code === selection.from);
    const b = versions.findIndex((v) => v.code === selection.to);
    if (a !== -1 && b !== -1) {
      rangeStart = Math.min(a, b);
      rangeEnd = Math.max(a, b);
    }
  } else {
    const idx = versions.findIndex((v) => v.code === selection.version);
    if (idx !== -1) {
      rangeStart = idx;
      rangeEnd = idx;
    }
  }

  const isRange = rangeStart !== -1 && rangeEnd !== -1 && rangeStart !== rangeEnd;

  const handleRowPointerDown = (
    idx: number,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();

    // Shift+Click compares from the currently active version to the clicked one
    if (e.shiftKey && rangeStart !== -1 && rangeStart !== idx) {
      const anchor = rangeEnd !== -1 ? rangeEnd : rangeStart;
      const lo = Math.min(anchor, idx);
      const hi = Math.max(anchor, idx);
      if (lo !== hi) {
        onSelectCompare(versions[lo].code, versions[hi].code, "range");
        return;
      }
    }

    setDragAnchor(idx);
    setDragHover(idx);
  };

  const handleRowPointerEnter = (idx: number) => {
    if (dragAnchorRef.current !== null) {
      setDragHover(idx);
    }
  };

  if (versions.length === 0) {
    return (
      <div className="rc-timeline-empty">
        No published text versions available yet.
      </div>
    );
  }

  // The signed text is the last enrolled version (or the final one if GovInfo
  // has no ENR for this bill); that card carries the "Law" badge.
  const lawVersionIdx = (() => {
    for (let i = versions.length - 1; i >= 0; i--) {
      if (versions[i].code === "enr" || versions[i].code === "renr") return i;
    }
    return versions.length - 1;
  })();

  return (
    <div
      className="rc-timeline"
      data-dragging={isDragging ? "true" : undefined}
      role="listbox"
      aria-label="Bill version history"
    >
      <div className="rc-timeline-hint">
        {isDragging && isRange ? (
          <span className="rc-timeline-hint-active">
            Release to redline{" "}
            <strong>{versions[rangeStart].code.toUpperCase()}</strong> →{" "}
            <strong>{versions[rangeEnd].code.toUpperCase()}</strong>
          </span>
        ) : versions.length >= 2 ? (
          <span>
            Click or drag to see versions
          </span>
        ) : (
          <span>1 published version</span>
        )}
      </div>

      <div className="rc-timeline-list">
        {versions.map((ver, idx) => {
          const showsLaw = Boolean(enactedLaw) && idx === lawVersionIdx;
          const info = getVersionStageInfo(ver.code);
          const isFirst = idx === 0;
          const isLast = idx === versions.length - 1;

          const isSingleSelected =
            !isRange && rangeStart === idx;
          const isRangeStart = isRange && idx === rangeStart;
          const isRangeEnd = isRange && idx === rangeEnd;
          const isInRange =
            isRange && idx > rangeStart && idx < rangeEnd;
          const isEndpoint = isSingleSelected || isRangeStart || isRangeEnd;
          // The newer end is the version being viewed (full blue); the older end
          // is what it's compared to (blue outline + "Comparing to").
          const endpointKind = isSingleSelected || isRangeEnd ? "current" : isRangeStart ? "compare" : undefined;

          const topActive = isRange && idx > rangeStart && idx <= rangeEnd;
          const bottomActive = isRange && idx >= rangeStart && idx < rangeEnd;

          return (
            <div
              key={ver.code}
              role="option"
              tabIndex={0}
              aria-selected={isEndpoint || isInRange}
              className="rc-timeline-row"
              data-endpoint={endpointKind}
              data-in-range={isInRange ? "true" : undefined}
              data-single={isSingleSelected ? "true" : undefined}
              onPointerDown={(e) => handleRowPointerDown(idx, e)}
              onPointerEnter={() => handleRowPointerEnter(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (idx === 0) onSelectSingle(ver.code);
                  else onSelectCompare(versions[idx - 1].code, ver.code, "click");
                }
              }}
            >
              {/* Left vertical track with dot + active blue connector */}
              <div className="rc-timeline-track" aria-hidden="true">
                <span
                  className="rc-timeline-line rc-timeline-line-top"
                  data-hidden={isFirst ? "true" : undefined}
                  data-active={topActive ? "true" : undefined}
                />
                <span
                  className="rc-timeline-dot"
                  data-endpoint={endpointKind}
                  data-in-range={isInRange ? "true" : undefined}
                />
                <span
                  className="rc-timeline-line rc-timeline-line-bottom"
                  data-hidden={isLast ? "true" : undefined}
                  data-active={bottomActive ? "true" : undefined}
                />
              </div>

              {/* Right stage card */}
              <div className="rc-timeline-card">
                <div className="rc-timeline-card-top">
                  <span className="rc-timeline-stage">{ver.type || info.label}</span>
                  <Tooltip content={describeStage(ver.code)}>
                    <span className="rc-timeline-code">{ver.code}</span>
                  </Tooltip>
                </div>

                <div className="rc-timeline-card-meta">
                  {ver.date && <span>{formatShortDate(ver.date)}</span>}
                  {endpointKind === "compare" && (
                    <span className="rc-timeline-compare-tag">Comparing to</span>
                  )}
                  {showsLaw && enactedLaw && (
                    <span className="rc-timeline-law-badge">
                      <LawBadge
                        law={enactedLaw}
                        date={enactedDate ? formatShortDate(enactedDate) : null}
                      />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
};
