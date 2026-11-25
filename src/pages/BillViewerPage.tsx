import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Link2,
} from "lucide-react";
import type {
  ReviseEditorHandle,
  ReviseReviewState,
  ReviseSelectionSnapshot,
  ReviseTrackedChange,
} from "revise";
import {
  formatBillNumber,
  congressOrdinal,
  getEnactedLaw,
  getVersionStageInfo,
  normalizeBillType,
  type BillDetail,
  type BillType,
} from "../../shared/bills";
import { fetchBillDetail, fetchBillVersionXml } from "../lib/api";
import { compareParsedBills, resolveBillRevisions } from "../lib/billXml/diff";
import { serializeBillToDocxBlob } from "../lib/billXml/docxWriter";
import { parseCongressionalXml } from "../lib/billXml/parser";
import type { BillSectionRef, ParsedBill } from "../lib/billXml/types";
import { useDiffStyle } from "../lib/diffStyle";
import { getInitialData } from "../lib/initialData";
import { useTheme } from "../lib/theme";
import type { SuggestionViewMode } from "../components/ReviseBillCanvas";
import { VersionTimeline } from "../components/VersionTimeline";
import { SITE_NAME, SiteHeader } from "../components/SiteHeader";
import { LawBadge, StagePill } from "../components/StagePill";

interface ParsedAnchorRange {
  startBlockIndex: number;
  startOffset: number;
  endBlockIndex: number;
  endOffset: number;
}

interface ParsedAnchorHash {
  sectionSlug: string | null;
  range: ParsedAnchorRange | null;
}

/**
 * Parses URL fragment anchors in either form:
 *  - `#sec-215` (section heading permalink)
 *  - `#sec-215~b42:14-98` (single-block text range inside sec-215)
 *  - `#sec-215~b42:14-43:28` (multi-block text range inside sec-215)
 *  - `#~b4:0-42` (text range before the first section heading)
 */
