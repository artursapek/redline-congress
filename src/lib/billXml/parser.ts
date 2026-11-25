import { diffBillBlocks, indexSectionsAndStats } from "./diff";
import { parseCongressionalText } from "./textParser";
import type {
  BillBlock,
  BillChangeMark,
  BillParagraph,
  BillRun,
  BillTable,
  ParsedBill,
} from "./types";

const LEVELS: Record<string, number> = {
  division: 0,
  title: 0,
  subtitle: 0,
  chapter: 0,
  subchapter: 0,
  part: 0,
  subpart: 0,
  section: 0,
  subsection: 1,
  paragraph: 2,
  subparagraph: 3,
  clause: 4,
  subclause: 5,
  item: 6,
  subitem: 7,
};

const HEADING_LABELS: Record<string, string> = {
  division: "Division",
  title: "Title",
  subtitle: "Subtitle",
  chapter: "Chapter",
  subchapter: "Subchapter",
  part: "Part",
  subpart: "Subpart",
  section: "Sec.",
};

const INLINE = new Set([
  "added-phrase",
  "deleted-phrase",
  "bold",
  "italic",
  "underline",
  "strike",
  "superscript",
  "subscript",
  "quote",
  "term",
  "short-title",
  "act-name",
  "external-xref",
  "internal-xref",
  "enum-in-header",
  "header-in-text",
  "definition",
  "linebreak",
  "nobreak",
  "sponsor",
  "cosponsor",
  "committee-name",
  "text-to-insert",
  "text-to-strike-out",
  "omitted-text",
  "inline-comment",
  "fraction",
  "proviso",
  "cato-misc",
]);

const elements = (node: Element) => Array.from(node.children);
const child = (node: Element, name: string) =>
  elements(node).find((e) => e.localName === name);
const normalize = (text: string) => text.replace(/[\t\r\n ]+/g, " ");

interface ParseContext {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  link?: string;
  change?: BillChangeMark;
  indent: number;
  quoted: number;
  style?: string;
}

/**
 * Parses U.S. Congressional bill & resolution XML (`bill.dtd` and `resolution.dtd`)
 * into a structured document model with native tracked changes.
 *
 * Adapted and extended from Revise's CongressionalBillParser for all chambers
 * (H.R., S., H.Res., S.Res., H.J.Res., S.J.Res., H.Con.Res., S.Con.Res.) with
 * graceful handling of figures, footnotes, and formulas.
 */
export function parseCongressionalXml(xml: string): ParsedBill {
  const cleaned = xml.replace(/^\uFEFF/, "");
  const head = cleaned.slice(0, 600);

  // Seamless fallback for historical bills (103rd–112th Congress) served as
  // official GPO Formatted Text (.htm <pre> text) when XML is unavailable.
  if (
    /<pre\b/i.test(head) ||
    /<!doctype\s+html/i.test(head) ||
    (/^<html\b/i.test(head.trimStart()) && !/<bill\b|<resolution\b/i.test(head)) ||
    (!head.trimStart().startsWith("<") && head.trim().length > 0)
  ) {
    return parseCongressionalText(cleaned);
  }

  if (/<!ENTITY\s/i.test(cleaned)) {
    throw new Error("XML entity declarations are not supported.");
  }
  const doc = new DOMParser().parseFromString(cleaned, "application/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) {
    throw new Error("Invalid XML: the legislative document is not well-formed.");
  }

  const root = doc.documentElement;
  const rootName = root.localName.toLowerCase();
  if (rootName !== "bill" && rootName !== "resolution" && rootName !== "amendment-doc") {
    throw new Error(
      `Unsupported legislative XML root <${root.tagName}>. Expected <bill> or <resolution>.`,
    );
  }

  return new CongressionalXmlReader().parse(doc);
}

class CongressionalXmlReader {
  private blockSeq = 0;
  private revisionSeq = 0;
  private readonly revisions = new WeakMap<Element, BillChangeMark>();
  private readonly committees = new Map<string, string>();
  private readonly warnings = new Set<string>();

