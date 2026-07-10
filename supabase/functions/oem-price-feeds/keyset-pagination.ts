export interface KeysetPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface KeysetCollection<T> {
  rows: T[];
  pageCount: number;
}

/**
 * Exhaust a stable ascending-id query without OFFSET or a global row ceiling.
 * The fetcher must apply `id > afterId`, `order by id asc`, and `limit`.
 */
export async function collectAllKeysetRows<T>(
  fetchPage: (
    afterId: string | null,
    limit: number,
  ) => PromiseLike<KeysetPage<T>>,
  label: string,
  getId: (row: T) => string,
  pageSize = 1_000,
): Promise<KeysetCollection<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`${label} page size must be a positive integer`);
  }

  const rows: T[] = [];
  let afterId: string | null = null;
  let pageCount = 0;

  while (true) {
    const page = await fetchPage(afterId, pageSize);
    if (page.error) throw new Error(`${label}: ${page.error.message}`);
    const nextRows = page.data ?? [];
    pageCount += 1;
    if (nextRows.length > pageSize) {
      throw new Error(`${label} returned more than the requested page size`);
    }

    let priorId = afterId;
    for (const row of nextRows) {
      const id = getId(row);
      if (!id) throw new Error(`${label} returned a row without an id`);
      if (priorId !== null && id <= priorId) {
        throw new Error(
          `${label} keyset order did not advance after ${priorId}`,
        );
      }
      priorId = id;
      rows.push(row);
    }

    if (nextRows.length < pageSize) return { rows, pageCount };
    const nextCursor = getId(nextRows[nextRows.length - 1]);
    if (!nextCursor || nextCursor === afterId) {
      throw new Error(`${label} keyset cursor did not advance`);
    }
    afterId = nextCursor;
  }
}
