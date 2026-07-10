/** Pure bounded-concurrency helper for the rental billing worker. */

export function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/**
 * Map every item with at most `concurrency` active promises. Results preserve
 * input order and one rejection never prevents later items from running.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];
  const width = clampInteger(concurrency, 1, 1, items.length);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = {
          status: "fulfilled",
          value: await worker(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => consume()));
  return results;
}
