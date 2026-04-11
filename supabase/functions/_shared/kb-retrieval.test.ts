import { assertEquals } from "jsr:@std/assert@1";

import { buildEvidenceExcerpt, rerankKbEvidence, type KbEvidenceRow } from "./kb-retrieval.ts";

Deno.test("buildEvidenceExcerpt includes section and page context when available", () => {
  const excerpt = buildEvidenceExcerpt({
    excerpt: "Inspect the valve block before shutdown.",
    context_excerpt: "Shutdown Procedure\nPark on level ground before pressure release.",
    section_title: "Shutdown Procedure",
    page_number: 4,
  });

  assertEquals(excerpt.includes("Section: Shutdown Procedure"), true);
  assertEquals(excerpt.includes("Page: 4"), true);
  assertEquals(excerpt.includes("Context:"), true);
});

Deno.test("rerankKbEvidence falls back to SQL order when model output is malformed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{not-json" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;

  const originalKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");

  try {
    const rows: KbEvidenceRow[] = [
      {
        source_type: "document",
        source_id: "doc-1",
        source_title: "First",
        excerpt: "alpha",
        confidence: 0.92,
        access_class: "company_wide",
      },
      {
        source_type: "document",
        source_id: "doc-2",
        source_title: "Second",
        excerpt: "beta",
        confidence: 0.81,
        access_class: "company_wide",
      },
    ];

    const ranked = await rerankKbEvidence("alpha", rows, { loggerTag: "test" });
    assertEquals(ranked.map((row) => row.source_id), ["doc-1", "doc-2"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalKey);
  }
});
