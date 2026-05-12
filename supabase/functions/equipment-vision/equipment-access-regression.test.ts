import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("equipment-vision validates equipmentId with caller RLS before service-role writes", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const equipmentIdIndex = source.indexOf('searchParams.get("equipmentId")');
  const callerAccessIndex = source.indexOf('callerDb\n        .from("crm_equipment")');
  const openAiIndex = source.indexOf('fetch("https://api.openai.com/v1/chat/completions"');
  const serviceUpdateIndex = source.indexOf('adminDb\n          .from("crm_equipment")\n          .update(updateFields)');

  assert(equipmentIdIndex > -1);
  assert(callerAccessIndex > equipmentIdIndex);
  assert(openAiIndex > callerAccessIndex);
  assert(serviceUpdateIndex > openAiIndex);
});

Deno.test("equipment-vision inventory matches use the caller-scoped client", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(source.includes('callerDb\n          .from("crm_equipment")'), true);
});
