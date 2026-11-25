import type {
  BillBlock,
  BillChangeMark,
  BillChangeStats,
  BillParagraph,
  BillRun,
  BillSectionRef,
  ParsedBill,
} from "./types";

const MAX_DP_PAIRS = 4_000_000;
const MAX_WORD_DP_PAIRS = 500_000;

interface Token {
  raw: string;
  norm: string;
  isSpace: boolean;
  marks: Omit<BillRun, "text" | "change">;
}

function paragraphPlainText(p: BillParagraph): string {
  return p.runs.map((r) => r.text).join("");
}

function blockPlainText(b: BillBlock): string {
  if (b.type === "paragraph") return paragraphPlainText(b);
  return b.rows
    .map((row) =>
      row.cells
        .map((cell) => cell.blocks.map(blockPlainText).join(" "))
        .join("\t"),
    )
    .join("\n");
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tokenizeWordsForSimilarity(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g);
  return new Set(words ?? []);
}

function wordSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of smaller) {
    if (larger.has(w)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

function tokenizeRuns(runs: BillRun[]): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    const { text, change: _change, ...marks } = run;
    const parts = text.match(/\s+|[^\s\w]+|\w+/g);
    if (!parts) continue;
    for (const part of parts) {
      tokens.push({
        raw: part,
        norm: /^\s+$/.test(part) ? " " : part,
        isSpace: /^\s+$/.test(part),
        marks,
      });
    }
  }
  return tokens;
}

/**
 * Standard LCS index pairs on two string arrays with prefix/suffix trimming.
 * Falls back to hash-anchored greedy matching if arrays exceed `maxPairs`.
 */
function alignSequences(
  a: string[],
  b: string[],
  maxPairs: number,
): Array<[number, number]> {
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;

  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const prefix: Array<[number, number]> = [];
  for (let i = 0; i < start; i++) prefix.push([i, i]);

  const suffix: Array<[number, number]> = [];
  const suffixLen = a.length - 1 - endA;
  for (let i = 0; i < suffixLen; i++) {
    suffix.push([endA + 1 + i, endB + 1 + i]);
  }

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);

  if (midA.length === 0 || midB.length === 0) {
    return [...prefix, ...suffix];
  }

  let middle: Array<[number, number]>;
  if (midA.length * midB.length <= maxPairs) {
    middle = lcsDp(midA, midB).map(([i, j]) => [i + start, j + start]);
  } else {
    // Unique-anchor patience-style fallback for huge sequences.
    middle = anchorAlign(midA, midB, maxPairs).map(([i, j]) => [
      i + start,
      j + start,
    ]);
  }

  return [...prefix, ...middle, ...suffix];
}

