import { indexSectionsAndStats } from "./diff";
import type { BillBlock, BillParagraph, BillRun, ParsedBill } from "./types";

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function polishGpoTypography(text: string): string {
  return text
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/\s*\.\s*--\s*/g, ".—")
    .replace(/--/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Joins hard-wrapped GPO lines into one logical paragraph while preserving
 * compound hyphenation (`packet-\nswitched` -> `packet-switched`) instead of
 * introducing a spurious space (`packet- switched`).
 */
function joinWrappedGpoLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const piece = raw.trim();
    if (!piece) continue;
    if (!out) {
      out = piece;
      continue;
    }
    // Single trailing hyphen (not `--` em-dash) followed by an alphanumeric word continuation
    if (
      /[A-Za-z0-9]-$/.test(out) &&
      !out.endsWith("--") &&
      /^[A-Za-z0-9]/.test(piece)
    ) {
      out += piece;
    } else {
      out += " " + piece;
    }
  }
  return polishGpoTypography(out);
}

const CLAUSE_END_RE =
  /(?:[.;:!?—]|--)\s*(?:''|”)?$|;\s*(?:and|or)\s*$|:\s*$/i;

// One or more chained enumerators at line start: `(2)`, ``(c)(1)`, `(a)(1)(A)`.
const NEW_ENUM_ITEM_RE =
  /^(?:``|")?(?:\((?:[a-z]{1,2}|\d+|[A-Z]{1,2}|[ivxlcdm]+)\))+(?:\s|$)/;

function extractPreText(raw: string): string {
  const preMatch = raw.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
  const body = preMatch ? preMatch[1] : raw;
  // Strip any inline tags like <DOC>, <all>, <a>, <b>, etc.
  const stripped = body.replace(/<\/?[a-z][^>]*>/gi, "");
  return (
    decodeEntities(stripped)
      .replace(/\r\n?/g, "\n")
      // GPO's end-of-document marker arrives entity-escaped (&lt;all&gt;), so it
      // survives tag stripping; drop it so it doesn't show up as a deleted paragraph.
      .replace(/^[ \t]*<all>[ \t]*$/gm, "")
  );
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

const MAJOR_HEADING_RE =
  /^(?:DIVISION|TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|SUBPART)\s+[A-Z0-9IVXLCDM]+(?:\s*(?:--|—|:|\.)|$)/i;

const BODY_SECTION_HEADING_RE =
  /^(?:SECTION|SEC\.)\s+[0-9]+[A-Za-z0-9.\-]*\.(?:\s|$)/;

const QUOTED_SECTION_HEADING_RE =
  /^(?:``|")?(?:SEC\.|SECTION|§)\s*[0-9]+[A-Za-z0-9.\-]*\.(?:\s|$)/;

const TOC_ENTRY_RE = /^Sec\.\s+[0-9]+[A-Za-z0-9.\-]*\./;

const SUBSECTION_HEADER_RE =
  /^((?:“|")?\([a-zA-Z0-9]+\)\s+(?:[A-Z][^.—]{1,90}\.—)?)/;

function splitInlineBoldRuns(text: string): BillRun[] {
  const match = text.match(SUBSECTION_HEADER_RE);
  if (match && match[1].length < text.length) {
    return [
      { text: match[1], bold: true },
      { text: text.slice(match[1].length) },
    ];
  }
  return [{ text }];
}

function mapGpoIndentToLevel(indentSpaces: number): number {
  if (indentSpaces <= 4) return 0;
  // GPO indents subsections at 4, paragraphs at 12, subparagraphs at 20, clauses at 28...
  return Math.min(7, Math.max(0, Math.round((indentSpaces - 4) / 8)));
}

/**
 * Parses official GPO Formatted Text (`.htm` `<pre>` text, available for every
 * Congressional bill from the 103rd Congress / 1993 onward) into the same
 * structured `ParsedBill` model used by the XML parser, so diffing, outline
 * navigation, permalinks, and OOXML `.docx` generation work identically.
 */
export function parseCongressionalText(raw: string): ParsedBill {
  const preText = extractPreText(raw);
  const rawLines = preText.split("\n");

  const blocks: BillBlock[] = [];
  let seq = 0;
  let legisNum: string | undefined;
  let shortTitle: string | undefined;
  let stage: string | undefined;

  const pushParagraph = (
    runs: BillRun[],
    opts: {
      heading?: 1 | 2;
      align?: "left" | "center" | "right";
      leftIndent?: number;
    } = {},
  ) => {
    const cleanRuns = runs.filter((r) => r.text.length > 0);
    if (cleanRuns.length === 0) return;
    const para: BillParagraph = {
      type: "paragraph",
      id: `txt-${++seq}`,
      runs: cleanRuns,
      ...(opts.heading ? { heading: opts.heading } : {}),
      ...(opts.align && opts.align !== "left" ? { align: opts.align } : {}),
      ...(opts.leftIndent && opts.leftIndent > 0
        ? { leftIndent: opts.leftIndent }
        : {}),
    };
    blocks.push(para);
  };

  // Strip GPO metadata banner lines `[...]` and page markers `[[Page ...]]`
  const lines: string[] = [];
  let bannerDone = false;
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!bannerDone && /^\[.+\]$/.test(trimmed)) {
      const m = trimmed.match(
        /^\[((?:H\.R\.|S\.|H\.\s*J\.\s*Res\.|S\.\s*J\.\s*Res\.|H\.\s*Con\.\s*Res\.|S\.\s*Con\.\s*Res\.|H\.\s*Res\.|S\.\s*Res\.)\s*\d+)\s+(.+)\s+\(([A-Z0-9]+)\)\]$/i,
      );
      if (m) {
        legisNum = m[1].replace(/\s+/g, " ");
        stage = m[3].toLowerCase();
      }
      continue;
    }
    if (trimmed.length > 0) bannerDone = true;
    // Skip inline GPO Statutes-at-Large / bill page markers
    if (/^\[\[Page\s+.+\]\]$/i.test(trimmed)) continue;
    // Skip GPO end-of-document `<all>` markers or pure underscore divider bars
    if (/^_{10,}$/.test(trimmed)) continue;
    lines.push(rawLine);
  }

  let i = 0;
  let inFrontMatter = true;
  let inToc = false;

  // Detect front-matter boundary (`Be it enacted...` or `Resolved...`)
  const enactingIdx = lines.findIndex((l) =>
    /^\s*(?:Be it enacted|Resolved by|That the)/i.test(l),
  );
  if (enactingIdx < 0) inFrontMatter = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Front matter (Congress number, bill number, sponsor/referral, A BILL / An Act, long title)
    if (inFrontMatter && enactingIdx >= 0 && i < enactingIdx) {
      // Group contiguous non-blank lines in front matter
      const chunk: string[] = [trimmed];
      const startIndent = leadingSpaces(line);
      i++;
      while (i < enactingIdx && lines[i].trim().length > 0) {
        const nextTrim = lines[i].trim();
        // Start a new centered header block if indent jumps noticeably
        if (
          /^(?:H\.\s*R\.|S\.|A BILL|An Act|RESOLUTION|IN THE |One Hundred|\d+(?:st|nd|rd|th)\s+CONGRESS)/i.test(
            nextTrim,
          )
        ) {
          break;
        }
        chunk.push(nextTrim);
        i++;
      }
      const joined = polishGpoTypography(chunk.join(" "));
      if (!legisNum) {
        const numMatch = joined.match(
          /^((?:H\.\s*R\.|S\.|H\.\s*J\.\s*Res\.|S\.\s*J\.\s*Res\.|H\.\s*Con\.\s*Res\.|S\.\s*Con\.\s*Res\.|H\.\s*Res\.|S\.\s*Res\.)\s*\d+)$/i,
        );
        if (numMatch) {
          legisNum = numMatch[1].replace(/\s+/g, " ");
        }
      }
      const isCenteredHeader =
        startIndent >= 12 ||
        /^(?:A BILL|An Act|IN THE |AT THE |One Hundred|\d+(?:st|nd|rd|th)\s+CONGRESS)/i.test(
          joined,
        );
      pushParagraph(
        [
          {
            text: joined,
            bold:
              /^(?:A BILL|An Act|H\.\s*R\.|S\.|\d+(?:st|nd|rd|th)\s+CONGRESS|IN THE )/i.test(
                joined,
              ),
          },
        ],
        { align: isCenteredHeader ? "center" : "left" },
      );
      continue;
    }

    if (inFrontMatter && i === enactingIdx) {
      inFrontMatter = false;
      const chunk: string[] = [trimmed];
      i++;
      while (i < lines.length && lines[i].trim().length > 0) {
        chunk.push(lines[i].trim());
        i++;
      }
      pushParagraph([{ text: polishGpoTypography(chunk.join(" ")), italic: true }]);
      continue;
    }

    // Exit Table of Contents once we hit an ALL-CAPS body section heading (`SEC. 2.`, `SEC. 101.`, etc.)
    // or a major heading (`TITLE I`, `Subtitle A`) whose next entry is a body section heading rather than `Sec. N.` TOC lines.
    if (inToc) {
      if (BODY_SECTION_HEADING_RE.test(trimmed)) {
        inToc = false;
      } else if (MAJOR_HEADING_RE.test(trimmed)) {
        // Peek ahead past any wrapped lines of this heading and blank lines to see if TOC continues
        let look = i + 1;
        while (look < lines.length && lines[look].trim().length > 0) {
          const lt = lines[look].trim();
          if (TOC_ENTRY_RE.test(lt) || BODY_SECTION_HEADING_RE.test(lt) || MAJOR_HEADING_RE.test(lt)) {
            break;
          }
          look++;
        }
        while (look < lines.length && lines[look].trim().length === 0) look++;
        const nextLine = look < lines.length ? lines[look].trim() : "";
        if (!TOC_ENTRY_RE.test(nextLine) && !MAJOR_HEADING_RE.test(nextLine)) {
          inToc = false;
        }
      }
    }

    if (inToc) {
      if (TOC_ENTRY_RE.test(trimmed) || MAJOR_HEADING_RE.test(trimmed)) {
        // Collect wrapped TOC entry lines (GPO indents wrapped TOC lines ~10–28 spaces)
        const tocLines = [trimmed];
        const isMajorToc = MAJOR_HEADING_RE.test(trimmed);
        i++;
        while (i < lines.length && lines[i].trim().length > 0) {
          const next = lines[i].trim();
          const nextIndent = leadingSpaces(lines[i]);
          if (
            TOC_ENTRY_RE.test(next) ||
            BODY_SECTION_HEADING_RE.test(next) ||
            MAJOR_HEADING_RE.test(next)
          ) {
            break;
          }
          // Wrapped TOC continuation lines are indented
          if (nextIndent >= 4) {
            tocLines.push(next);
            i++;
          } else {
            break;
          }
        }
        pushParagraph(
          [{ text: joinWrappedGpoLines(tocLines), bold: isMajorToc }],
          { leftIndent: isMajorToc ? 0 : 1 },
        );
        continue;
      } else {
        inToc = false;
      }
    }

    // 1. Major division/title/subtitle heading (Level 1)
    if (MAJOR_HEADING_RE.test(trimmed)) {
      const headingLines = [trimmed];
      i++;
      while (i < lines.length && lines[i].trim().length > 0) {
        const next = lines[i].trim();
        if (BODY_SECTION_HEADING_RE.test(next) || MAJOR_HEADING_RE.test(next)) {
          break;
        }
        // Multi-line centered titles wrap onto a second line
        if (leadingSpaces(lines[i]) >= 4 || next === next.toUpperCase()) {
          headingLines.push(next);
          i++;
        } else {
          break;
        }
      }
      const text = joinWrappedGpoLines(headingLines);
      pushParagraph([{ text, bold: true }], { heading: 1 });
      continue;
    }

    // 2. Section heading (`SECTION 1. ...` or `SEC. 101. ...`) (Level 2)
    if (
      BODY_SECTION_HEADING_RE.test(trimmed) ||
      (leadingSpaces(line) <= 8 && QUOTED_SECTION_HEADING_RE.test(trimmed))
    ) {
      const headingLines = [trimmed];
      i++;
      while (i < lines.length && lines[i].trim().length > 0) {
        const next = lines[i].trim();
        const nextIndent = leadingSpaces(lines[i]);
        if (
          BODY_SECTION_HEADING_RE.test(next) ||
          MAJOR_HEADING_RE.test(next) ||
          /^\([a-z0-9]+\)\s/i.test(next)
        ) {
          break;
        }
        // GPO wraps long ALL-CAPS section titles with ~10–16 spaces indent
        if (nextIndent >= 8) {
          headingLines.push(next);
          i++;
        } else {
          break;
        }
      }
      const text = joinWrappedGpoLines(headingLines);
      pushParagraph([{ text, bold: true }], { heading: 2 });
      continue;
    }

    // 3. Regular legislative paragraph (unwrap hard-wrapped GPO lines cleanly)
    const firstIndent = leadingSpaces(line);
    const paraLines = [trimmed];
    i++;
    while (i < lines.length) {
      const nextRaw = lines[i];
      const nextTrim = nextRaw.trim();
      if (!nextTrim) break;
      if (
        BODY_SECTION_HEADING_RE.test(nextTrim) ||
        MAJOR_HEADING_RE.test(nextTrim) ||
        TOC_ENTRY_RE.test(nextTrim)
      ) {
        break;
      }
      const nextIndent = leadingSpaces(nextRaw);
      const prevLine = paraLines[paraLines.length - 1];
      // Test the paragraph so far, not just its last line: GPO often wraps a
      // trailing "; and" so the last line is a lone "and".
      const prevEndedClause = CLAUSE_END_RE.test(paraLines.join(" "));
      const startsQuotedBlockAfterColon =
        prevLine.endsWith(":") &&
        /^(?:``|")/.test(nextTrim) &&
        nextIndent >= firstIndent;
      // Avoid mistaking mid-sentence inline citations like `(b), (c), or (d)` or
      // `through\n(v) (relating to...)` for a new paragraph enumerator.
      const looksLikeNewItem =
        NEW_ENUM_ITEM_RE.test(nextTrim) &&
        !/^(?:``|")?\([a-zA-Z0-9]+\)\s*(?:,|or\b|and\b|through\b|of\b)/i.test(
          nextTrim,
        );

      if (startsQuotedBlockAfterColon) {
        break;
      }

      // GPO indentation geometry:
      // - Deeper indent (`nextIndent > firstIndent`): always a new nested paragraph.
      // - Stepped out 2+ levels (`nextIndent < firstIndent - 4`): always a new paragraph.
      // - Same indent (`nextIndent === firstIndent`): flush-indented continuation line
      //   UNLESS it starts a new enumerator item (e.g. `(2)` right after `(1)`).
      // - Hanging continuation indent (`nextIndent === firstIndent - 4` for `firstIndent >= 4`):
      //   continuation line UNLESS the previous line ended a clause AND the new line starts
      //   a sibling enumerator stepping out one level.
      if (firstIndent >= 4) {
        if (nextIndent > firstIndent) {
          break;
        }
        if (nextIndent < firstIndent - 4) {
          break;
        }
        if (nextIndent === firstIndent && looksLikeNewItem) {
          break;
        }
        if (nextIndent === firstIndent - 4 && prevEndedClause && looksLikeNewItem) {
          break;
        }
      } else {
        if (nextIndent >= 4) {
          break;
        }
        if (prevEndedClause && looksLikeNewItem) {
          break;
        }
      }

      paraLines.push(nextTrim);
      i++;
    }

    const joined = joinWrappedGpoLines(paraLines);
    if (!shortTitle) {
      const stMatch = joined.match(
        /may be cited as the\s+“([^”]{4,180})”/i,
      );
      if (stMatch) shortTitle = stMatch[1];
    }

    const indentLevel = mapGpoIndentToLevel(firstIndent);
    pushParagraph(splitInlineBoldRuns(joined), { leftIndent: indentLevel });

    // Enter TOC mode right after a "table of contents ... is as follows:" paragraph
    if (/table of contents.*as follows:/i.test(joined)) {
      inToc = true;
    }
  }

  if (blocks.length === 0) {
    throw new Error("The legislative text document contains no readable content.");
  }

  const title = legisNum
    ? [legisNum, shortTitle].filter(Boolean).join(" — ")
    : shortTitle || "Congressional Bill";

  const { sections, stats } = indexSectionsAndStats(blocks);

  return {
    title,
    legisNum,
    shortTitle,
    stage,
    hasEmbeddedRevisions: false,
    committees: [],
    warnings: [],
    blocks,
    sections,
    stats,
  };
}
