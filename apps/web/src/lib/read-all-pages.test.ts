import { expect, test } from "bun:test";
import { readAllPages } from "./read-all-pages";

test("reads beyond transport caps, including caps smaller than requested pages", async () => {
  const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await readAllPages(async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 100)), error: null }));
  expect(result).toEqual(source);
});
test("failed later pages reject the entire report instead of returning partial totals", async () => {
  await expect(readAllPages(async (from) => from === 0
    ? { data: [{ id: 1 }], error: null }
    : { data: null, error: { message: "connection lost" } })).rejects.toThrow("connection lost");
});
