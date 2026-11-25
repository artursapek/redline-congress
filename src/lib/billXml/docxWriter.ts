import { strToU8, zipSync } from "fflate";
import type { BillBlock, BillParagraph, BillRun, BillTable, ParsedBill } from "./types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RVSE_NS = "https://revise.io/ooxml/revision-group/1";

function escXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Serializes a ParsedBill (with optional native tracked changes) into a standards-compliant
 * OOXML `.docx` byte array ready to pass directly into `<ReviseEditor source={blob} />`
 * or download straight into Microsoft Word.
 */
export function serializeBillToDocxBytes(
  bill: ParsedBill,
  options: { revisionDate?: string } = {},
): Uint8Array {
  const isoDate = options.revisionDate ?? new Date().toISOString();
  let revId = 0;
  let bookmarkId = 0;
  const rels: Array<{ id: string; target: string }> = [];
  const relByUrl = new Map<string, string>();

  const registerLink = (url: string): string => {
    const existing = relByUrl.get(url);
    if (existing) return existing;
    const id = `rId${rels.length + 2}`; // rId1 is styles.xml
    rels.push({ id, target: url });
    relByUrl.set(url, id);
    return id;
  };

  const renderRunProps = (run: BillRun): string => {
    const parts: string[] = [];
    if (run.bold) parts.push("<w:b/>");
    if (run.italic) parts.push("<w:i/>");
    if (run.underline) parts.push('<w:u w:val="single"/>');
    if (run.strike) parts.push("<w:strike/>");
    if (run.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
    else if (run.subscript) parts.push('<w:vertAlign w:val="subscript"/>');
    return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
  };

  const renderTextContent = (text: string, isDelete: boolean): string => {
    const tag = isDelete ? "w:delText" : "w:t";
    const lines = text.split("\n");
    return lines
      .map((line, idx) => {
        const piece = line.length
          ? `<${tag} xml:space="preserve">${escXml(line)}</${tag}>`
          : "";
        return idx > 0 ? `<w:br/>${piece}` : piece;
      })
      .join("");
  };

  const renderRun = (run: BillRun): string => {
    const rPr = renderRunProps(run);
    const isDelete = run.change?.kind === "delete";
    const inner = `<w:r>${rPr}${renderTextContent(run.text, isDelete)}</w:r>`;

    let wrapped = inner;
    if (run.link && /^https?:\/\//i.test(run.link)) {
      const rId = registerLink(run.link);
      wrapped = `<w:hyperlink r:id="${rId}">${inner}</w:hyperlink>`;
    }

    if (run.change) {
      const id = ++revId;
      const author = escXml(run.change.author || "U.S. Congress");
      const group = escXml(run.change.id);
      const tag = run.change.kind === "insert" ? "w:ins" : "w:del";
      wrapped = `<${tag} w:id="${id}" w:author="${author}" w:date="${escXml(isoDate)}" rvse:group="${group}">${wrapped}</${tag}>`;
    }

    if (run.bookmark) {
      const bmId = ++bookmarkId;
      const bmName = escXml(run.bookmark.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40));
      wrapped = `<w:bookmarkStart w:id="${bmId}" w:name="${bmName}"/>${wrapped}<w:bookmarkEnd w:id="${bmId}"/>`;
    }

    return wrapped;
  };

  const renderParagraph = (p: BillParagraph): string => {
    const pPrParts: string[] = [];
    if (p.heading === 1) {
      pPrParts.push('<w:pStyle w:val="Heading1"/>');
      pPrParts.push("<w:keepNext/>");
    } else if (p.heading === 2) {
      pPrParts.push('<w:pStyle w:val="Heading2"/>');
      pPrParts.push("<w:keepNext/>");
    } else {
      pPrParts.push('<w:pStyle w:val="Normal"/>');
    }

    if (p.align && p.align !== "left") {
      pPrParts.push(`<w:jc w:val="${p.align}"/>`);
    }

    if (p.leftIndent && p.leftIndent > 0) {
      // 360 twips = 0.25 inch per legislative indent level
      const twips = p.leftIndent * 360;
      pPrParts.push(`<w:ind w:left="${twips}"/>`);
    }

    if (p.paragraphChange) {
      const id = ++revId;
      const author = escXml(p.paragraphChange.author || "U.S. Congress");
      const group = escXml(p.paragraphChange.id);
      const tag = p.paragraphChange.kind === "insert" ? "w:ins" : "w:del";
      pPrParts.push(
        `<w:rPr><${tag} w:id="${id}" w:author="${author}" w:date="${escXml(isoDate)}" rvse:group="${group}"/></w:rPr>`,
      );
    }

    const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";
    const content = p.runs.map(renderRun).join("");
    return `<w:p>${pPr}${content}</w:p>`;
  };

  const renderTable = (table: BillTable): string => {
    const colCount = Math.max(1, table.columnCount);
    const totalWidth = 9360; // 6.5 inches in twips
    const colWidth = Math.floor(totalWidth / colCount);
    const gridCols = Array.from(
      { length: colCount },
      () => `<w:gridCol w:w="${colWidth}"/>`,
    ).join("");

    const rowsXml = table.rows
      .map((row) => {
        const trPr = row.isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
        const cellsXml = row.cells
          .map((cell) => {
            const span = cell.colSpan ?? 1;
            const tcPrParts = [`<w:tcW w:w="${colWidth * span}" w:type="dxa"/>`];
            if (span > 1) tcPrParts.push(`<w:gridSpan w:val="${span}"/>`);
            if (row.isHeader) {
              tcPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F5F3F1"/>');
            }
            const cellBody = cell.blocks.map(renderBlock).join("");
            return `<w:tc><w:tcPr>${tcPrParts.join("")}</w:tcPr>${cellBody || "<w:p/>"}</w:tc>`;
          })
          .join("");
        return `<w:tr>${trPr}${cellsXml}</w:tr>`;
      })
      .join("");

    return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D6CFCB"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D6CFCB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E8E0DD"/><w:left w:val="none"/><w:right w:val="none"/><w:insideV w:val="none"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${rowsXml}</w:tbl>`;
  };

  const renderBlock = (block: BillBlock): string =>
    block.type === "paragraph" ? renderParagraph(block) : renderTable(block);

  const bodyXml = bill.blocks.map(renderBlock).join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:rvse="${RVSE_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="rvse">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1260" w:right="1260" w:bottom="1260" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Source Serif 4" w:hAnsi="Source Serif 4" w:cs="Source Serif 4"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="110" w:line="300" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="320" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="26"/>
      <w:szCs w:val="26"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="23"/>
      <w:szCs w:val="23"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(r.target)}" TargetMode="External"/>`,
    )
    .join("\n  ")}
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const corePropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escXml(bill.title)}</dc:title>
  <dc:creator>RedlineCongress.org (powered by Revise SDK)</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${escXml(isoDate)}</dcterms:created>
</cp:coreProperties>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypesXml),
      "_rels/.rels": strToU8(rootRelsXml),
      "docProps/core.xml": strToU8(corePropsXml),
      "word/document.xml": strToU8(documentXml),
      "word/styles.xml": strToU8(stylesXml),
      "word/_rels/document.xml.rels": strToU8(docRelsXml),
    },
    { level: 1 },
  );
}

export function serializeBillToDocxBlob(
  bill: ParsedBill,
  options?: { revisionDate?: string },
): Blob {
  const bytes = serializeBillToDocxBytes(bill, options);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