function lcsDp(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const stride = m + 1;
  const dp = new Int32Array((n + 1) * stride);

  for (let i = n - 1; i >= 0; i--) {
    const ai = a[i];
    const row = i * stride;
    const nextRow = (i + 1) * stride;
    for (let j = m - 1; j >= 0; j--) {
      if (ai === b[j]) {
        dp[row + j] = dp[nextRow + j + 1] + 1;
      } else {
        const down = dp[nextRow + j];
        const right = dp[row + j + 1];
        dp[row + j] = down >= right ? down : right;
      }
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Finds unique-item LIS anchors, then recursively refines gaps between anchors.
 * Lets us diff 3,000+ paragraph omnibus bills cleanly in <150ms.
 */
function anchorAlign(
  a: string[],
  b: string[],
  maxPairs: number,
  depth = 0,
): Array<[number, number]> {
  if (a.length === 0 || b.length === 0) return [];
  if (a.length * b.length <= maxPairs) return lcsDp(a, b);
  if (depth > 8) return [];

  const countsA = new Map<string, number>();
  const indexA = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    countsA.set(a[i], (countsA.get(a[i]) ?? 0) + 1);
    indexA.set(a[i], i);
  }
  const countsB = new Map<string, number>();
  const indexB = new Map<string, number>();
  for (let j = 0; j < b.length; j++) {
    countsB.set(b[j], (countsB.get(b[j]) ?? 0) + 1);
    indexB.set(b[j], j);
  }

  // Collect unique matches in order of appearance in A
  const matches: Array<[number, number]> = [];
  for (let i = 0; i < a.length; i++) {
    const val = a[i];
    if (countsA.get(val) === 1 && countsB.get(val) === 1) {
      matches.push([i, indexB.get(val)!]);
    }
  }

  if (matches.length === 0) {
    // Fallback: match rare strings (freq <= 3) greedily in order
    const posB = new Map<string, number[]>();
    for (let j = 0; j < b.length; j++) {
      const list = posB.get(b[j]);
      if (list) list.push(j);
      else posB.set(b[j], [j]);
    }
    const greedy: Array<[number, number]> = [];
    let lastJ = -1;
    for (let i = 0; i < a.length; i++) {
      const list = posB.get(a[i]);
      if (!list || list.length > 6) continue;
      const nextJ = list.find((j) => j > lastJ);
      if (nextJ !== undefined) {
        greedy.push([i, nextJ]);
        lastJ = nextJ;
      }
    }
    return greedy;
  }

  // LIS on the B indices of matches
  const anchors = lisBySecond(matches);
  const out: Array<[number, number]> = [];
  let prevA = 0;
  let prevB = 0;
  for (const [ai, bj] of anchors) {
    if (ai > prevA && bj > prevB) {
      const gap = anchorAlign(
        a.slice(prevA, ai),
        b.slice(prevB, bj),
        maxPairs,
        depth + 1,
      );
      for (const [gi, gj] of gap) out.push([prevA + gi, prevB + gj]);
    }
    out.push([ai, bj]);
    prevA = ai + 1;
    prevB = bj + 1;
  }
  if (prevA < a.length && prevB < b.length) {
    const tail = anchorAlign(
      a.slice(prevA),
      b.slice(prevB),
      maxPairs,
      depth + 1,
    );
    for (const [gi, gj] of tail) out.push([prevA + gi, prevB + gj]);
  }
  return out;
}

function lisBySecond(pairs: Array<[number, number]>): Array<[number, number]> {
  const n = pairs.length;
  if (n === 0) return [];
  const tails: number[] = [];
  const prev = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = pairs[i][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < val) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }

  const res: Array<[number, number]> = [];
  let k = tails[tails.length - 1];
  while (k !== -1) {
    res.push(pairs[k]);
    k = prev[k];
  }
  res.reverse();
  return res;
}

function mergeAdjacentRuns(runs: BillRun[]): BillRun[] {
  const merged: BillRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.underline === run.underline &&
      prev.strike === run.strike &&
      prev.superscript === run.superscript &&
      prev.subscript === run.subscript &&
      prev.link === run.link &&
      prev.bookmark === run.bookmark &&
      prev.change?.kind === run.change?.kind &&
      prev.change?.id === run.change?.id &&
      prev.change?.author === run.change?.author
    ) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function stripChangeMarks(runs: BillRun[]): BillRun[] {
  return runs.map(({ change: _c, ...rest }) => ({ ...rest }));
}

function applyChangeMark(runs: BillRun[], mark: BillChangeMark): BillRun[] {
  return runs.map((r) => ({ ...r, change: mark }));
}

/** Word-level diff between two matched paragraphs. */
function diffParagraphRuns(
  before: BillParagraph,
  after: BillParagraph,
  nextChangeId: () => string,
  author?: string,
): BillParagraph {
  const beforeTokens = tokenizeRuns(before.runs);
  const afterTokens = tokenizeRuns(after.runs);

  const pairs = alignSequences(
    beforeTokens.map((t) => t.norm),
    afterTokens.map((t) => t.norm),
    MAX_WORD_DP_PAIRS,
  );

  const out: BillRun[] = [];
  let ai = 0;
  let bi = 0;

  const flushChangeSpan = (endA: number, endB: number) => {
    if (ai < endA) {
      const delMark: BillChangeMark = {
        kind: "delete",
        id: nextChangeId(),
        ...(author ? { author } : {}),
      };
      for (let k = ai; k < endA; k++) {
        out.push({
          ...beforeTokens[k].marks,
          text: beforeTokens[k].raw,
          change: delMark,
        });
      }
    }
    if (bi < endB) {
      const insMark: BillChangeMark = {
        kind: "insert",
        id: nextChangeId(),
        ...(author ? { author } : {}),
      };
      for (let k = bi; k < endB; k++) {
        out.push({
          ...afterTokens[k].marks,
          text: afterTokens[k].raw,
          change: insMark,
        });
      }
    }
  };

  for (const [mi, mj] of pairs) {
    flushChangeSpan(mi, mj);
    out.push({
      ...afterTokens[mj].marks,
      text: afterTokens[mj].raw,
    });
    ai = mi + 1;
    bi = mj + 1;
  }
  flushChangeSpan(beforeTokens.length, afterTokens.length);

  return {
    ...after,
    paragraphChange: undefined,
    runs: mergeAdjacentRuns(out),
  };
}

function markWholeBlock(
  block: BillBlock,
  kind: "insert" | "delete",
  nextChangeId: () => string,
  author?: string,
): BillBlock {
  const mark: BillChangeMark = {
    kind,
    id: nextChangeId(),
    ...(author ? { author } : {}),
  };
  if (block.type === "paragraph") {
    return {
      ...block,
      paragraphChange: mark,
      runs: applyChangeMark(stripChangeMarks(block.runs), mark),
    };
  }
  return {
    ...block,
    rows: block.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        blocks: cell.blocks.map((b) =>
          markWholeBlock(b, kind, nextChangeId, author),
        ),
      })),
    })),
  };
}

