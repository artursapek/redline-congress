import type { BillType } from "./bills";

/**
 * Headline legislation from recent Congresses, passed or not, for the homepage
 * "Noteworthy bills" tab (/noteworthy). Bill numbers verified against Congress.gov.
 */
export const NOTEWORTHY_BILLS: ReadonlyArray<{ congress: number; type: BillType; number: number }> = [
  // Became law
  { congress: 117, type: "hr", number: 1319 }, // American Rescue Plan Act
  { congress: 117, type: "hr", number: 3684 }, // Infrastructure Investment and Jobs Act
  { congress: 117, type: "s", number: 2938 }, // Bipartisan Safer Communities Act
  { congress: 117, type: "hr", number: 4346 }, // CHIPS and Science Act
  { congress: 117, type: "s", number: 3373 }, // Honoring our PACT Act
  { congress: 117, type: "hr", number: 5376 }, // Inflation Reduction Act
  { congress: 117, type: "hr", number: 8404 }, // Respect for Marriage Act
  { congress: 117, type: "hr", number: 2617 }, // Consolidated Appropriations Act, 2023 (Electoral Count Reform)
  { congress: 118, type: "hr", number: 3746 }, // Fiscal Responsibility Act
  { congress: 118, type: "hr", number: 815 }, // Ukraine/Israel aid + TikTok divest-or-ban
  { congress: 119, type: "s", number: 5 }, // Laken Riley Act
  { congress: 119, type: "s", number: 146 }, // TAKE IT DOWN Act
  { congress: 119, type: "hr", number: 1 }, // One Big Beautiful Bill Act
  { congress: 119, type: "s", number: 1582 }, // GENIUS Act
  { congress: 119, type: "hr", number: 4405 }, // Epstein Files Transparency Act
  // Didn't pass
  { congress: 117, type: "hr", number: 1 }, // For the People Act
  { congress: 117, type: "hr", number: 4 }, // John Lewis Voting Rights Advancement Act
  { congress: 117, type: "s", number: 2747 }, // Freedom to Vote Act
  { congress: 117, type: "hr", number: 1280 }, // George Floyd Justice in Policing Act
  { congress: 117, type: "hr", number: 842 }, // PRO Act
  { congress: 117, type: "hr", number: 5 }, // Equality Act
  { congress: 117, type: "hr", number: 3755 }, // Women's Health Protection Act
  { congress: 118, type: "hr", number: 2 }, // Secure the Border Act
  { congress: 118, type: "s", number: 1409 }, // Kids Online Safety Act
  { congress: 118, type: "hr", number: 4763 }, // FIT21
  { congress: 118, type: "hr", number: 7521 }, // TikTok bill (House version)
  { congress: 119, type: "hr", number: 22 }, // SAVE Act
  { congress: 119, type: "hr", number: 3633 }, // CLARITY Act
];