function parseAnchorHash(rawHash: string): ParsedAnchorHash {
  const cleaned = decodeURIComponent(rawHash.replace(/^#/, "")).trim();
  if (!cleaned) return { sectionSlug: null, range: null };

  const tildeIdx = cleaned.indexOf("~");
  const slugPart = (tildeIdx >= 0 ? cleaned.slice(0, tildeIdx) : cleaned)
    .trim()
    .toLowerCase();
  const rangePart = tildeIdx >= 0 ? cleaned.slice(tildeIdx + 1).trim() : "";

  let range: ParsedAnchorRange | null = null;
  if (rangePart) {
    const multi = rangePart.match(/^b(\d+):(\d+)-(\d+):(\d+)$/i);
    if (multi) {
      range = {
        startBlockIndex: Number(multi[1]),
        startOffset: Number(multi[2]),
        endBlockIndex: Number(multi[3]),
        endOffset: Number(multi[4]),
      };
    } else {
      const single = rangePart.match(/^b(\d+):(\d+)-(\d+)$/i);
      if (single) {
        const blockIdx = Number(single[1]);
        range = {
          startBlockIndex: blockIdx,
          startOffset: Number(single[2]),
          endBlockIndex: blockIdx,
          endOffset: Number(single[3]),
        };
      }
    }
  }

  return {
    sectionSlug: slugPart || null,
    range,
  };
}

function encodeAnchorHash(
  sectionSlug: string | null,
  range: ParsedAnchorRange,
): string {
  const rangeToken =
    range.startBlockIndex === range.endBlockIndex
      ? `b${range.startBlockIndex}:${range.startOffset}-${range.endOffset}`
      : `b${range.startBlockIndex}:${range.startOffset}-${range.endBlockIndex}:${range.endOffset}`;
  return `#${sectionSlug ?? ""}~${rangeToken}`;
}

const ReviseBillCanvas = lazy(() =>
  import("../components/ReviseBillCanvas").then((m) => ({
    default: m.ReviseBillCanvas,
  })),
);

type DiffSelection =
  | { mode: "compare"; from: string; to: string }
  | { mode: "single"; version: string };

function parseSpecParam(
  spec: string | undefined,
  bill: BillDetail,
): DiffSelection {
  const versions = bill.versions;
  if (versions.length === 0) {
    return { mode: "single", version: "" };
  }

  if (spec) {
    const clean = spec.toLowerCase();
    if (clean.includes("..")) {
      const [fromRaw, toRaw] = clean.split("..");
      const hasFrom = versions.some((v) => v.code === fromRaw);
      const hasTo = versions.some((v) => v.code === toRaw);
      if (hasFrom && hasTo && fromRaw !== toRaw) {
        return { mode: "compare", from: fromRaw, to: toRaw };
      }
    } else {
      const idx = versions.findIndex((v) => v.code === clean);
      if (idx === 0) {
        return { mode: "single", version: versions[0].code };
      }
      if (idx > 0) {
        return {
          mode: "compare",
          from: versions[idx - 1].code,
          to: versions[idx].code,
        };
      }
    }
  }

  // Default: always show what changed in the latest step (prev -> latest),
  // or clean text if only 1 version has been published.
  if (versions.length >= 2) {
    const prev = versions[versions.length - 2];
    const latest = versions[versions.length - 1];
    return { mode: "compare", from: prev.code, to: latest.code };
  }
  return { mode: "single", version: versions[0].code };
}

type ExportFormat = "docx" | "pdf" | "markdown";

const DOWNLOAD_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string; title: string }> = [
  { format: "docx", label: "DOCX", title: "" }, // title depends on Show diff
  { format: "pdf", label: "PDF", title: "Clean paginated PDF of the selected version" },
  { format: "markdown", label: "Markdown", title: "Clean Markdown of the selected version" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const BillViewerPage: React.FC = () => {
  const params = useParams<{
    congress: string;
    type: string;
    number: string;
    spec?: string;
  }>();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const congress = Number(params.congress);
  const billType = normalizeBillType(params.type ?? "") as BillType | null;
  const billNumber = Number(params.number);

  const ssrBill = getInitialData().bill;
  const matchingSsrBill =
    ssrBill &&
    ssrBill.congress === congress &&
    ssrBill.type === billType &&
    ssrBill.number === billNumber
      ? ssrBill
      : null;

  const [bill, setBill] = useState<BillDetail | null>(matchingSsrBill);
  const [billError, setBillError] = useState<string | null>(null);
  const [loadingBill, setLoadingBill] = useState(!matchingSsrBill);

  const [parsedBill, setParsedBill] = useState<ParsedBill | null>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [docKey, setDocKey] = useState<string>("");
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // "Show diff" switch. Off = clean text of the selected ("to") version.
  // Clicking history steps keeps it off; dragging or shift-clicking a range
  // is an explicit comparison and turns it back on.
  const [showChanges, setShowChanges] = useState(true);
  const viewMode: SuggestionViewMode = showChanges ? "all-markup" : "final";
  const [markupStyle, setMarkupStyle] = useDiffStyle();
  const [rightTab, setRightTab] = useState<"history" | "changes">("history");
  const [changedSectionsOnly, setChangedSectionsOnly] = useState(false);
  const [activeSectionSlug, setActiveSectionSlug] = useState<string | null>(() =>
    typeof window !== "undefined" && window.location.hash
      ? parseAnchorHash(window.location.hash).sectionSlug
      : null,
  );
  const [editorReadyKey, setEditorReadyKey] = useState<string>("");
  const handledHashKeyRef = useRef<string>("");

  const editorRef = useRef<ReviseEditorHandle | null>(null);
  const [changes, setChanges] = useState<ReviseTrackedChange[]>([]);
  const [reviewState, setReviewState] = useState<ReviseReviewState | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] =
    useState<ReviseSelectionSnapshot | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  // 1. Fetch bill metadata (skip immediate network wait if SSR already preloaded this exact bill)
  useEffect(() => {
    if (!billType || !Number.isFinite(congress) || !Number.isFinite(billNumber)) {
      setBillError("Invalid bill URL.");
      setLoadingBill(false);
      return;
    }
    if (
      matchingSsrBill &&
      matchingSsrBill.congress === congress &&
      matchingSsrBill.type === billType &&
      matchingSsrBill.number === billNumber
    ) {
      setBill(matchingSsrBill);
      setLoadingBill(false);
      document.title = `${formatBillNumber(matchingSsrBill.type, matchingSsrBill.number)} — ${matchingSsrBill.title} | ${SITE_NAME}`;
      return;
    }
    let active = true;
    setLoadingBill(true);
    setBillError(null);
    setBill(null);
    setDocxBlob(null);
    setParsedBill(null);

    fetchBillDetail(congress, billType, billNumber)
      .then((data) => {
        if (!active) return;
        setBill(data);
        document.title = `${formatBillNumber(data.type, data.number)} — ${data.title} | ${SITE_NAME}`;
      })
      .catch((err) => {
        if (!active) return;
        setBillError(err instanceof Error ? err.message : "Could not load bill.");
      })
      .finally(() => {
        if (active) setLoadingBill(false);
      });

    return () => {
      active = false;
    };
  }, [congress, billType, billNumber]);

  const selection = useMemo(
    () => (bill ? parseSpecParam(params.spec, bill) : null),
    [bill, params.spec],
  );

  // 2. Fetch XML(s), parse, diff (if compare mode), and serialize to OOXML .docx for Revise SDK
  useEffect(() => {
    if (!bill || !selection || !billType) return;
    if (selection.mode === "single" && !selection.version) {
      setRenderError("No published XML versions are available for this bill yet.");
      return;
    }

    let cancelled = false;
    setRenderError(null);
    setChanges([]);
    setReviewState(null);

    const run = async () => {
      try {
        let finalParsed: ParsedBill;
        let key: string;

        if (selection.mode === "single") {
          setLoadingStage(
            `Fetching official ${selection.version.toUpperCase()} bill text from GovInfo…`,
          );
          const xml = await fetchBillVersionXml(
            congress,
            billType,
            billNumber,
            selection.version,
          );
          if (cancelled) return;
          setLoadingStage("Parsing legislative text…");
          await new Promise((r) => setTimeout(r, 0));
          // Always render clean settled text on single-version views so redlines
          // come consistently from our own cross-version diff engine.
          finalParsed = resolveBillRevisions(
            parseCongressionalXml(xml),
            "accept",
          );
          key = `${bill.id}:${selection.version}`;
        } else {
          setLoadingStage(
            `Fetching ${selection.from.toUpperCase()} and ${selection.to.toUpperCase()} XML…`,
          );
          const [xmlA, xmlB] = await Promise.all([
            fetchBillVersionXml(congress, billType, billNumber, selection.from),
            fetchBillVersionXml(congress, billType, billNumber, selection.to),
          ]);
          if (cancelled) return;
          setLoadingStage(
            `Computing redline (${selection.from.toUpperCase()} → ${selection.to.toUpperCase()})…`,
          );
          await new Promise((r) => setTimeout(r, 0));
          const parsedA = parseCongressionalXml(xmlA);
          const parsedB = parseCongressionalXml(xmlB);
          const fromLabel = getVersionStageInfo(selection.from).shortLabel;
          const toLabel = getVersionStageInfo(selection.to).shortLabel;
          finalParsed = compareParsedBills(parsedA, parsedB, {
            author:
              parsedB.reportingCommittee || `${fromLabel} → ${toLabel}`,
          });
          key = `${bill.id}:${selection.from}..${selection.to}`;
        }

        if (cancelled) return;
        setLoadingStage("Building redline document for Revise viewer…");
        await new Promise((r) => setTimeout(r, 0));
        const blob = serializeBillToDocxBlob(finalParsed);
        if (cancelled) return;

        setParsedBill(finalParsed);
        setDocxBlob(blob);
        setDocKey(key);
        setLoadingStage(null);
      } catch (err) {
        if (cancelled) return;
        setRenderError(
          err instanceof Error ? err.message : "Failed to parse bill XML.",
        );
        setLoadingStage(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bill, selection, congress, billType, billNumber]);

  const handleReady = useCallback((handle: ReviseEditorHandle) => {
    editorRef.current = handle;
  }, []);

  const handleChangesUpdated = useCallback(
    (list: ReviseTrackedChange[], state: ReviseReviewState) => {
      setChanges(list);
      setReviewState(state);
      setEditorReadyKey(docKey);
    },
    [docKey],
  );

  const handleSelectionUpdated = useCallback(
    (snapshot: ReviseSelectionSnapshot) => {
      setSelectionSnapshot(snapshot);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const navigateToSpec = (spec: string) => {
    if (!billType) return;
    setActiveSectionSlug(null);
    setSelectionSnapshot(null);
    navigate(`/${congress}/${billType}/${billNumber}/${spec}`);
  };

  const handleExport = async (format: ExportFormat) => {
    const editor = editorRef.current;
    if (!editor || !bill) return;
    // Only .docx can carry tracked changes, and only when the diff is showing.
    // PDF and Markdown are always the clean text of the selected version.
    const withRedline = format === "docx" && showChanges && selection?.mode === "compare";
    setExporting(format);
    try {
      const blob = await editor.tools.export({
        format,
        mode: withRedline ? "review" : "final",
      });
      const slug = `${bill.congress}-${bill.type}${bill.number}${
        selection?.mode === "compare"
          ? withRedline
            ? `-${selection.from}-to-${selection.to}-redline`
            : `-${selection.to}`
          : selection?.mode === "single"
            ? `-${selection.version}`
            : ""
      }`;
      downloadBlob(blob, `${slug}.${format === "markdown" ? "md" : format}`);
    } catch (err) {
      console.error("Export failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (/dynamically imported module|module script failed|Loading chunk/i.test(msg)) {
        window.location.reload();
        return;
      }
      // Fallback: if browser DOCX export hits an issue, serve the generated blob
      // directly (it contains the tracked changes, so only when they're wanted).
      if (withRedline && docxBlob) {
        downloadBlob(docxBlob, `${bill.congress}-${bill.type}${bill.number}-redline.docx`);
      }
    } finally {
      setExporting(null);
    }
  };

  const applyTextRangeAnchor = useCallback(
    (range: ParsedAnchorRange, sectionSlug: string | null): boolean => {
      const editor = editorRef.current;
      if (!editor) return false;

      let blocks: Array<{ id?: string }> = [];
      try {
        const doc = editor.getDocument() as { children?: Array<{ id?: string }> };
        blocks = doc.children ?? [];
      } catch {
        return false;
      }

      const startBlock = blocks[range.startBlockIndex];
      const endBlock = blocks[range.endBlockIndex];
      if (!startBlock?.id || !endBlock?.id) return false;

      const result = editor.selection.setRange(
        { blockId: startBlock.id, offset: range.startOffset },
        { blockId: endBlock.id, offset: range.endOffset },
        { scrollIntoView: true, align: "center" },
      );

      if (result.success && sectionSlug) {
        setActiveSectionSlug(sectionSlug);
      }
      return result.success;
    },
    [],
  );

  const handleCopySelectionLink = useCallback(async () => {
    const editor = editorRef.current;
    const snap = selectionSnapshot;
    if (
      !editor ||
      !parsedBill ||
      !snap ||
      snap.empty ||
      !snap.start ||
      !snap.end
    ) {
      return;
    }

    let blocks: Array<{ id?: string; type?: string; heading?: number }> = [];
    try {
      const doc = editor.getDocument() as {
        children?: Array<{ id?: string; type?: string; heading?: number }>;
      };
      blocks = doc.children ?? [];
    } catch {
      return;
    }

    const startBlockIndex = blocks.findIndex((b) => b.id === snap.start!.blockId);
    const endBlockIndex = blocks.findIndex((b) => b.id === snap.end!.blockId);
    if (startBlockIndex < 0 || endBlockIndex < 0) return;

    // Identify the enclosing section heading so the permalink stays human-readable (#sec-215~b...)
    const headingIndices: number[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "paragraph" && b.heading) headingIndices.push(i);
    });
    let enclosingSectionIdx = -1;
    for (let i = 0; i < headingIndices.length; i++) {
      if (headingIndices[i] <= startBlockIndex) enclosingSectionIdx = i;
      else break;
    }
    const sectionSlug =
      enclosingSectionIdx >= 0 && enclosingSectionIdx < parsedBill.sections.length
        ? parsedBill.sections[enclosingSectionIdx].slug
        : null;

    const range: ParsedAnchorRange = {
      startBlockIndex,
      startOffset: snap.start.offset,
      endBlockIndex,
      endOffset: snap.end.offset,
    };
    const nextHash = encodeAnchorHash(sectionSlug, range);
    window.history.replaceState(null, "", nextHash);
    if (sectionSlug) setActiveSectionSlug(sectionSlug);

    // Keep the range visually highlighted inside the viewer after clicking the button
    editor.selection.setRange(
      { blockId: snap.start.blockId, offset: snap.start.offset },
      { blockId: snap.end.blockId, offset: snap.end.offset },
      { scrollIntoView: false },
    );

    const shareUrl = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    } catch {
      // Even if clipboard permissions block copy, the URL bar now has the exact permalink
    }

    setCopiedLink(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedLink(false);
    }, 2200);
  }, [parsedBill, selectionSnapshot]);

  const jumpToSection = useCallback(
    (sec: BillSectionRef, options: { updateHash?: boolean } = {}) => {
      if (options.updateHash !== false && typeof window !== "undefined") {
        const nextHash = `#${sec.slug}`;
        if (window.location.hash !== nextHash) {
          window.history.replaceState(null, "", nextHash);
        }
        setActiveSectionSlug(sec.slug);
      }

      const editor = editorRef.current;
      if (!editor || !parsedBill) return;

      let doc: {
        children?: Array<{
          id?: string;
          type?: string;
          heading?: number;
          children?: Array<{ text?: string }>;
        }>;
      };
      try {
        doc = editor.getDocument() as typeof doc;
      } catch {
        return; // Document is still opening
      }

      const blocks = doc.children ?? [];
      if (blocks.length === 0) return;

      // Match strictly against heading blocks (never TOC entries on page 1).
      const sectionIdx = parsedBill.sections.indexOf(sec);
      const headingIndices: number[] = [];
      blocks.forEach((b, i) => {
        if (b.type === "paragraph" && b.heading) headingIndices.push(i);
      });

      const matchIdx =
        sectionIdx >= 0 && sectionIdx < headingIndices.length
          ? headingIndices[sectionIdx]
          : Math.min(sec.blockIndex, blocks.length - 1);

      const headingBlock = blocks[matchIdx];

      // Native Revise SDK 4.6.2 exact top-aligned block navigation (works on both
      // redline diffs AND single-version / unchanged bills!).
      if (headingBlock?.id) {
        const scrolled = editor.view.scrollToBlock(headingBlock.id, {
          align: "top",
        });
        if (scrolled) return;
      }

      // Fallback when a heading is hidden in read-only Final/Original projection:
      // scroll to the nearest visible sibling block inside this section.
      const nextHeadingIdx =
        sectionIdx >= 0 && sectionIdx + 1 < headingIndices.length
          ? headingIndices[sectionIdx + 1]
          : blocks.length;
      for (let i = matchIdx + 1; i < nextHeadingIdx; i++) {
        const candidateId = blocks[i]?.id;
        if (
          candidateId &&
          editor.view.scrollToBlock(candidateId, { align: "top" })
        ) {
          return;
        }
      }
    },
    [parsedBill],
  );

  const jumpToSectionRef = useRef(jumpToSection);
  jumpToSectionRef.current = jumpToSection;
  const applyTextRangeAnchorRef = useRef(applyTextRangeAnchor);
  applyTextRangeAnchorRef.current = applyTextRangeAnchor;

  // Auto-scroll to a URL `#section` or `#section~bN:start-end` text permalink once
  // Revise finishes laying out the document, re-aligning cleanly if async pagination
  // refines scrollHeight right after mount.
  useEffect(() => {
    if (!parsedBill || !docKey || editorReadyKey !== docKey) return;
    const rawHash =
      typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!rawHash) return;
    const parsedAnchor = parseAnchorHash(rawHash);
    if (!parsedAnchor.sectionSlug && !parsedAnchor.range) return;

    const visitKey = `${docKey}#${rawHash}`;
    if (handledHashKeyRef.current === visitKey) return;

    const matchIdx = parsedAnchor.sectionSlug
      ? parsedBill.sections.findIndex(
          (s) =>
            s.slug.toLowerCase() === parsedAnchor.sectionSlug ||
            s.id.toLowerCase() === parsedAnchor.sectionSlug,
        )
      : -1;
    const match = matchIdx >= 0 ? parsedBill.sections[matchIdx] : null;
    if (!match && !parsedAnchor.range) return;

    if (match) setActiveSectionSlug(match.slug);

    const applyTarget = () => {
      if (parsedAnchor.range) {
        const ok = applyTextRangeAnchorRef.current(
          parsedAnchor.range,
          match?.slug ?? parsedAnchor.sectionSlug,
        );
        if (ok) return true;
      }
      if (match) {
        jumpToSectionRef.current(match, { updateHash: false });
        return true;
      }
      return false;
    };

    let cancelled = false;
    let userInteracted = false;
    let attempts = 0;
    let timerId: number | null = null;
    let initialJumped = false;
    let lastScrollHeight = 0;
    let stableTicks = 0;
    let settleStartedAt = 0;

    const findScroller = () => {
      const mount = document.querySelector(".rc-editor-mount");
      return mount
        ? Array.from(mount.querySelectorAll<HTMLElement>("*")).find(
            (el) =>
              el.scrollHeight > el.clientHeight + 40 &&
              getComputedStyle(el).overflowY !== "visible",
          )
        : null;
    };

    const onUserInteract = () => {
      userInteracted = true;
      handledHashKeyRef.current = visitKey;
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    window.addEventListener("wheel", onUserInteract, {
      passive: true,
      capture: true,
    });
    window.addEventListener("pointerdown", onUserInteract, {
      passive: true,
      capture: true,
    });
    window.addEventListener("touchstart", onUserInteract, {
      passive: true,
      capture: true,
    });
    window.addEventListener("keydown", onUserInteract, {
      passive: true,
      capture: true,
    });

    const tick = () => {
      if (cancelled || userInteracted) return;
      attempts++;

      const scroller = findScroller();

      if (!initialJumped) {
        if (!scroller && attempts < 50) {
          timerId = window.setTimeout(tick, 120);
          return;
        }
        initialJumped = true;
        settleStartedAt = Date.now();
        lastScrollHeight = scroller?.scrollHeight ?? 0;
        applyTarget();

        if (match) {
          const linkEl = document.querySelector<HTMLElement>(
            `.rc-outline-item[data-slug="${CSS.escape(match.slug)}"]`,
          );
          linkEl?.scrollIntoView({ block: "nearest" });
        }

        timerId = window.setTimeout(tick, 220);
        return;
      }

      const elapsed = Date.now() - settleStartedAt;
      if (!scroller) {
        if (elapsed < 4000) {
          timerId = window.setTimeout(tick, 220);
        } else {
          handledHashKeyRef.current = visitKey;
        }
        return;
      }

      const heightShifted =
        Math.abs(scroller.scrollHeight - lastScrollHeight) > 20;
      const expectedBelowTop =
        (parsedAnchor.range && parsedAnchor.range.startBlockIndex > 3) ||
        matchIdx > 0;
      const resetToTop = expectedBelowTop && scroller.scrollTop < 16;

      if (heightShifted || resetToTop) {
        lastScrollHeight = scroller.scrollHeight;
        stableTicks = 0;
        applyTarget();
      } else {
        stableTicks++;
      }

      if (stableTicks >= 6 || elapsed >= 4500) {
        handledHashKeyRef.current = visitKey;
        return;
      }

      timerId = window.setTimeout(tick, 220);
    };

    timerId = window.setTimeout(tick, 140);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener("wheel", onUserInteract, { capture: true });
      window.removeEventListener("pointerdown", onUserInteract, {
        capture: true,
      });
      window.removeEventListener("touchstart", onUserInteract, {
        capture: true,
      });
      window.removeEventListener("keydown", onUserInteract, { capture: true });
    };
  }, [parsedBill, docKey, editorReadyKey]);

  // Respond to manual hash edits or browser back/forward hash navigation
  useEffect(() => {
    if (!parsedBill) return;
    const onHashChange = () => {
      const parsedAnchor = parseAnchorHash(window.location.hash);
      if (!parsedAnchor.sectionSlug && !parsedAnchor.range) {
        setActiveSectionSlug(null);
        return;
      }
      const match = parsedAnchor.sectionSlug
        ? (parsedBill.sections.find(
            (s) =>
              s.slug.toLowerCase() === parsedAnchor.sectionSlug ||
              s.id.toLowerCase() === parsedAnchor.sectionSlug,
          ) ?? null)
        : null;
      if (parsedAnchor.range) {
        const applied = applyTextRangeAnchorRef.current(
          parsedAnchor.range,
          match?.slug ?? parsedAnchor.sectionSlug,
        );
        if (applied) return;
      }
      if (match) {
        setActiveSectionSlug(match.slug);
        jumpToSectionRef.current(match, { updateHash: false });
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [parsedBill]);

  const visibleSections = useMemo(() => {
    if (!parsedBill) return [];
    return changedSectionsOnly
      ? parsedBill.sections.filter((s) => s.hasChanges)
      : parsedBill.sections;
  }, [parsedBill, changedSectionsOnly]);

  const activeChangeId = reviewState?.currentSuggestionIds?.[0] ?? null;

  const billLabel =
    bill && billType
      ? formatBillNumber(bill.type, bill.number)
      : billType
        ? formatBillNumber(billType, billNumber)
        : "Bill";

  const enactedLaw = bill ? getEnactedLaw(bill) : null;

  return (
    <div className="rc-workspace">
      <SiteHeader
        fullWidth
        crumbs={
          Number.isInteger(congress)
            ? [{ label: `${congressOrdinal(congress)} Congress`, to: `/${congress}` }]
            : []
        }
        pageLabel={billLabel}
        pageBadge={
          enactedLaw ? (
            <LawBadge law={enactedLaw} date={bill?.latestActionDate ?? null} />
          ) : undefined
        }
        pageTitle={bill?.title || (loadingBill ? "Loading bill…" : undefined)}
        actions={
          <span className="rc-credit rc-header-credit rc-hide-sm">
            <span>
              Data from{" "}
              <a
                href={bill?.congressUrl || "https://api.congress.gov"}
                target="_blank"
                rel="noopener noreferrer"
              >
                Congress.gov API
              </a>
            </span>
            <span>
              Rendered with{" "}
              <a
                href="https://revise.io/sdk"
                target="_blank"
                rel="noopener noreferrer"
              >
                Revise SDK
              </a>
            </span>
          </span>
        }
      />

      {/* Status & View Controls Bar (desktop status pill; compact mobile version picker) */}
      {bill && bill.versions.length > 0 && selection && (
        <div className="rc-compare-bar">
          <div className="rc-compare-controls">
            {/* Desktop active-selection summary (driven by left History timeline) */}
            <div className="rc-active-selection rc-desktop-only">
              {selection.mode === "compare" && !showChanges ? (
                <>
                  <span className="rc-selection-prefix">Viewing</span>
                  <StagePill code={selection.to} latest />
                  <span className="rc-selection-label">
                    {bill.versions.find((v) => v.code === selection.to)?.type ||
                      getVersionStageInfo(selection.to).label}
                  </span>
                </>
              ) : selection.mode === "compare" ? (
                <>
                  <span className="rc-selection-prefix">Redline</span>
                  <StagePill code={selection.from} latest />
                  <span className="rc-selection-label">
                    {getVersionStageInfo(selection.from).shortLabel}
                  </span>
                  <span className="rc-stage-arrow">→</span>
                  <StagePill code={selection.to} latest />
                  <span className="rc-selection-label">
                    {getVersionStageInfo(selection.to).shortLabel}
                  </span>
                </>
              ) : (
                <>
                  <span className="rc-selection-prefix">Initial</span>
                  <StagePill code={selection.version} latest />
                  <span className="rc-selection-label">
                    {bill.versions.find((v) => v.code === selection.version)
                      ?.type || getVersionStageInfo(selection.version).label}
                  </span>
                </>
              )}
            </div>

            {/* Mobile-only fallback picker since the left sidebar collapses below 820px */}
            <div className="rc-mobile-version-picker">
              {bill.versions.length >= 2 ? (
                <>
                  <select
                    className="rc-select"
                    aria-label="Compare base version"
                    value={
                      selection.mode === "compare"
                        ? selection.from
                        : selection.version
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (selection.mode === "compare" && val !== selection.to) {
                        navigateToSpec(`${val}..${selection.to}`);
                      } else {
                        navigateToSpec(val);
                      }
                    }}
                  >
                    {bill.versions.map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.code.toUpperCase()} —{" "}
                        {getVersionStageInfo(v.code).shortLabel}
                      </option>
                    ))}
                  </select>
                  {selection.mode === "compare" && (
                    <>
                      <span
                        style={{ color: "var(--content-subtle)", fontSize: 12 }}
                      >
                        →
                      </span>
                      <select
                        className="rc-select"
                        aria-label="Compare target version"
                        value={selection.to}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== selection.from) {
                            navigateToSpec(`${selection.from}..${val}`);
                          }
                        }}
                      >
                        {bill.versions.map((v) => (
                          <option
                            key={v.code}
                            value={v.code}
                            disabled={v.code === selection.from}
                          >
                            {v.code.toUpperCase()} —{" "}
                            {getVersionStageInfo(v.code).shortLabel}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--content-muted)" }}>
                  {bill.versions[0].code.toUpperCase()} —{" "}
                  {bill.versions[0].type}
                </span>
              )}
            </div>

            <div className="rc-compare-downloads">
              {DOWNLOAD_FORMATS.map(({ format, label, title }) => (
                <button
                  key={format}
                  type="button"
                  className="rc-btn rc-btn-secondary rc-btn-sm"
                  disabled={!docxBlob || exporting !== null}
                  data-busy={exporting === format ? "true" : undefined}
                  aria-busy={exporting === format}
                  onClick={() => void handleExport(format)}
                  title={
                    format === "docx"
                      ? showChanges && selection.mode === "compare"
                        ? "Word document with the redline as tracked changes"
                        : "Word document, clean text (Show diff is off)"
                      : title
                  }
                >
                  <Download size={13} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rc-compare-controls">
            {selectionSnapshot &&
              !selectionSnapshot.empty &&
              selectionSnapshot.text.trim().length > 0 && (
                <button
                  type="button"
                  className={`rc-copy-selection-btn${copiedLink ? " is-copied" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleCopySelectionLink()}
                  title="Copy a direct permalink that scrolls to and highlights this selected text"
                >
                  {copiedLink ? <Check size={13} /> : <Link2 size={13} />}
                  <span>
                    {copiedLink ? "Link copied" : "Copy link to text"}
                  </span>
                </button>
              )}

            {selection.mode === "compare" && (
              <label className="rc-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={showChanges}
                  onChange={(e) => setShowChanges(e.target.checked)}
                />
                <span className="rc-switch-track" aria-hidden="true">
                  <span className="rc-switch-thumb" />
                </span>
                <span className="rc-switch-label">Show diff</span>
              </label>
            )}

            <span className="rc-control-label" id="rc-diff-style-label">
              Diff style
            </span>
            <div
              className="rc-segmented"
              role="tablist"
              aria-labelledby="rc-diff-style-label"
            >
              <button
                type="button"
                role="tab"
                aria-selected={markupStyle === "revise"}
                data-active={markupStyle === "revise"}
                onClick={() => setMarkupStyle("revise")}
              >
                Red/Green
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={markupStyle === "word"}
                data-active={markupStyle === "word"}
                onClick={() => setMarkupStyle("word")}
              >
                All red
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Three-Pane Workspace */}
      <div className="rc-workspace-body">
        {/* Left Sidebar: Outline (always visible on desktop) */}
        <aside className="rc-rail">
          <div className="rc-rail-head">
            <span className="rc-rail-title">
              Outline
              {parsedBill && parsedBill.sections.length > 0
                ? ` (${parsedBill.sections.length})`
                : ""}
            </span>
            {parsedBill && parsedBill.stats.totalChanges > 0 && (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  color: "var(--content-muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={changedSectionsOnly}
                  onChange={(e) => setChangedSectionsOnly(e.target.checked)}
                />
                Changed only
              </label>
            )}
          </div>

          <div className="rc-rail-scroll">
            {visibleSections.length === 0 ? (
              <div
                style={{
                  padding: 12,
                  fontSize: 12.5,
                  color: "var(--content-subtle)",
                }}
              >
                {loadingStage
                  ? "Building section index…"
                  : changedSectionsOnly
                    ? "No modified sections in this view."
                    : "No numbered sections detected."}
              </div>
            ) : (
              visibleSections.map((sec) => (
                <a
                  key={`${sec.id}-${sec.blockIndex}`}
                  href={`#${sec.slug}`}
                  className="rc-outline-item"
                  data-level={sec.level}
                  data-slug={sec.slug}
                  data-active={activeSectionSlug === sec.slug ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpToSection(sec);
                  }}
                  title={sec.label}
                >
                  <span>{sec.label}</span>
                  {sec.hasChanges && (
                    <span
                      className="rc-outline-dot"
                      title={`+${sec.insertions} / −${sec.deletions} changes`}
                    />
                  )}
                </a>
              ))
            )}
          </div>
        </aside>

        {/* Center Revise Editor Canvas */}
        <main className="rc-editor-stage">
          {parsedBill && parsedBill.warnings.length > 0 && (
            <div className="rc-banner">
              <span>{parsedBill.warnings[0]}</span>
            </div>
          )}

          {billError || renderError ? (
            <div className="rc-loading-overlay">
              <strong style={{ color: "var(--content-strong)", fontSize: 15 }}>
                Could not display this bill version
              </strong>
              <p style={{ margin: 0, maxWidth: 460 }}>
                {billError || renderError}
              </p>
              {bill?.congressUrl && (
                <a
                  href={bill.congressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rc-btn rc-btn-secondary rc-btn-sm"
                >
                  View on Congress.gov <ArrowUpRight size={13} />
                </a>
              )}
            </div>
          ) : loadingBill || loadingStage || !docxBlob ? (
            <div className="rc-loading-overlay">
              <div className="rc-spinner" />
              <span>{loadingStage || "Loading bill metadata…"}</span>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="rc-loading-overlay">
                  <div className="rc-spinner" />
                  <span>Initializing Revise document viewer…</span>
                </div>
              }
            >
              <ReviseBillCanvas
                docKey={docKey}
                docxBlob={docxBlob}
                title={bill ? `${billLabel} — ${bill.title}` : billLabel}
                theme={theme}
                viewMode={viewMode}
                markupStyle={markupStyle}
                onHandleReady={handleReady}
                onChangesUpdated={handleChangesUpdated}
                onSelectionUpdated={handleSelectionUpdated}
              />
            </Suspense>
          )}
        </main>

        {/* Right Sidebar: History (default) + Changes tabs */}
        <aside className="rc-rail rc-rail-right">
          <div
            className="rc-rail-tabs"
            role="tablist"
            aria-label="Right sidebar view"
          >
            <button
              type="button"
              role="tab"
              className="rc-rail-tab"
              aria-selected={rightTab === "history"}
              data-active={rightTab === "history"}
              onClick={() => setRightTab("history")}
            >
              <span>History</span>
              {bill && bill.versions.length > 0 && (
                <span className="rc-rail-tab-count">{bill.versions.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              className="rc-rail-tab"
              aria-selected={rightTab === "changes"}
              data-active={rightTab === "changes"}
              onClick={() => setRightTab("changes")}
            >
              <span>Changes</span>
              {parsedBill && parsedBill.stats.totalChanges > 0 && (
                <span className="rc-rail-tab-count">
                  {parsedBill.stats.totalChanges}
                </span>
              )}
            </button>
          </div>

          {rightTab === "changes" && (
            <div className="rc-rail-head">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {parsedBill && (
                  <>
                    <span className="rc-stat-ins">
                      +{parsedBill.stats.insertions}
                    </span>
                    <span className="rc-stat-del">
                      −{parsedBill.stats.deletions}
                    </span>
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="rc-icon-btn"
                  disabled={changes.length === 0}
                  onClick={() => editorRef.current?.review.previous()}
                  title="Previous change"
                  aria-label="Previous change"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  className="rc-icon-btn"
                  disabled={changes.length === 0}
                  onClick={() => editorRef.current?.review.next()}
                  title="Next change"
                  aria-label="Next change"
                >
                  <ChevronDown size={15} />
                </button>
              </div>
            </div>
          )}

          <div className="rc-rail-scroll">
            {rightTab === "history" ? (
              <>
                {bill && selection ? (
                  <VersionTimeline
                    versions={bill.versions}
                    enactedLaw={enactedLaw}
                    enactedDate={enactedLaw ? bill.latestActionDate ?? null : null}
                    selection={selection}
                    onSelectSingle={(code) => navigateToSpec(code)}
                    showChanges={showChanges}
                    onSelectCompare={(from, to, via) => {
                      if (via === "range") setShowChanges(true);
                      navigateToSpec(`${from}..${to}`);
                    }}
                  />
                ) : (
                  <div className="rc-timeline-empty">
                    {loadingBill
                      ? "Loading version history…"
                      : "No versions available."}
                  </div>
                )}

                {bill && (bill.sponsorName || bill.latestActionText) && (
                  <div className="rc-bill-info-card">
                    <div className="rc-bill-info-heading">Bill Details</div>
                    {bill.sponsorName && (
                      <div className="rc-bill-info-row">
                        <strong>Sponsor:</strong> {bill.sponsorName}
                        {!bill.sponsorName.includes("[") &&
                        bill.sponsorParty &&
                        bill.sponsorState
                          ? ` (${bill.sponsorParty}-${bill.sponsorState})`
                          : ""}
                      </div>
                    )}
                    {bill.policyArea && (
                      <div className="rc-bill-info-row">
                        <strong>Policy Area:</strong> {bill.policyArea}
                      </div>
                    )}
                    {bill.latestActionText && (
                      <div className="rc-bill-info-row">
                        <strong>Latest Action:</strong>{" "}
                        {bill.latestActionDate
                          ? `(${bill.latestActionDate}) `
                          : ""}
                        {bill.latestActionText}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : changes.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  fontSize: 13,
                  color: "var(--content-subtle)",
                  lineHeight: 1.55,
                }}
              >
                {loadingStage || (parsedBill && parsedBill.stats.totalChanges > 0)
                  ? "Indexing tracked changes…"
                  : selection?.mode === "single" &&
                      bill &&
                      bill.versions.length >= 2
                    ? "This single XML file has no embedded committee markup. Switch to the History tab and drag across two versions to compare them."
                    : "No text differences found between these stages."}
              </div>
            ) : (
              <>
                {changes.slice(0, 400).map((change) => {
                  const isReplace = Boolean(
                    change.deletedText && change.insertedText,
                  );
                  const label = isReplace
                    ? "Replaced"
                    : change.kind === "delete"
                      ? "Deleted"
                      : change.kind === "insert"
                        ? "Inserted"
                        : change.kind;
                  return (
                    <button
                      key={change.id}
                      type="button"
                      className="rc-change-card"
                      data-active={activeChangeId === change.id}
                      onClick={() =>
                        editorRef.current?.review.navigateToSuggestion(
                          change.id,
                        )
                      }
                    >
                      <div className="rc-change-meta">
                        <span
                          className="rc-change-kind"
                          data-kind={
                            change.kind === "delete" && !isReplace
                              ? "delete"
                              : "insert"
                          }
                        >
                          {label}
                        </span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 160,
                          }}
                        >
                          {change.author}
                        </span>
                      </div>
                      <div className="rc-change-snippet">
                        {change.deletedText && (
                          <span className="rc-del">{change.deletedText}</span>
                        )}
                        {change.deletedText && change.insertedText && " "}
                        {change.insertedText && (
                          <span className="rc-ins">{change.insertedText}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {changes.length > 400 && (
                  <div
                    style={{
                      padding: 10,
                      fontSize: 12,
                      color: "var(--content-subtle)",
                      textAlign: "center",
                    }}
                  >
                    Showing first 400 of {changes.length} changes. Use the ↑/↓
                    arrows to step through all changes.
                  </div>
                )}
              </>
            )}
          </div>

        </aside>
      </div>
    </div>
  );
};