function cleanBlock(block: BillBlock): BillBlock {
  if (block.type === "paragraph") {
    return {
      ...block,
      paragraphChange: undefined,
      runs: mergeAdjacentRuns(stripChangeMarks(block.runs)),
    };
  }
  return {
    ...block,
    rows: block.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        blocks: cell.blocks.map(cleanBlock),
      })),
    })),
  };
}

/**
 * Diffs two arrays of BillBlocks into a single block stream with tracked changes.
 * Accepts exact-match anchors first, then pairs modified paragraphs by word overlap
 * inside each gap so edited sections read as crisp inline word redlines.
 */
export function diffBillBlocks(
  before: BillBlock[],
  after: BillBlock[],
  options: {
    author?: string;
    idPrefix?: string;
  } = {},
): BillBlock[] {
  let seq = 0;
  const prefix = options.idPrefix ?? "diff";
  const nextId = () => `${prefix}-${++seq}`;

  const keysA = before.map((b) => normalizeForMatch(blockPlainText(b)));
  const keysB = after.map((b) => normalizeForMatch(blockPlainText(b)));

  const anchors = alignSequences(keysA, keysB, MAX_DP_PAIRS);
  const result: BillBlock[] = [];

  const diffGap = (aSlice: BillBlock[], bSlice: BillBlock[]) => {
    // Paragraphs that were only split, merged or re-broken (same words, different
    // paragraph boundaries) are not real changes: show them as unchanged and
    // diff only what lies between them.
    const groups = findResegmentedGroups(aSlice, bSlice);
    if (groups.length > 0) {
      let ga = 0;
      let gb = 0;
      for (const g of groups) {
        diffGapPairs(aSlice.slice(ga, g.aStart), bSlice.slice(gb, g.bStart));
        for (let k = g.bStart; k < g.bEnd; k++) result.push(cleanBlock(bSlice[k]));
        ga = g.aEnd;
        gb = g.bEnd;
      }
      diffGapPairs(aSlice.slice(ga), bSlice.slice(gb));
      return;
    }
    diffGapPairs(aSlice, bSlice);
  };

  const diffGapPairs = (aSlice: BillBlock[], bSlice: BillBlock[]) => {
    if (aSlice.length === 0 && bSlice.length === 0) return;
    if (aSlice.length === 0) {
      for (const b of bSlice) {
        result.push(markWholeBlock(b, "insert", nextId, options.author));
      }
      return;
    }
    if (bSlice.length === 0) {
      for (const a of aSlice) {
        result.push(markWholeBlock(a, "delete", nextId, options.author));
      }
      return;
    }

    // For bounded gaps of paragraphs, pair best word-overlap paragraphs monotonically.
    const aWordSets = aSlice.map((b) =>
      b.type === "paragraph"
        ? tokenizeWordsForSimilarity(paragraphPlainText(b))
        : null,
    );
    const bWordSets = bSlice.map((b) =>
      b.type === "paragraph"
        ? tokenizeWordsForSimilarity(paragraphPlainText(b))
        : null,
    );

    const paired = pairSimilarParagraphs(aSlice, bSlice, aWordSets, bWordSets);
    let ai = 0;
    let bi = 0;
    for (const [pi, pj] of paired) {
      while (ai < pi) {
        result.push(markWholeBlock(aSlice[ai++], "delete", nextId, options.author));
      }
      while (bi < pj) {
        result.push(markWholeBlock(bSlice[bi++], "insert", nextId, options.author));
      }
      const aBlock = aSlice[pi] as BillParagraph;
      const bBlock = bSlice[pj] as BillParagraph;
      result.push(diffParagraphRuns(aBlock, bBlock, nextId, options.author));
      ai = pi + 1;
      bi = pj + 1;
    }
    while (ai < aSlice.length) {
      result.push(markWholeBlock(aSlice[ai++], "delete", nextId, options.author));
    }
    while (bi < bSlice.length) {
      result.push(markWholeBlock(bSlice[bi++], "insert", nextId, options.author));
    }
  };

  let prevA = 0;
  let prevB = 0;
  for (const [ai, bi] of anchors) {
    if (ai > prevA || bi > prevB) {
      diffGap(before.slice(prevA, ai), after.slice(prevB, bi));
    }
    result.push(cleanBlock(after[bi]));
    prevA = ai + 1;
    prevB = bi + 1;
  }
  if (prevA < before.length || prevB < after.length) {
    diffGap(before.slice(prevA), after.slice(prevB));
  }

  return result;
}

