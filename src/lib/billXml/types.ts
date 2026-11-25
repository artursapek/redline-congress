export interface BillChangeMark {
  kind: "insert" | "delete";
  id: string;
  author?: string;
}

export interface BillRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  link?: string;
  bookmark?: string;
  change?: BillChangeMark;
}

export interface BillParagraph {
  type: "paragraph";
  id: string;
  heading?: 1 | 2;
  align?: "left" | "center" | "right";
  leftIndent?: number; // 0..6 logical legislative indent steps
  xmlId?: string;
  runs: BillRun[];
  /** When the entire paragraph (including its paragraph mark) was inserted or deleted. */
  paragraphChange?: BillChangeMark;
}

export interface BillTableCell {
  colSpan?: number;
  rowSpan?: number;
  blocks: BillBlock[];
}

export interface BillTableRow {
  isHeader?: boolean;
  cells: BillTableCell[];
}

export interface BillTable {
  type: "table";
  id: string;
  columnCount: number;
  rows: BillTableRow[];
}

export type BillBlock = BillParagraph | BillTable;

export interface BillSectionRef {
  id: string;
  slug: string;
  label: string;
  level: 1 | 2;
  blockIndex: number;
  hasChanges: boolean;
  insertions: number;
  deletions: number;
}

export interface BillChangeStats {
  totalChanges: number;
  insertions: number;
  deletions: number;
  changedParagraphs: number;
  totalBlocks: number;
  changedSections: number;
}

export interface ParsedBill {
  title: string;
  legisNum?: string;
  shortTitle?: string;
  stage?: string;
  hasEmbeddedRevisions: boolean;
  committees: string[];
  reportingCommittee?: string;
  warnings: string[];
  blocks: BillBlock[];
  sections: BillSectionRef[];
  stats: BillChangeStats;
}
