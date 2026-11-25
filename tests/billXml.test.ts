import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  formatBillNumber,
  parseBillQuery,
  parseGovInfoPackageId,
} from "../shared/bills";
import { compareParsedBills, resolveBillRevisions } from "../src/lib/billXml/diff";
import { serializeBillToDocxBytes } from "../src/lib/billXml/docxWriter";
import { parseCongressionalXml } from "../src/lib/billXml/parser";

const SAMPLE_V1 = `<?xml version="1.0"?>
<!DOCTYPE bill PUBLIC "-//US Congress//DTDs/bill.dtd//EN" "bill.dtd">
<bill bill-stage="Introduced-in-House">
  <form>
    <congress>119th CONGRESS</congress>
    <legis-num>H. R. 9999</legis-num>
    <legis-type>A BILL</legis-type>
  </form>
  <legis-body>
    <section id="S1">
      <enum>1.</enum>
      <header>Short title</header>
      <text>This Act may be cited as the <quote><short-title>Open Redlines Act</short-title></quote>.</text>
    </section>
    <section id="S2">
      <enum>2.</enum>
      <header>Deadline</header>
      <text>Not later than 180 days after enactment, the agency shall publish the report.</text>
    </section>
  </legis-body>
</bill>`;

const SAMPLE_V2 = `<?xml version="1.0"?>
<!DOCTYPE bill PUBLIC "-//US Congress//DTDs/bill.dtd//EN" "bill.dtd">
<bill bill-stage="Engrossed-in-House">
  <form>
    <congress>119th CONGRESS</congress>
    <legis-num>H. R. 9999</legis-num>
    <legis-type>AN ACT</legis-type>
  </form>
  <legis-body>
    <section id="S1">
      <enum>1.</enum>
      <header>Short title</header>
      <text>This Act may be cited as the <quote><short-title>Open Redlines Act of 2026</short-title></quote>.</text>
    </section>
    <section id="S2">
      <enum>2.</enum>
      <header>Deadline</header>
      <text>Not later than 90 days after enactment, the agency shall publish the public report online.</text>
    </section>
    <section id="S3">
      <enum>3.</enum>
      <header>Effective date</header>
      <text>This Act takes effect immediately.</text>
    </section>
  </legis-body>
</bill>`;

describe("shared bill query parsing", () => {
  it("parses direct bill references and Congress.gov URLs", () => {
    expect(parseBillQuery("H.R. 3633")).toEqual({ type: "hr", number: 3633 });
    expect(parseBillQuery("118 s 919")).toEqual({
      congress: 118,
      type: "s",
      number: 919,
    });
    expect(
      parseBillQuery(
        "https://www.congress.gov/bill/119th-congress/house-bill/3633/text",
      ),
    ).toEqual({ congress: 119, type: "hr", number: 3633 });
    expect(parseBillQuery("BILLS-119hr3633rs")).toEqual({
      congress: 119,
      type: "hr",
      number: 3633,
      versionCode: "rs",
    });
    expect(parseGovInfoPackageId("BILLS-119sjres14enr")).toEqual({
      congress: 119,
      type: "sjres",
      number: 14,
      versionCode: "enr",
    });
    expect(formatBillNumber("hjres", 42)).toBe("H.J.Res. 42");
  });
});

