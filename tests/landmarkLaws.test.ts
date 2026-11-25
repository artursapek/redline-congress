import { describe, expect, it } from "vitest";
import { matchLandmarkLaw, withLandmarkTitle } from "../shared/landmarkLaws";

describe("matchLandmarkLaw", () => {
  it("matches popular names regardless of case, punctuation and filler", () => {
    for (const q of ["Patriot Act", "the USA PATRIOT Act", "USA PATRIOT Act of 2001", "patriot"]) {
      expect(matchLandmarkLaw(q)).toEqual({ congress: 107, type: "hr", number: 3162 });
    }
    expect(matchLandmarkLaw("Dodd-Frank")).toEqual({ congress: 111, type: "hr", number: 4173 });
    expect(matchLandmarkLaw("Don't Ask, Don't Tell")).toEqual({ congress: 111, type: "hr", number: 2965 });
    expect(matchLandmarkLaw("Obamacare")?.number).toBe(3590);
  });

  it("only matches whole names, not queries that merely contain one", () => {
    expect(matchLandmarkLaw("patriot act reauthorization")).toBeNull();
    expect(matchLandmarkLaw("stablecoin")).toBeNull();
    expect(matchLandmarkLaw("")).toBeNull();
  });
});

describe("withLandmarkTitle", () => {
  it("replaces vehicle titles with the popular name", () => {
    const bill = { congress: 117, type: "hr", number: 5376, title: "An act to provide for reconciliation…", shortTitle: null };
    expect(withLandmarkTitle(bill).title).toBe("Inflation Reduction Act of 2022");
  });

  it("leaves other bills untouched", () => {
    const bill = { congress: 119, type: "hr", number: 3633, title: "Digital Asset Market Clarity Act" };
    expect(withLandmarkTitle(bill)).toBe(bill);
  });
});
