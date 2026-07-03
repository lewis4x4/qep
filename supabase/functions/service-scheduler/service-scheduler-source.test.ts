Deno.test("service-scheduler uses H6.1 schedule assignment RPC before legacy fallback", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  for (
    const expected of [
      "service_schedule_assignment_candidates",
      "source: \"service_schedule_assignment_candidates\"",
      "capacity_remaining_hours",
      "branch_match",
      "shop_field_eligible",
      "oem_cert_match",
      "H6.1 ranking RPC unavailable",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Expected scheduler source to include ${expected}`);
    }
  }
});
