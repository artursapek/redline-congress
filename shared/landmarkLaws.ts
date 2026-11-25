import type { BillType } from "./bills";

/**
 * Landmark laws people search for by popular name, where the official bill
 * title (often a backronym or a "To provide for reconciliation…" vehicle
 * title) doesn't match what anyone actually types. Full-text search can't
 * rank these reliably, so an exact alias match pins the bill as the top
 * result. Bill numbers are the enacted vehicle bill, verified against GovInfo.
 */
interface LandmarkLaw {
  congress: number;
  type: BillType;
  number: number;
  aliases: string[];
  /** Display title when the official one is a backronym or vehicle title. */
  name?: string;
}

const LANDMARK_LAWS: LandmarkLaw[] = [
  { congress: 107, type: "hr", number: 3162, aliases: ["patriot act", "usa patriot act", "patriot"], name: "USA PATRIOT Act of 2001" },
  { congress: 107, type: "hr", number: 1, aliases: ["no child left behind", "no child left behind act", "nclb"] },
  { congress: 107, type: "hr", number: 3763, aliases: ["sarbanes oxley", "sarbanes oxley act", "sox", "sarbox"] },
  { congress: 107, type: "hr", number: 5005, aliases: ["homeland security act"] },
  { congress: 107, type: "hr", number: 2356, aliases: ["mccain feingold", "bipartisan campaign reform act", "bcra"] },
  { congress: 108, type: "hr", number: 1, aliases: ["medicare part d", "medicare modernization act", "medicare prescription drug improvement and modernization act"] },
  { congress: 109, type: "hr", number: 6, aliases: ["energy policy act", "energy policy act of 2005"] },
  { congress: 110, type: "hr", number: 1424, aliases: ["tarp", "bank bailout", "emergency economic stabilization act"], name: "Emergency Economic Stabilization Act of 2008" },
  { congress: 111, type: "hr", number: 1, aliases: ["stimulus", "recovery act", "arra", "american recovery and reinvestment act"] },
  { congress: 111, type: "hr", number: 3590, aliases: ["obamacare", "aca", "affordable care act", "patient protection and affordable care act"] },
  { congress: 111, type: "hr", number: 4173, aliases: ["dodd frank", "dodd frank act", "dodd frank wall street reform and consumer protection act"] },
  { congress: 111, type: "hr", number: 2965, aliases: ["dadt repeal", "dont ask dont tell", "dont ask dont tell repeal act"] },
  { congress: 112, type: "s", number: 365, aliases: ["budget control act", "sequester", "sequestration"] },
  { congress: 112, type: "hr", number: 3606, aliases: ["jobs act", "jumpstart our business startups act"] },
  { congress: 114, type: "hr", number: 2048, aliases: ["usa freedom act", "freedom act"] },
  { congress: 114, type: "s", number: 1177, aliases: ["every student succeeds act", "essa"] },
  { congress: 114, type: "hr", number: 34, aliases: ["21st century cures act", "cures act"] },
  { congress: 115, type: "hr", number: 1, aliases: ["tax cuts and jobs act", "tcja", "trump tax cuts", "2017 tax cuts"], name: "Tax Cuts and Jobs Act" },
  { congress: 115, type: "s", number: 756, aliases: ["first step act"] },
  { congress: 116, type: "hr", number: 748, aliases: ["cares act", "coronavirus aid relief and economic security act"] },
  { congress: 117, type: "hr", number: 1319, aliases: ["american rescue plan", "american rescue plan act", "arpa"] },
  { congress: 117, type: "hr", number: 3684, aliases: ["infrastructure bill", "bipartisan infrastructure law", "infrastructure investment and jobs act", "iija"] },
  { congress: 117, type: "hr", number: 4346, aliases: ["chips act", "chips and science act", "chips"] },
  { congress: 117, type: "hr", number: 5376, aliases: ["inflation reduction act", "ira"], name: "Inflation Reduction Act of 2022" },
  { congress: 117, type: "hr", number: 8404, aliases: ["respect for marriage act"] },
  { congress: 117, type: "s", number: 2938, aliases: ["bipartisan safer communities act"] },
  { congress: 117, type: "s", number: 3373, aliases: ["pact act", "honoring our pact act", "burn pits act"] },
  { congress: 118, type: "hr", number: 3746, aliases: ["fiscal responsibility act", "debt ceiling deal 2023"] },
  { congress: 119, type: "s", number: 5, aliases: ["laken riley act"] },
  { congress: 119, type: "hr", number: 1, aliases: ["one big beautiful bill", "one big beautiful bill act", "big beautiful bill", "obbba", "obbb"], name: "One Big Beautiful Bill Act" },
  { congress: 119, type: "s", number: 1582, aliases: ["genius act"] },
  { congress: 119, type: "s", number: 146, aliases: ["take it down act"] },
  { congress: 119, type: "hr", number: 3633, aliases: ["clarity act", "digital asset market clarity act"] },
];

/** Lowercase, drop punctuation/apostrophes, leading "the" and a trailing "of 2001". */
function normalizeLawName(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/ of (19|20)\d\d$/, "")
    .trim();
}

const ALIAS_INDEX = new Map<string, LandmarkLaw>();
for (const law of LANDMARK_LAWS) {
  for (const alias of law.aliases) ALIAS_INDEX.set(normalizeLawName(alias), law);
}

/** Returns the landmark law whose popular name exactly matches the query. */
export function matchLandmarkLaw(
  query: string,
): { congress: number; type: BillType; number: number } | null {
  const law = ALIAS_INDEX.get(normalizeLawName(query));
  return law ? { congress: law.congress, type: law.type, number: law.number } : null;
}

const NAME_INDEX = new Map<string, string>();
for (const law of LANDMARK_LAWS) {
  if (law.name) NAME_INDEX.set(`${law.congress}:${law.type}:${law.number}`, law.name);
}

/**
 * Swaps an unhelpful official title (e.g. "An act to provide for
 * reconciliation pursuant to…") for the law's popular name.
 */
export function withLandmarkTitle<
  T extends { congress: number; type: string; number: number; title: string; shortTitle?: string | null },
>(bill: T): T {
  const name = NAME_INDEX.get(`${bill.congress}:${bill.type}:${bill.number}`);
  return name ? { ...bill, title: name, shortTitle: name } : bill;
}
