import { describe, expect, it } from "vitest";
import { diffBillBlocks } from "../src/lib/billXml/diff";
import type { BillBlock, BillParagraph } from "../src/lib/billXml/types";

let n = 0;
const para = (text: string): BillParagraph => ({ type: "paragraph", id: `p${++n}`, runs: [{ text }] });
const hasChanges = (blocks: BillBlock[]) =>
  blocks.some(
    (b) => b.type === "paragraph" && (b.paragraphChange || b.runs.some((r) => r.change)),
  );
const texts = (blocks: BillBlock[]) =>
  blocks.map((b) => (b.type === "paragraph" ? b.runs.map((r) => r.text).join("") : ""));

const intro = "Sec. 1. Short title.";
const outro = "Sec. 3. Effective date.";

describe("paragraph splits, merges and re-breaks", () => {
  it("shows a pure split as unchanged", () => {
    const before = [para(intro), para("(b) Clerical Amendment.—Insert the following: “Sec. 236A. Detention.”"), para(outro)];
    const after = [para(intro), para("(b) Clerical Amendment.—Insert the following:"), para("“Sec. 236A. Detention.”"), para(outro)];
    const out = diffBillBlocks(before, after);
    expect(hasChanges(out)).toBe(false);
    expect(texts(out)).toEqual(texts(after));
  });

  it("shows a pure merge as unchanged", () => {
    const before = [para(intro), para("(b) Clerical Amendment.—Insert the following:"), para("“Sec. 236A. Detention.”"), para(outro)];
    const after = [para(intro), para("(b) Clerical Amendment.—Insert the following: “Sec. 236A. Detention.”"), para(outro)];
    expect(hasChanges(diffBillBlocks(before, after))).toBe(false);
  });

  it("shows a shifted paragraph break as unchanged", () => {
    const before = [para(intro), para("the following:"), para("“Sec. 236A. Detention; habeas corpus;"), para("judicial review.”."), para(outro)];
    const after = [para(intro), para("the following: “Sec. 236A. Detention;"), para("habeas corpus; judicial review.”."), para(outro)];
    // 3 -> 2 paragraphs, same words: no changes.
    expect(hasChanges(diffBillBlocks(before, after))).toBe(false);
  });

  it("shows a break shifted between the same number of paragraphs as unchanged", () => {
    const before = [para(intro), para("(1) In general.—Insert the following new paragraph:"), para("“Whoever, with intent to defraud, makes, acquires, scans, captures, records,"), para(outro)];
    const after = [para(intro), para("(1) In general.—Insert the following new paragraph: “Whoever, with intent to defraud, makes, acquires,"), para("scans, captures, records,"), para(outro)];
    expect(hasChanges(diffBillBlocks(before, after))).toBe(false);
  });

  it("still reports real word changes around a split", () => {
    const before = [para(intro), para("Not later than 270 days after enactment, issue rules on staking."), para(outro)];
    const after = [para(intro), para("Not later than 18 months after enactment,"), para("issue rules on staking."), para(outro)];
    expect(hasChanges(diffBillBlocks(before, after))).toBe(true);
  });
});
