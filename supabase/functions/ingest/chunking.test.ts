import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";

import { buildDocumentChunks } from "./chunking.ts";

Deno.test("semantic chunking preserves heading boundaries for markdown text", () => {
  const result = buildDocumentChunks({
    rawText: [
      "# Safety Checklist",
      "",
      "Inspect the hydraulic hoses before startup.",
      "",
      "## Shutdown Procedure",
      "",
      "Park on level ground and release stored pressure before disconnecting lines.",
    ].join("\n"),
    uploadKind: "text",
    title: "Hydraulic SOP",
  });

  assertEquals(result.strategy, "semantic_v1");
  const paragraphChunks = result.chunks.filter((chunk) => chunk.chunk_kind === "paragraph");
  assertEquals(paragraphChunks.length, 2);
  assertEquals(paragraphChunks[0].metadata.section_title, "Safety Checklist");
  assertEquals(paragraphChunks[1].metadata.section_title, "Shutdown Procedure");
});

Deno.test("semantic chunking merges adjacent short paragraphs into paragraph-sized chunks", () => {
  const result = buildDocumentChunks({
    rawText: [
      "Inspection",
      "",
      "Check fluid level before starting the machine.",
      "",
      "Look for loose fittings around the valve block.",
      "",
      "Confirm the pressure relief line is clear.",
    ].join("\n"),
    uploadKind: "docx",
    title: "Inspection Notes",
  });

  const paragraphChunks = result.chunks.filter((chunk) => chunk.chunk_kind === "paragraph");
  assertEquals(paragraphChunks.length, 1);
  assertEquals(paragraphChunks[0].content.includes("valve block"), true);
  assertEquals(paragraphChunks[0].content.includes("pressure relief line"), true);
});

Deno.test("semantic chunking builds section parents and paragraph children", () => {
  const longParagraph = "Replace the feed wheel pressure solenoid and recalibrate the valve block. ".repeat(35);
  const result = buildDocumentChunks({
    rawText: [
      "Hydraulic Recovery Playbook",
      "",
      longParagraph,
      "",
      longParagraph,
      "",
      longParagraph,
      "",
      longParagraph,
    ].join("\n"),
    uploadKind: "pdf",
    title: "Hydraulic Recovery Playbook",
  });

  const sectionChunks = result.chunks.filter((chunk) => chunk.chunk_kind === "section");
  const paragraphChunks = result.chunks.filter((chunk) => chunk.chunk_kind === "paragraph");

  assertNotEquals(sectionChunks.length, 0);
  assertNotEquals(paragraphChunks.length, 0);
  assertEquals(
    paragraphChunks.every((chunk) => typeof chunk.parent_chunk_id === "string" && chunk.parent_chunk_id.length > 0),
    true,
  );
});

Deno.test("weak unstructured parses fall back to legacy fixed chunking", () => {
  const result = buildDocumentChunks({
    rawText: Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n\n"),
    uploadKind: "text",
    title: "OCR Noise",
  });

  assertEquals(result.strategy, "legacy_fixed");
  assertEquals(result.chunks.every((chunk) => chunk.metadata.chunking_strategy === "legacy_fixed"), true);
});
