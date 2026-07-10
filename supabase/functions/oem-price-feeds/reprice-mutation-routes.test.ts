import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("OEM reprice routes use governed atomic RPCs and expose reversal", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('"create_qb_oem_reprice_draft_for_approval"'));
  assert(source.includes('"apply_qb_oem_reprice_draft"'));
  assert(source.includes('"reverse_qb_oem_reprice_apply"'));
  assert(source.includes('first === "applies"'));
  assert(source.includes('third === "reverse"'));
  assert(source.includes('code === "40001"'));
  assert(source.includes('return 409'));
  assert(source.includes('"applied",\n];'));
  assert(source.includes('from("qb_quote_reprice_audits")'));
  assert(source.includes("reprice_history: history"));
  assert(source.includes("can_reverse:"));
  assert(source.includes('impact.state !== "applied"'));
  assertEquals(
    source.includes("Draft apply is intentionally not enabled"),
    false,
  );
  assertEquals(
    source.includes('.from("qb_quote_reprice_drafts")\n    .insert('),
    false,
  );
});