  private nextBlockId(): string {
    return `b-${++this.blockSeq}`;
  }

  parse(document: Document): ParsedBill {
    const root = document.documentElement;

    for (const element of Array.from(root.getElementsByTagName("committee-name"))) {
      const id = element.getAttribute("committee-id");
      const name = normalize(element.textContent ?? "").trim();
      if (id && name) this.committees.set(id, name);
    }

    const baseCtx: ParseContext = { indent: 0, quoted: 0 };
    const rootCtx = this.context(root, baseCtx);
    const rootChildren = elements(root);
    const parsed = rootChildren.map((el) => this.blocks(el, rootCtx));

    // Detect multi-committee competing full substitutes (e.g. House Agriculture +
    // House Financial Services each reporting a full <legis-body changed="added">).
    // Keep the final (primary committee) substitute so the bill isn't duplicated.
    const bodyIndices: number[] = [];
    for (let i = 0; i < rootChildren.length; i++) {
      const name = rootChildren[i].localName;
      if (name === "legis-body" || name === "resolution-body") {
        bodyIndices.push(i);
      }
    }
    const skipBodyIndices = new Set<number>();
    if (
      bodyIndices.length >= 2 &&
      bodyIndices.every((idx) => rootChildren[idx].getAttribute("changed") === "added")
    ) {
      for (let k = 0; k < bodyIndices.length - 1; k++) {
        skipBodyIndices.add(bodyIndices[k]);
      }
      this.warnings.add(
        "Multiple committees reported competing substitutes for this stage; showing the primary committee text.",
      );
    }

    let reportingCommittee: string | undefined;
    const primaryBodyIdx = bodyIndices[bodyIndices.length - 1];
    if (primaryBodyIdx !== undefined) {
      const cid =
        rootChildren[primaryBodyIdx].getAttribute("reporting-committee") ||
        rootChildren[primaryBodyIdx].getAttribute("committee-id");
      if (cid) reportingCommittee = this.committees.get(cid) ?? undefined;
    }

    const blocks: BillBlock[] = [];
    for (let i = 0; i < rootChildren.length; i++) {
      if (skipBodyIndices.has(i)) continue;
      const el = rootChildren[i];
      const currentBlocks = parsed[i];
      const next = rootChildren[i + 1];

      // Handle wholesale "strike all and insert" dual <legis-body> / <resolution-body>
      if (
        (el.localName === "legis-body" || el.localName === "resolution-body") &&
        next?.localName === el.localName &&
        next.getAttribute("display-enacting-clause") ===
          "no-display-enacting-clause" &&
        !skipBodyIndices.has(i + 1)
      ) {
        const replacement = parsed[i + 1];
        const prefixLength =
          el.getAttribute("display-enacting-clause") !==
          "no-display-enacting-clause"
            ? 1
            : 0;
        const beforeBody = currentBlocks.slice(prefixLength);
        if (this.isHomogeneousChange(beforeBody, "delete") && this.isHomogeneousChange(replacement, "insert")) {
          const author = this.firstAuthor(replacement) ?? this.firstAuthor(beforeBody);
          if (author && !reportingCommittee) reportingCommittee = author;
          const refined = diffBillBlocks(beforeBody, replacement, {
            author,
            idPrefix: "strike-replace",
          });
          blocks.push(...currentBlocks.slice(0, prefixLength), ...refined);
          i++;
          continue;
        }
      }
      blocks.push(...currentBlocks);
    }

    if (blocks.length === 0) {
      throw new Error("The Congressional XML document contains no readable content.");
    }

    const form = child(root, "form");
    const legisNum = form && child(form, "legis-num")?.textContent?.trim();
    const shortTitle = root
      .getElementsByTagName("short-title")[0]
      ?.textContent?.trim();
    const dcTitle = document
      .getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]
      ?.textContent?.trim();
    const title = legisNum
      ? [legisNum, shortTitle].filter(Boolean).join(" — ")
      : dcTitle || shortTitle || "Congressional Bill";

    const stage =
      root.getAttribute("bill-stage") ||
      root.getAttribute("resolution-stage") ||
      undefined;