/** Max paragraphs on either side of one split/merge/re-break group. */
const MAX_RESEGMENT_SPAN = 8;

/** Whitespace-free text, so "following:" + "“Sec." equals "following: “Sec.". */
function resegmentKey(block: BillBlock): string | null {
  return block.type === "paragraph" ? paragraphPlainText(block).replace(/\s+/g, "") : null;
}

/**
 * Finds runs of paragraphs a[i..i') and b[j..j') whose concatenated text is
 * identical apart from whitespace even though the individual paragraphs differ:
 * the text was split, merged, or re-broken at different points (common in historical
 * GPO text, where paragraphs are reconstructed from line wrapping).
 * Returns non-overlapping, monotonic groups in document order.
 */
function findResegmentedGroups(
  aSlice: BillBlock[],
  bSlice: BillBlock[],
): Array<{ aStart: number; aEnd: number; bStart: number; bEnd: number }> {
  const aKeys = aSlice.map(resegmentKey);
  const bKeys = bSlice.map(resegmentKey);
  const groups: Array<{ aStart: number; aEnd: number; bStart: number; bEnd: number }> = [];

  // Index b paragraphs by a short prefix so candidate starting points are cheap to find.
  const PREFIX = 12;
  const bByPrefix = new Map<string, number[]>();
  bKeys.forEach((k, j) => {
    if (!k) return;
    const p = k.slice(0, PREFIX);
    const list = bByPrefix.get(p);
    if (list) list.push(j);
    else bByPrefix.set(p, [j]);
  });

  let minJ = 0;
  for (let i = 0; i < aSlice.length; i++) {
    const ak = aKeys[i];
    if (!ak) continue;
    const candidates = (bByPrefix.get(ak.slice(0, PREFIX)) ?? []).filter((j) => j >= minJ);
    for (const j of candidates) {
      // Two-pointer walk: extend whichever side is shorter while one is a prefix of the other.
      let ia = i + 1;
      let jb = j + 1;
      let sa = ak;
      let sb = bKeys[j]!;
      while (sa !== sb && ia - i <= MAX_RESEGMENT_SPAN && jb - j <= MAX_RESEGMENT_SPAN) {
        if (sa.length < sb.length && sb.startsWith(sa) && ia < aSlice.length && aKeys[ia]) {
          sa += aKeys[ia++];
        } else if (sb.length < sa.length && sa.startsWith(sb) && jb < bSlice.length && bKeys[jb]) {
          sb += bKeys[jb++];
        } else {
          break;
        }
      }
      // Equal paragraph counts are fine too: a break can shift without adding
      // a paragraph ("…the following:" | "“Whoever…" vs "…the following: “Whoever…" | "scans…").
      if (sa === sb && sa.length > 0) {
        groups.push({ aStart: i, aEnd: ia, bStart: j, bEnd: jb });
        i = ia - 1;
        minJ = jb;
        break;
      }
    }
  }
  return groups;
}

