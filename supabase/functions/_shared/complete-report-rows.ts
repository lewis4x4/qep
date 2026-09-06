/** Collect a bounded export only if every matching row is present and uniquely identified. */
export async function collectCompleteReportRows<T>(input: {
  maxRows: number;
  page: (offset: number, size: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>;
  key: (row: T) => string;
}): Promise<T[]> {
  const rows: T[] = [], keys = new Set<string>();
  let expected: number | null = null;
  do {
    const response = await input.page(rows.length, 500);
    if (response.error) throw new Error(response.error.message);
    if (response.count == null) throw new Error("Export count could not be verified. Retry before using this report.");
    if (expected == null) expected = response.count;
    if (response.count !== expected) throw new Error("The selected records changed while exporting. Retry for a reconciled report.");
    if (expected > input.maxRows) throw new Error(`The selected period contains ${expected} rows; choose a shorter period (maximum ${input.maxRows}). No partial export was produced.`);
    const page = response.data ?? [];
    for (const row of page) {
      const key = input.key(row);
      if (!key || keys.has(key)) throw new Error("The report changed or contains duplicate source rows. Retry before using it.");
      keys.add(key); rows.push(row);
    }
    if (!page.length && rows.length < expected) throw new Error("Export ended before all selected records were received. No partial export was produced.");
    if (rows.length > expected) throw new Error("Export totals changed. Retry for a reconciled report.");
  } while (rows.length < expected);
  return rows;
}