describe("Congressional XML parser, diffing, and OOXML DOCX serialization", () => {
  it("diffs two bill versions into tracked changes and emits valid OOXML DOCX", () => {
    const v1 = parseCongressionalXml(SAMPLE_V1);
    const v2 = parseCongressionalXml(SAMPLE_V2);
    const compared = compareParsedBills(v1, v2, { author: "IH → EH" });

    expect(compared.stats.insertions).toBeGreaterThan(0);
    expect(compared.stats.deletions).toBeGreaterThan(0);
    expect(compared.sections.length).toBe(3);
    expect(compared.sections.map((s) => s.slug)).toEqual([
      "sec-1",
      "sec-2",
      "sec-3",
    ]);

    // Accepting all changes recovers v2's updated deadline; rejecting recovers v1's
    const acceptedText = resolveBillRevisions(compared, "accept")
      .blocks.filter((b) => b.type === "paragraph")
      .map((b) => b.runs.map((r) => r.text).join(""))
      .join("\n");
    const rejectedText = resolveBillRevisions(compared, "reject")
      .blocks.filter((b) => b.type === "paragraph")
      .map((b) => b.runs.map((r) => r.text).join(""))
      .join("\n");

    expect(acceptedText).toContain("90 days");
    expect(acceptedText).not.toContain("180 days");
    expect(acceptedText).toContain("Effective date");
    expect(rejectedText).toContain("180 days");
    expect(rejectedText).not.toContain("90 days");
    expect(rejectedText).not.toContain("Effective date");

    // Verify generated DOCX is a valid ZIP with OOXML tracked changes
    const docxBytes = serializeBillToDocxBytes(compared);
    const files = unzipSync(docxBytes);
    expect(files["word/document.xml"]).toBeDefined();
    expect(files["word/styles.xml"]).toBeDefined();
    const docXml = strFromU8(files["word/document.xml"]);
    expect(docXml).toContain("<w:ins ");
    expect(docXml).toContain("<w:del ");
    expect(docXml).toContain('w:author="IH → EH"');

    // Ensure document.xml itself is well-formed XML
    const parsedDocXml = new DOMParser().parseFromString(
      docXml,
      "application/xml",
    );
    expect(parsedDocXml.getElementsByTagName("parsererror").length).toBe(0);
  });

  it("opens generated redline DOCX cleanly in Revise SDK with tracked changes intact", async () => {
    const { ReviseDocument } = await import("revise/server");
    const v1 = parseCongressionalXml(SAMPLE_V1);
    const v2 = parseCongressionalXml(SAMPLE_V2);
    const compared = compareParsedBills(v1, v2, { author: "IH → EH" });
    const docxBytes = serializeBillToDocxBytes(compared);

    const doc = await ReviseDocument.open({
      bytes: docxBytes,
      filename: "hr9999-redline.docx",
    });
    try {
      const changes = await doc.changes();
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some((c) => c.author === "IH → EH")).toBe(true);
      expect(
        changes.some(
          (c) =>
            (c.deleted && c.deleted.includes("180")) ||
            (c.inserted && c.inserted.includes("90")),
        ),
      ).toBe(true);
    } finally {
      doc.dispose();
    }
  });

  it("parses real 1 MB strike-all-and-replace H.R. 3633 RS fixture quickly", () => {
    const fixturePath = resolve(
      __dirname,
      "fixtures/BILLS-119hr3633rs.xml",
    );
    const xml = readFileSync(fixturePath, "utf8");
    const t0 = performance.now();
    const parsed = parseCongressionalXml(xml);
    const elapsedMs = performance.now() - t0;

    expect(parsed.legisNum).toBe("H. R. 3633");
    expect(parsed.hasEmbeddedRevisions).toBe(true);
    expect(parsed.stats.insertions).toBeGreaterThan(50);
    expect(parsed.stats.deletions).toBeGreaterThan(50);
    expect(parsed.sections.length).toBeGreaterThan(30);
    expect(elapsedMs).toBeLessThan(15000);

    const docx = serializeBillToDocxBytes(parsed);
    expect(docx.byteLength).toBeGreaterThan(20_000);
    const files = unzipSync(docx);
    const docXml = strFromU8(files["word/document.xml"]);
    const check = new DOMParser().parseFromString(docXml, "application/xml");
    expect(check.getElementsByTagName("parsererror").length).toBe(0);
  });

  it("picks primary committee substitute when multiple changed=added legis-body blocks exist", () => {
    const dualAddedXml = `<?xml version="1.0"?>
<bill bill-stage="Reported-in-House">
  <form>
    <congress>119th CONGRESS</congress>
    <legis-num>H. R. 3633</legis-num>
    <action><action-desc>Reported by <committee-name committee-id="HAG00">Committee on Agriculture</committee-name> and <committee-name committee-id="HBA00">Committee on Financial Services</committee-name></action-desc></action>
  </form>
  <legis-body changed="added" committee-id="HAG00">
    <section><enum>1.</enum><header>Short title</header><text>Agriculture substitute text.</text></section>
  </legis-body>
  <legis-body changed="added" committee-id="HBA00" display-enacting-clause="no-display-enacting-clause">
    <section><enum>1.</enum><header>Short title</header><text>Financial Services primary text.</text></section>
  </legis-body>
</bill>`;
    const parsed = parseCongressionalXml(dualAddedXml);
    const clean = resolveBillRevisions(parsed, "accept");
    const fullText = clean.blocks
      .filter((b) => b.type === "paragraph")
      .map((b) => b.runs.map((r) => r.text).join(""))
      .join("\n");
    expect(fullText).toContain("Financial Services primary text.");
    expect(fullText).not.toContain("Agriculture substitute text.");
    expect(parsed.reportingCommittee).toBe("Committee on Financial Services");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("parses historical GPO Formatted Text (.htm) bills and diffs two versions cleanly", () => {
    const gpoV1 = `<html><body><pre>
[Congressional Bills 107th Congress]
[From the U.S. Government Publishing Office]
[H.R. 3162 Introduced in House (IH)]

107th CONGRESS
  1st Session
                                H. R. 3162

                                 A BILL

To deter and punish terrorist acts in the United States.

    Be it enacted by the Senate and House of Representatives of the
United States of America in Congress assembled,

SECTION 1. SHORT TITLE AND TABLE OF CONTENTS.

    (a) Short Title.--This Act may be cited as the \`\`USA PATRIOT Act''.
    (b) Table of Contents.--The table of contents for this Act is as
follows:

Sec. 1. Short title and table of contents.
               TITLE II--ENHANCED SURVEILLANCE PROCEDURES
Sec. 215. Access to records and other items.

               TITLE II--ENHANCED SURVEILLANCE PROCEDURES

SEC. 215. ACCESS TO RECORDS AND OTHER ITEMS.

    (a) In General.--The Director of the Federal Bureau of
Investigation may make an application for an order requiring the
production of any tangible things for an investigation to protect
against international terrorism.
            (1) A person may not disclose to any other person that the
        Federal Bureau of Investigation has sought records.
</pre></body></html>`;

    const gpoV2 = gpoV1.replace(
      "for an investigation to protect\nagainst international terrorism.",
      "for an authorized investigation to protect\nagainst international terrorism or clandestine intelligence activities.",
    );

    const parsed1 = parseCongressionalXml(gpoV1);
    const parsed2 = parseCongressionalXml(gpoV2);

    expect(parsed1.legisNum).toBe("H.R. 3162");
    expect(parsed1.shortTitle).toBe("USA PATRIOT Act");
    // TOC entries must NOT pollute the section outline
    expect(parsed1.sections.map((s) => s.slug)).toEqual([
      "sec-1",
      "title-ii",
      "sec-215",
    ]);

    const diff = compareParsedBills(parsed1, parsed2, { author: "IH → ENR" });
    expect(diff.stats.insertions).toBeGreaterThan(0);

    const docxBytes = serializeBillToDocxBytes(diff);
    const files = unzipSync(docxBytes);
    const docXml = strFromU8(files["word/document.xml"]);
    expect(docXml).toContain("clandestine intelligence activities");
    expect(docXml).toContain("<w:ins ");
  });

  it("ignores GPO line-wrapping, margin-width, and hyphen-wrap differences between versions", () => {
    const narrowMarginsRds = `<html><body><pre>
[H.R. 3162 Received in Senate (RDS)]

    Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,

SEC. 808. DEFINITION OF FEDERAL CRIME OF TERRORISM.

    Section 2332b of title 18, United States Code, is amended--
            (1) in subsection (g)(5)(B), by striking clauses (i)
        through (iii) and inserting the following:
                            \`\`(i) section 1030(a)(5)(A)(i) resulting in
                        damage as defined in 1030(a)(5)(B)(ii) through
                        (v) (relating to protection of computers), on a
                        packet-switched data network;
        To the extent that the pen register or trap and trace device
        can be set automatically to record this information
        electronically, the record shall be maintained electronically.
</pre></body></html>`;

    const wideMarginsEnr = `<html><body><pre>
[H.R. 3162 Enrolled Bill (ENR)]

    Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,

SEC. 808. DEFINITION OF FEDERAL CRIME OF TERRORISM.

    Section 2332b of title 18, United States Code, is amended--
        (1) in subsection (g)(5)(B), by striking clauses (i) through
    (iii) and inserting the following:
                \`\`(i) section 1030(a)(5)(A)(i) resulting in damage as
            defined in 1030(a)(5)(B)(ii) through (v) (relating to
            protection of computers), on a packet-
            switched data network;
        To the extent that the pen register or trap and trace device can
        be set automatically to record this information electronically,
        the record shall be maintained electronically.
</pre></body></html>`;

    const parsedRds = parseCongressionalXml(narrowMarginsRds);
    const parsedEnr = parseCongressionalXml(wideMarginsEnr);
    const diff = compareParsedBills(parsedRds, parsedEnr, {
      author: "RDS → ENR",
    });

    expect(diff.stats.totalChanges).toBe(0);
    expect(diff.stats.insertions).toBe(0);
    expect(diff.stats.deletions).toBe(0);
  });
});