/** Above this many a×b cells, paragraph pairing switches to the indexed strategy. */
const MAX_PAIRING_DP_CELLS = 40_000;

/**
 * Pairing for large gaps. Each before-paragraph is matched to its most similar
 * after-paragraph, found through an inverted index of rarer words (so matches
 * can be any distance apart; the Senate substitute for H.R. 3633 inserts
 * ~440 paragraphs, which a position window can't bridge). The longest
 * in-order chain of those matches becomes the skeleton, and the exact DP
 * pairs whatever lies between consecutive matches (short paragraphs such as
 * "(A) In general.—" have no distinctive words to index).
 */
function pairLargeGap(
  aSlice: BillBlock[],
  bSlice: BillBlock[],
  aSets: Array<Set<string> | null>,
  bSets: Array<Set<string> | null>,
  threshold: number,
): Array<[number, number]> {
  const n = aSlice.length;
  const m = bSlice.length;

  // Document frequency of each word across the after side.
  const df = new Map<string, number>();
  for (const set of bSets) if (set) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const RARE_DF = Math.max(12, Math.ceil(m * 0.01));
  const index = new Map<string, number[]>();
  bSets.forEach((set, j) => {
    if (!set) return;
    for (const w of set) {
      if ((df.get(w) ?? 0) > RARE_DF) continue;
      const list = index.get(w);
      if (list) list.push(j);
      else index.set(w, [j]);
    }
  });

  const candidates: Array<[number, number]> = [];
  const TOP_K = 6;
  for (let i = 0; i < n; i++) {
    const aSet = aSets[i];
    if (!aSet) continue;
    const hits = new Map<number, number>();
    for (const w of aSet) {
      const list = index.get(w);
      if (!list) continue;
      for (const j of list) hits.set(j, (hits.get(j) ?? 0) + 1);
    }
    if (hits.size === 0) continue;
    const top = [...hits.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP_K);
    let bestJ = -1;
    let bestScore = threshold;
    for (const [j] of top) {
      const score = wordSimilarity(aSet, bSets[j]!);
      if (score > bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }
    if (bestJ !== -1) candidates.push([i, bestJ]);
  }

  // Keep the longest chain that preserves document order on both sides.
  const skeleton = lisBySecond(candidates);

  // Fill each stretch between skeleton pairs (and before/after) with the exact pairing.
  const result: Array<[number, number]> = [];
  let prevI = 0;
  let prevJ = 0;
  const fill = (endI: number, endJ: number) => {
    if (endI <= prevI || endJ <= prevJ) return;
    const sub = pairSimilarParagraphs(
      aSlice.slice(prevI, endI),
      bSlice.slice(prevJ, endJ),
      aSets.slice(prevI, endI),
      bSets.slice(prevJ, endJ),
    );
    for (const [si, sj] of sub) result.push([si + prevI, sj + prevJ]);
  };
  for (const [i, j] of skeleton) {
    fill(i, j);
    result.push([i, j]);
    prevI = i + 1;
    prevJ = j + 1;
  }
  fill(n, m);
  return result;
}

function pairSimilarParagraphs(
  aSlice: BillBlock[],
  bSlice: BillBlock[],
  aSets: Array<Set<string> | null>,
  bSets: Array<Set<string> | null>,
): Array<[number, number]> {
  const n = aSlice.length;
  const m = bSlice.length;
  const THRESHOLD = 0.34;

  // Large gaps (e.g. a committee substitute that rewrites and re-numbers the
  // whole bill) are too big for the quadratic DP below. Pair by indexed
  // similarity instead, then run the DP inside the small stretches between.
  if (n * m > MAX_PAIRING_DP_CELLS) {
    return pairLargeGap(aSlice, bSlice, aSets, bSets, THRESHOLD);
  }

  // Optimal monotonic max-similarity pairing via DP
  const stride = m + 1;
  const dp = new Float32Array((n + 1) * stride);
  const choice = new Uint8Array((n + 1) * stride); // 1 = pair, 2 = skip A, 3 = skip B

  for (let i = n - 1; i >= 0; i--) {
    const aSet = aSets[i];
    const row = i * stride;
    const nextRow = (i + 1) * stride;
    for (let j = m - 1; j >= 0; j--) {
      let best = dp[nextRow + j];
      let dir = 2;
      if (dp[row + j + 1] > best) {
        best = dp[row + j + 1];
        dir = 3;
      }
      const bSet = bSets[j];
      if (aSet && bSet) {
        const sim = wordSimilarity(aSet, bSet);
        if (sim >= THRESHOLD) {
          const cand = sim + dp[nextRow + j + 1];
          if (cand > best) {
            best = cand;
            dir = 1;
          }
        }
      }
      dp[row + j] = best;
      choice[row + j] = dir;
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const dir = choice[i * stride + j];
    if (dir === 1) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dir === 2) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Resolves all tracked changes in a ParsedBill to produce either its final or original clean text. */
export function resolveBillRevisions(
  bill: ParsedBill,
  mode: "accept" | "reject",
): ParsedBill {
  const keepKind = mode === "accept" ? "insert" : "delete";
  const dropKind = mode === "accept" ? "delete" : "insert";

  const resolveBlocks = (blocks: BillBlock[]): BillBlock[] => {
    const out: BillBlock[] = [];
    for (const block of blocks) {
      if (block.type === "paragraph") {
        if (block.paragraphChange?.kind === dropKind) continue;
        const runs: BillRun[] = [];
        for (const run of block.runs) {
          if (run.change?.kind === dropKind) continue;
          if (run.change?.kind === keepKind) {
            const { change: _c, ...clean } = run;
            runs.push(clean);
          } else {
            runs.push({ ...run });
          }
        }
        const merged = mergeAdjacentRuns(runs);
        if (merged.length > 0 && merged.some((r) => r.text.trim().length > 0)) {
          out.push({
            ...block,
            paragraphChange: undefined,
            runs: merged,
          });
        }
      } else {
        out.push({
          ...block,
          rows: block.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              blocks: resolveBlocks(cell.blocks),
            })),
          })),
        });
      }
    }
    return out;
  };

  const blocks = resolveBlocks(bill.blocks);
  const { sections, stats } = indexSectionsAndStats(blocks);
  return {
    ...bill,
    hasEmbeddedRevisions: false,
    blocks,
    sections,
    stats,
  };
}