    const { sections, stats } = indexSectionsAndStats(blocks);

    return {
      title,
      legisNum: legisNum || undefined,
      shortTitle: shortTitle || undefined,
      stage,
      hasEmbeddedRevisions: stats.totalChanges > 0,
      committees: Array.from(new Set(this.committees.values())),
      ...(reportingCommittee ? { reportingCommittee } : {}),
      warnings: Array.from(this.warnings),
      blocks,
      sections,
      stats,
    };
  }

  private isHomogeneousChange(
    blocks: BillBlock[],
    kind: "insert" | "delete",
  ): boolean {
    if (blocks.length === 0) return false;
    return blocks.every((b) => {
      if (b.type !== "paragraph") return false;
      return b.runs.length > 0 && b.runs.every((r) => r.change?.kind === kind);
    });
  }

  private firstAuthor(blocks: BillBlock[]): string | undefined {
    for (const b of blocks) {
      if (b.type === "paragraph") {
        for (const r of b.runs) {
          if (r.change?.author) return r.change.author;
        }
      }
    }
    return undefined;
  }

  private context(element: Element, inherited: ParseContext): ParseContext {
    const next: ParseContext = { ...inherited };
    const tag = element.localName;

    const changeAttr =
      element.getAttribute("changed") ??
      (tag === "added-phrase"
        ? "added"
        : tag === "deleted-phrase"
          ? "deleted"
          : null);

    if (changeAttr === "added" || changeAttr === "deleted") {
      const kind = changeAttr === "added" ? "insert" : "delete";
      const committeeId =
        element.getAttribute("reporting-committee") ||
        element.getAttribute("committee-id");
      const author = committeeId
        ? (this.committees.get(committeeId) ?? committeeId)
        : undefined;

      if (
        !next.change ||
        next.change.kind !== kind ||
        (author && author !== next.change.author)
      ) {
        let rev = this.revisions.get(element);
        if (!rev) {
          rev = {
            kind,
            id: `xmlrev-${++this.revisionSeq}`,
            ...(author ? { author } : {}),
          };
          this.revisions.set(element, rev);
        }
        next.change = rev;
      }
    }

    if (tag === "bold") next.bold = true;
    if (tag === "italic") next.italic = true;
    if (tag === "underline") next.underline = true;
    if (tag === "strike") next.strike = true;
    if (tag === "superscript") next.superscript = true;
    if (tag === "subscript") next.subscript = true;

    const href = element.getAttribute("href");
    if (href && /^(https?:\/\/|#)/i.test(href.trim())) {
      next.link = href.trim();
    }
    if (tag === "internal-xref" && element.getAttribute("idref")) {
      next.link = `#${element.getAttribute("idref")}`;
    }

    next.style = element.getAttribute("style") ?? inherited.style;
    return next;
  }

  private run(text: string, ctx: ParseContext): BillRun {
    return {
      text,
      ...(ctx.bold ? { bold: true } : {}),
      ...(ctx.italic ? { italic: true } : {}),
      ...(ctx.underline ? { underline: true } : {}),
      ...(ctx.strike ? { strike: true } : {}),
      ...(ctx.superscript ? { superscript: true } : {}),
      ...(ctx.subscript ? { subscript: true } : {}),
      ...(ctx.link ? { link: ctx.link } : {}),
      ...(ctx.change ? { change: ctx.change } : {}),
    };
  }

  private inline(element: Element, inherited: ParseContext): BillRun[] {
    const ctx = this.context(element, inherited);
    const tag = element.localName;
    if (tag === "linebreak") return [this.run("\n", ctx)];
    if (tag === "graphic") {
      this.warnings.add("One or more embedded graphics were omitted (shown as placeholders).");
      return [this.run("[Graphic omitted — see official GovInfo PDF]", { ...ctx, italic: true })];
    }
    if (tag === "formula") {
      this.warnings.add("One or more mathematical formulas are rendered as plain text.");
      const raw = normalize(element.textContent ?? "").trim();
      return [this.run(raw || "[Formula]", { ...ctx, italic: true })];
    }
    if (tag === "footnote-ref") {
      const text = normalize(element.textContent ?? "").trim();
      return text ? [this.run(`[${text}]`, { ...ctx, superscript: true })] : [];
    }

    const runs: BillRun[] = [];
    const quoted = tag === "quote" || tag === "term";
    if (quoted) runs.push(this.run(ctx.quoted ? "‘" : "“", ctx));

    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3 || node.nodeType === 4) {
        runs.push(this.run(normalize(node.textContent ?? ""), ctx));
      } else if (node.nodeType === 1) {
        runs.push(
          ...this.inline(
            node as Element,
            quoted ? { ...ctx, quoted: ctx.quoted + 1 } : ctx,
          ),
        );
      }
    }

    if (quoted) runs.push(this.run(ctx.quoted ? "’" : "”", ctx));
    return runs;
  }

  private paragraph(
    runs: BillRun[],
    ctx: ParseContext,
    source?: Element,
    heading?: 1 | 2,
  ): BillParagraph | null {
    while (runs.length && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
    if (!runs.length) return null;

    runs[0] = { ...runs[0], text: runs[0].text.replace(/^ +/, "") };
    const lastIdx = runs.length - 1;
    runs[lastIdx] = {
      ...runs[lastIdx],
      text: runs[lastIdx].text.replace(/ +$/, ""),
    };

    if (ctx.quoted) {
      runs.unshift(this.run(ctx.quoted > 1 ? "‘" : "“", ctx));
    }

    const xmlId = source?.getAttribute("id") || undefined;
    if (xmlId) {
      runs[0] = { ...runs[0], bookmark: xmlId };
    }

    // If every run in the paragraph carries the exact same change mark, also tag the paragraph mark.
    const firstChange = runs[0].change;
    const wholeParaChange =
      firstChange &&
      runs.every(
        (r) =>
          r.change?.kind === firstChange.kind &&
          r.change?.id === firstChange.id,
      )
        ? firstChange
        : undefined;

    return {
      type: "paragraph",
      id: this.nextBlockId(),
      runs,
      ...(heading ? { heading } : {}),
      ...(ctx.indent ? { leftIndent: Math.min(ctx.indent, 6) } : {}),
      ...(xmlId ? { xmlId } : {}),
      ...(wholeParaChange ? { paragraphChange: wholeParaChange } : {}),
    };
  }

  private blocks(element: Element, inherited: ParseContext): BillBlock[] {
    const tag = element.localName;
    if (tag === "metadata") return [];

    const ctx = this.context(element, inherited);

    if (tag === "graphic") {
      this.warnings.add("One or more embedded graphics were omitted (shown as placeholders).");
      const p = this.paragraph(
        [this.run("[Graphic omitted — see official GovInfo PDF]", { ...ctx, italic: true })],
        ctx,
        element,
      );
      return p ? [p] : [];
    }

    if (tag === "footnote") {
      this.warnings.add("Footnotes are rendered inline where they appear in the XML.");
      const p = this.paragraph(
        [this.run("Footnote: ", { ...ctx, bold: true }), ...this.inline(element, ctx)],
        { ...ctx, indent: ctx.indent + 1 },
        element,
      );
      return p ? [p] : [];
    }

    if (Object.prototype.hasOwnProperty.call(LEVELS, tag)) {
      return this.structure(element, {
        ...ctx,
        indent: LEVELS[tag] + (ctx.quoted ? 1 : 0),
      });
    }

    if (tag === "table") {
      const groups = elements(element).filter((e) => e.localName === "tgroup");
      if (!groups.length) return this.safeTable(element, ctx);
      return elements(element).flatMap((e) =>
        e.localName === "tgroup"
          ? this.safeTable(e, this.context(e, ctx))
          : this.blocks(e, ctx),
      );
    }

    if (tag === "quoted-block") {
      const innerBlocks = elements(element)
        .filter((e) => e.localName !== "after-quoted-block")
        .flatMap((e) =>
          this.blocks(e, {
            ...ctx,
            quoted: ctx.quoted + 1,
            indent: ctx.indent + 1,
          }),
        );
      const last = innerBlocks[innerBlocks.length - 1];
      const after = child(element, "after-quoted-block");
      if (last?.type === "paragraph") {
        last.runs.push(this.run(ctx.quoted ? "’" : "”", ctx));
        if (after) last.runs.push(...this.inline(after, ctx));
      } else if (after) {
        const p = this.paragraph(
          [this.run(ctx.quoted ? "’" : "”", ctx), ...this.inline(after, ctx)],
          ctx,
        );
        if (p) innerBlocks.push(p);
      }
      return innerBlocks;
    }

    if (tag === "whereas") {
      const runs = [
        this.run("Whereas ", { ...ctx, italic: true }),
        ...this.inline(element, ctx),
      ];
      const p = this.paragraph(runs, ctx, element);
      return p ? [p] : [];
    }

    // Leaf block / mixed inline
    if (!elements(element).some((e) => !INLINE.has(e.localName))) {
      const p = this.paragraph(this.inline(element, inherited), ctx, element);
      if (p && (tag === "legis-num" || tag === "legis-type")) {
        p.align = "center";
        p.runs = p.runs.map((r) => ({ ...r, bold: true }));
      }
      if (p && tag === "congress") {
        p.align = "center";
      }
      if (p && tag === "session") {
        p.align = "center";
      }
      if (p && tag === "current-chamber") {
        p.align = "center";
        p.runs = p.runs.map((r) => ({ ...r, bold: true }));
      }
      return p ? [p] : [];
    }

    const out: BillBlock[] = [];

    if (
      tag === "legis-body" &&
      element.getAttribute("display-enacting-clause") !==
        "no-display-enacting-clause"
    ) {
      const p = this.paragraph(
        [
          this.run(
            "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,",
            { ...ctx, italic: true },
          ),
        ],
        ctx,
      );
      if (p) out.push(p);
    } else if (
      tag === "resolution-body" &&
      element.getAttribute("display-resolving-clause") !==
        "no-display-resolving-clause"
    ) {
      const p = this.paragraph(
        [this.run("Resolved,", { ...ctx, italic: true })],
        ctx,
      );
      if (p) out.push(p);
    }

    let pending: BillRun[] = [];
    const flush = () => {
      const p = this.paragraph(pending, ctx);
      if (p) out.push(p);
      pending = [];
    };

    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3 || node.nodeType === 4) {
        pending.push(this.run(normalize(node.textContent ?? ""), ctx));
      } else if (node.nodeType === 1) {
        const el = node as Element;
        if (INLINE.has(el.localName)) {
          pending.push(...this.inline(el, ctx));
        } else {
          flush();
          out.push(...this.blocks(el, ctx));
        }
      }
    }
    flush();
    return out;
  }

  private structure(element: Element, ctx: ParseContext): BillBlock[] {
    const out: BillBlock[] = [];
    const isHeading = Object.prototype.hasOwnProperty.call(
      HEADING_LABELS,
      element.localName,
    );
    const enumeration = child(element, "enum");
    const header = child(element, "header");
    let pending: BillRun[] = [];

    if (enumeration) {
      if (isHeading) {
        pending.push(
          this.run(
            element.localName === "section" && ctx.style === "USC"
              ? "§ "
              : `${HEADING_LABELS[element.localName]} `,
            ctx,
          ),
        );
      }
      pending.push(...this.inline(enumeration, ctx), this.run(" ", ctx));
    }

    if (header) {
      const headerRuns = this.inline(header, ctx).map((r) => ({
        ...r,
        bold: true,
      }));
      pending.push(...headerRuns);
    }

    const flush = (asHeading = false) => {
      const p = this.paragraph(
        pending,
        ctx,
        out.length ? undefined : element,
        asHeading ? (element.localName === "section" ? 2 : 1) : undefined,
      );
      if (p) out.push(p);
      pending = [];
    };

    if (isHeading) flush(true);

    let firstText = true;
    for (const node of Array.from(element.childNodes)) {
      if (node === enumeration || node === header) continue;
      if (node.nodeType === 3 || node.nodeType === 4) {
        if (node.textContent?.trim()) {
          pending.push(this.run(normalize(node.textContent), ctx));
        }
      } else if (node.nodeType === 1) {
        const el = node as Element;
        if (el.localName === "text") {
          if (!firstText) flush();
          if (firstText && !isHeading && header) {
            pending.push(this.run(".—", ctx));
          }
          pending.push(...this.inline(el, ctx));
          firstText = false;
        } else if (INLINE.has(el.localName)) {
          pending.push(...this.inline(el, ctx));
        } else {
          flush();
          const nested = this.blocks(el, ctx);
          const last = out[out.length - 1];
          if (
            el.getAttribute("display-inline") === "yes-display-inline" &&
            last?.type === "paragraph" &&
            !last.heading &&
            nested[0]?.type === "paragraph"
          ) {
            last.runs.push(this.run(" ", ctx), ...nested[0].runs);
            nested.shift();
          }
          out.push(...nested);
        }
      }
    }
    flush();
    return out;
  }

  private safeTable(element: Element, ctx: ParseContext): BillBlock[] {
    try {
      return [this.table(element, ctx)];
    } catch {
      this.warnings.add("A complex legislative table was flattened to text.");
      const raw = normalize(element.textContent ?? "").trim();
      const p = raw ? this.paragraph([this.run(raw, ctx)], ctx, element) : null;
      return p ? [p] : [];
    }
  }

  private table(element: Element, ctx: ParseContext): BillTable {
    const group = child(element, "tgroup") ?? element;
    const columns = new Map<string, number>();
    elements(group)
      .filter((e) => e.localName === "colspec")
      .forEach((e, i) => {
        const name = e.getAttribute("colname");
        if (name) columns.set(name, Number(e.getAttribute("colnum")) || i + 1);
      });

    const rowSections: Array<{ row: Element; isHeader: boolean }> = [];
    for (const e of elements(group)) {
      if (e.localName === "row") {
        rowSections.push({ row: e, isHeader: false });
      } else if (e.localName === "thead" || e.localName === "tbody" || e.localName === "tfoot") {
        const isHeader = e.localName === "thead";
        for (const r of elements(e)) {
          if (r.localName === "row") rowSections.push({ row: r, isHeader });
        }
      }
    }

    if (!rowSections.length) {
      throw new Error("Empty table");
    }

    let maxCols = 1;
    const rows = rowSections.map(({ row, isHeader }) => {
      const rowCtx = this.context(
        row,
        row.parentElement && row.parentElement !== group
          ? this.context(row.parentElement, ctx)
          : ctx,
      );
      let rowCols = 0;
      const cells = elements(row)
        .filter((e) => e.localName === "entry")
        .map((entry) => {
          const start = entry.getAttribute("namest")
            ? columns.get(entry.getAttribute("namest")!)
            : undefined;
          const end = entry.getAttribute("nameend")
            ? columns.get(entry.getAttribute("nameend")!)
            : undefined;
          const colSpan =
            start && end && end >= start ? Math.min(end - start + 1, 50) : 1;
          const rowSpan = Math.min(
            Math.max(1, Number(entry.getAttribute("morerows") ?? 0) + 1),
            rowSections.length,
          );
          rowCols += colSpan;

          const cellBlocks = this.blocks(entry, {
            ...rowCtx,
            indent: 0,
            ...(isHeader ? { bold: true } : {}),
          });

          return {
            ...(colSpan > 1 ? { colSpan } : {}),
            ...(rowSpan > 1 ? { rowSpan } : {}),
            blocks: cellBlocks.length
              ? cellBlocks
              : [
                  {
                    type: "paragraph" as const,
                    id: this.nextBlockId(),
                    runs: [{ text: "" }],
                  },
                ],
          };
        });
      if (rowCols > maxCols) maxCols = rowCols;
      return { isHeader, cells };
    });

    return {
      type: "table",
      id: this.nextBlockId(),
      columnCount: Math.max(maxCols, columns.size, 1),
      rows,
    };
  }
}
