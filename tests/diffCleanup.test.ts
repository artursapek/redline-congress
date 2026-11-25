import { describe, expect, it } from "vitest";
import { diffBillBlocks } from "../src/lib/billXml/diff";
import type { BillBlock, BillParagraph } from "../src/lib/billXml/types";

let n = 0;
const para = (text: string): BillParagraph => ({ type: "paragraph", id: `p${++n}`, runs: [{ text }] });
const marked = (blocks: BillBlock[]) =>
  blocks
    .filter((b): b is BillParagraph => b.type === "paragraph")
    .map((p) => p.runs.map((r) => (r.change ? `[${r.change.kind === "insert" ? "+" : "-"}${r.text}]` : r.text)).join(""))
    .join("\n");
/** Number of separate changed stretches (a deletion+insertion pair counts once). */
const fragments = (s: string) => (s.match(/(?:\[[+-][^\]]*\])+/g) ?? []).length;

const intro = "Sec. 1. Short title.";
const outro = "Sec. 3. Effective date.";

describe("semantic cleanup of word-level diffs", () => {
  it("shows a rewritten clause as one change, not word-by-word confetti", () => {
    // From H.R. 1 (119th), §70605(h), placed on calendar → enrolled.
    const before = "(h) Regulations.—The Secretary shall prescribe such regulations or other guidance as may be necessary to prevent avoidance of the tax under this section, including regulations or other guidance to prevent avoidance of such tax through the restructuring of endowment funds or other arrangements designed to reduce or eliminate the value of net investment income or assets subject to the tax imposed by this section.";
    const after = "(h) Regulations.—The Secretary (as defined in subsection (a)(5)) shall issue such regulations or other guidance as may be necessary or appropriate to carry out the purposes of this section (and the amendments made by this section).";
    const out = marked(diffBillBlocks([para(intro), para(before), para(outro)], [para(intro), para(after), para(outro)]));
    expect(out).toContain("(h) Regulations.—The Secretary [-");
    expect(fragments(out)).toBeLessThanOrEqual(2);
  });

  it("keeps small precise edits precise", () => {
    const out = marked(
      diffBillBlocks(
        [para(intro), para("Sec. 711. Expansion of regional information sharing system."), para("designated pursuant to Executive Order 12947 of January 23, 1995"), para(outro)],
        [para(intro), para("Sec. 701. Expansion of regional information sharing system."), para("designated pursuant to Executive Order No. 12947 of January 23, 1995"), para(outro)],
      ),
    );
    expect(out).toContain("Sec. [-711][+701]. Expansion");
    expect(out).toContain("Executive Order [+No. ]12947");
  });
});