/** Compares two parsed bill versions (using each version's accepted final text). */
export function compareParsedBills(
  before: ParsedBill,
  after: ParsedBill,
  options: { author?: string } = {},
): ParsedBill {
  const cleanBefore = resolveBillRevisions(before, "accept");
  const cleanAfter = resolveBillRevisions(after, "accept");

  // Skip front-matter metadata blocks before the enacting clause if both have legis-body,
  // or diff everything cleanly so action headers & titles also reflect updates.
  const diffedBlocks = diffBillBlocks(cleanBefore.blocks, cleanAfter.blocks, {
    author: options.author,
    idPrefix: "verdiff",
  });
  const { sections, stats } = indexSectionsAndStats(diffedBlocks);

  return {
    title: after.title || before.title,
    legisNum: after.legisNum || before.legisNum,
    shortTitle: after.shortTitle || before.shortTitle,
    stage: after.stage,
    hasEmbeddedRevisions: stats.totalChanges > 0,
    committees: after.committees,
    warnings: Array.from(new Set([...before.warnings, ...after.warnings])),
    blocks: diffedBlocks,
    sections,
    stats,
  };
}

/**
 * Produces a clean, deterministic URL anchor slug for a legislative heading:
 * - "Sec. 101. Definitions..." -> "sec-101"
 * - "[Removed] Sec. 101. Definitions..." -> "removed-sec-101"
 * - "Title II—Offers and Sales" -> "title-ii"
 * - "“Sec. 4B. Requirements..." -> "sec-4b"
 * Falls back to slugifying the label text and deduplicates with -2, -3, etc.
 */
