import { describe, expect, it } from "vitest";
import { parseCongressionalText } from "../src/lib/billXml/textParser";

const paragraphTexts = (raw: string) =>
  parseCongressionalText(raw)
    .blocks.filter((b) => b.type === "paragraph")
    .map((b) => (b.type === "paragraph" ? b.runs.map((r) => r.text).join("") : ""));

// Line layout copied from the enrolled USA PATRIOT Act (BILLS-107hr3162enr), §215.
const ENR_LAYOUT = [
  "<html><body><pre>",
  "            ``(B) a United States Magistrate Judge under chapter 43 of ",
  "        title 28, United States Code, who is publicly designated by the ",
  "        Chief Justice of the United States to have the power to hear ",
  "        applications and grant orders for the production of tangible ",
  "        things under this section on behalf of a judge of that court; ",
  "        and",
  "        ``(2) shall specify that the records concerned are sought for ",
  "    an authorized investigation conducted in accordance with subsection ",
  "    (a)(2) to obtain foreign intelligence information not concerning a ",
  "    United States person or to protect against international terrorism ",
  "    or clandestine intelligence activities.",
  "    ``(c)(1) Upon an application made pursuant to this section, the ",
  "judge shall enter an ex parte order as requested, or as modified, ",
  "approving the release of records.",
  "                                 &lt;all&gt;",
  "</pre></body></html>",
].join("\n");

describe("GPO text paragraph reconstruction", () => {
  const paras = paragraphTexts(ENR_LAYOUT);

  it("breaks after a wrapped '; and' even when 'and' sits alone on its line", () => {
    const b = paras.find((t) => t.includes("Magistrate Judge"))!;
    expect(b.trim().endsWith("court; and")).toBe(true);
    expect(paras.some((t) => t.trimStart().startsWith("“(2) shall specify"))).toBe(true);
  });

  it("starts a new paragraph at chained enumerators like “(c)(1)", () => {
    const two = paras.find((t) => t.includes("shall specify"))!;
    expect(two).not.toContain("(c)(1)");
    expect(paras.some((t) => t.trimStart().startsWith("“(c)(1) Upon"))).toBe(true);
  });

  it("keeps mid-sentence citations like '(a)(2) to obtain' inside the paragraph", () => {
    const two = paras.find((t) => t.includes("shall specify"))!;
    expect(two).toContain("subsection (a)(2) to obtain foreign intelligence");
  });

  it("drops GPO's <all> end-of-document marker", () => {
    expect(paras.some((t) => t.includes("<all>"))).toBe(false);
  });
});
