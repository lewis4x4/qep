const source = await Deno.readTextFile(new URL("./service-invoice.ts", import.meta.url));

Deno.test("service invoice helper blocks non-renter-fault H10 internal jobs", () => {
  for (
    const expected of [
      "request_type",
      "renter_fault_billable",
      'String(job.request_type ?? "") === "internal"',
      "job.renter_fault_billable !== true",
      "no customer invoice for internal service cost posting",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Expected service invoice helper source to include ${expected}`);
    }
  }
});
