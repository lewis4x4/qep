import { describe, expect, it } from "bun:test";
import {
  companyTokens,
  parseLinkedInTitle,
  rankProposals,
  scoreProposal,
  type ArchetypeProfile,
  type Proposal,
  type TavilyResult,
} from "./scoring.ts";

const ECONOMIC_BUYER: ArchetypeProfile = {
  label: "Economic Buyer",
  queryTerms: [],
  titleKeywords: ["cfo", "owner", "president", "controller"],
};

describe("companyTokens", () => {
  it("splits a multi-word company into lowercase tokens", () => {
    expect(companyTokens("Gulf Coast Land Clearing")).toEqual([
      "gulf",
      "coast",
      "land",
      "clearing",
    ]);
  });

  it("drops corporate suffix stopwords", () => {
    expect(companyTokens("Acme Inc.")).toEqual(["acme"]);
    expect(companyTokens("Stone & Sons Corp")).toEqual(["stone", "sons"]);
  });

  it("returns empty when only stopwords remain", () => {
    expect(companyTokens("The Company LLC")).toEqual([]);
  });

  it("strips punctuation without losing letters", () => {
    expect(companyTokens("O'Malley Equipment")).toContain("malley");
    expect(companyTokens("A-1 Service, Ltd.")).toEqual(["service"]);
  });
});

function linkedInResult(overrides: Partial<TavilyResult>): TavilyResult {
  // parseLinkedInTitle drops any title chunk that contains the company
  // name, so we keep the title segment separate from the company here —
  // mirrors how Tavily actually returns LinkedIn results in the wild.
  return {
    title: "Jane Smith - CFO - Gulf Coast Land Clearing | LinkedIn",
    url: "https://www.linkedin.com/in/jane-smith-abc123",
    excerpt: "CFO at Gulf Coast Land Clearing, LLC — leads finance for the land-clearing business.",
    ...overrides,
  };
}

describe("scoreProposal", () => {
  it("returns `high` when URL, title keyword, and full company phrase all match", () => {
    const p = scoreProposal(ECONOMIC_BUYER, linkedInResult({}), "Gulf Coast Land Clearing");
    expect(p).not.toBeNull();
    expect(p?.confidence).toBe("high");
    expect(p?.mismatchReason).toBeNull();
  });

  it("downgrades to `medium` when tokens match but phrase is scrambled", () => {
    const p = scoreProposal(
      ECONOMIC_BUYER,
      linkedInResult({
        title: "Jane Smith - CFO - Land Clearing Co. of Gulf Coast | LinkedIn",
        excerpt: "Runs finance for the land clearing operation at Gulf Coast.",
      }),
      "Gulf Coast Land Clearing",
    );
    expect(p?.confidence).toBe("medium");
    expect(p?.evidence).toContain("all company tokens present");
  });

  it("downgrades to `low` on partial-token match and names the rival company", () => {
    // The Gary Tyler trap: "Gulf Coast" prefix matches, but he's actually
    // at Gulf Coast Building — not Gulf Coast Land Clearing.
    const p = scoreProposal(
      ECONOMIC_BUYER,
      linkedInResult({
        title: "Gary Tyler - President at Gulf Coast Building & General Contracting | LinkedIn",
        excerpt: "President/Owner at Gulf Coast Building & General Contracting, LLC.",
      }),
      "Gulf Coast Land Clearing",
    );
    expect(p?.confidence).toBe("low");
    expect(p?.mismatchReason).toContain("Gulf Coast Building");
    expect(p?.mismatchReason).toContain("Gulf Coast Land Clearing");
  });

  it("marks non-LinkedIn results as `low` with a clear reason", () => {
    const p = scoreProposal(
      ECONOMIC_BUYER,
      {
        title: "Jane Smith - CFO at Gulf Coast Land Clearing",
        url: "https://example.com/team",
        excerpt: "Jane Smith, CFO at Gulf Coast Land Clearing.",
      },
      "Gulf Coast Land Clearing",
    );
    expect(p?.confidence).toBe("low");
    expect(p?.mismatchReason).toContain("not a LinkedIn profile");
  });

  it("marks archetype-keyword misses as `low`", () => {
    const p = scoreProposal(
      ECONOMIC_BUYER,
      linkedInResult({
        title: "Jane Smith - Field Technician at Gulf Coast Land Clearing | LinkedIn",
        excerpt: "Field tech at Gulf Coast Land Clearing, LLC.",
      }),
      "Gulf Coast Land Clearing",
    );
    expect(p?.confidence).toBe("low");
    expect(p?.mismatchReason).toContain("economic buyer");
  });

  it("returns null when the title cannot be parsed into a name + title", () => {
    const p = scoreProposal(
      ECONOMIC_BUYER,
      linkedInResult({ title: "Welcome to LinkedIn | LinkedIn" }),
      "Gulf Coast Land Clearing",
    );
    expect(p).toBeNull();
  });
});

describe("parseLinkedInTitle", () => {
  it("extracts name + title when separated by em-dash", () => {
    const r = parseLinkedInTitle("Jane Smith – CFO – Acme | LinkedIn", "Acme");
    expect(r?.name).toBe("Jane Smith");
    expect(r?.title).toBe("CFO");
  });

  it("strips the company segment from the title", () => {
    const r = parseLinkedInTitle("Jane Smith - CFO - Acme Co", "Acme Co");
    expect(r?.name).toBe("Jane Smith");
    expect(r?.title).toBe("CFO");
  });

  it("returns null for unparseable titles", () => {
    expect(parseLinkedInTitle("Welcome to LinkedIn", "Acme")).toBeNull();
  });
});

describe("rankProposals", () => {
  function p(name: string, confidence: "high" | "medium" | "low"): Proposal {
    return {
      name,
      title: null,
      profileUrl: null,
      confidence,
      evidence: "",
      mismatchReason: null,
    };
  }

  it("sorts high → medium → low", () => {
    const out = rankProposals([p("a", "low"), p("b", "high"), p("c", "medium")]);
    expect(out.map((x) => x.name)).toEqual(["b", "c", "a"]);
  });

  it("dedupes case-insensitively by name", () => {
    const out = rankProposals([p("Jane Smith", "low"), p("jane smith", "high")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe("high"); // higher-ranked wins on first pass
  });

  it("caps at 4 proposals", () => {
    const many = Array.from({ length: 10 }, (_, i) => p(`Person ${i}`, "medium"));
    expect(rankProposals(many)).toHaveLength(4);
  });
});
