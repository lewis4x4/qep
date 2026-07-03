const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("service-job-router exposes H12 offline labor replay action to technicians", () => {
  for (
    const expected of [
      '"record_segment_labor"',
      "handleRecordSegmentLabor",
      "segment_labor_recorded",
      "h12_offline_field_replay",
      "H12 labor fields must be finite numbers.",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Expected service-job-router source to include ${expected}`);
    }
  }
});

Deno.test("service-job-router does not require H5 repair sign-off to record offline labor", () => {
  const start = source.indexOf("async function handleRecordSegmentLabor");
  const end = source.indexOf("async function handleRecordSegmentPhoto");
  if (start < 0 || end < start) {
    throw new Error("Could not isolate handleRecordSegmentLabor source");
  }
  const handler = source.slice(start, end);
  for (const forbidden of ["repair_signoff_status", "diagnostic_signoff_status !== \"approved\""]) {
    if (handler.includes(forbidden)) {
      throw new Error(`H12 replay action should not depend on ${forbidden}`);
    }
  }
});