function buildSectionSlug(
  label: string,
  isRemoved: boolean,
  usedSlugs: Set<string>,
): string {
  const cleaned = label
    .replace(/^\[Removed\]\s*/i, "")
    .replace(/^[“"‘'\s]+/, "")
    .trim();

  let base = "";
  const match =
    /^(division|title|subtitle|chapter|subchapter|part|subpart|section|sec\.?|§)\s+([0-9a-zA-Z]+(?:[.-][0-9a-zA-Z]+)*)/i.exec(
      cleaned,
    );
  if (match) {
    const rawKind = match[1].replace(/\./g, "").toLowerCase();
    const kind = rawKind === "§" || rawKind === "section" ? "sec" : rawKind;
    const num = match[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    base = `${kind}-${num}`;
  } else {
    base = cleaned
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  if (!base) base = "section";
  if (isRemoved) base = `removed-${base}`;

  let candidate = base;
  let suffix = 2;
  while (usedSlugs.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  usedSlugs.add(candidate);
  return candidate;
}

/** Builds the section outline and change counts from a block list. */
export function indexSectionsAndStats(blocks: BillBlock[]): {
  sections: BillSectionRef[];
  stats: BillChangeStats;
} {
  const sections: BillSectionRef[] = [];
  const usedSlugs = new Set<string>();
  const insertionIds = new Set<string>();
  const deletionIds = new Set<string>();
  let changedParagraphs = 0;

  let currentSection: BillSectionRef | null = null;
  let currentSecIns = new Set<string>();
  let currentSecDel = new Set<string>();

  const flushSection = () => {
    if (!currentSection) return;
    currentSection.insertions = currentSecIns.size;
    currentSection.deletions = currentSecDel.size;
    currentSection.hasChanges =
      currentSection.insertions > 0 || currentSection.deletions > 0;
    sections.push(currentSection);
  };

  const inspectBlock = (block: BillBlock) => {
    if (block.type === "paragraph") {
      let pChanged = false;
      for (const run of block.runs) {
        if (!run.change) continue;
        pChanged = true;
        if (run.change.kind === "insert") {
          insertionIds.add(run.change.id);
          currentSecIns.add(run.change.id);
        } else {
          deletionIds.add(run.change.id);
          currentSecDel.add(run.change.id);
        }
      }
      if (pChanged) changedParagraphs++;
    } else {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const child of cell.blocks) inspectBlock(child);
        }
      }
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "paragraph" && block.heading) {
      flushSection();
      // Build heading label from non-deleted runs so inline edits like
      // "titles -> title" render cleanly as "Short title", not "Short titlestitle".
      const activeText = block.runs
        .filter((r) => r.change?.kind !== "delete")
        .map((r) => r.text)
        .join("");
      const fallbackText = paragraphPlainText(block);
      const isRemovedHeading = activeText.trim().length === 0;
      const cleanLabel = normalizeForMatch(
        isRemovedHeading ? fallbackText : activeText,
      ).slice(0, 140);
      const labelText =
        (isRemovedHeading ? `[Removed] ${cleanLabel}` : cleanLabel) ||
        `Section ${sections.length + 1}`;
      currentSection = {
        id: block.xmlId || block.id,
        slug: buildSectionSlug(labelText, isRemovedHeading, usedSlugs),
        label: labelText,
        level: block.heading,
        blockIndex: i,
        hasChanges: false,
        insertions: 0,
        deletions: 0,
      };
      currentSecIns = new Set<string>();
      currentSecDel = new Set<string>();
    }
    inspectBlock(block);
  }
  flushSection();

  const changedSections = sections.filter((s) => s.hasChanges).length;
  return {
    sections,
    stats: {
      totalChanges: insertionIds.size + deletionIds.size,
      insertions: insertionIds.size,
      deletions: deletionIds.size,
      changedParagraphs,
      totalBlocks: blocks.length,
      changedSections,
    },
  };
}
