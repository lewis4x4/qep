// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { collectAllKeysetRows } from "./keyset-pagination.ts";

interface QuoteFixture {
  id: string;
  workspace_id: string;
  status: string;
}

function idFor(index: number): string {
  return `00000000-0000-0000-0000-${index.toString().padStart(12, "0")}`;
}

Deno.test("keyset scan covers a production-shaped cohort above 50k without truncation", async () => {
  const source: QuoteFixture[] = Array.from({ length: 50_123 }, (_, index) => ({
    id: idFor(index + 1),
    workspace_id: "fixture-workspace",
    status: "draft",
  }));
  let fetches = 0;
  const result = await collectAllKeysetRows(
    (afterId, limit) => {
      fetches += 1;
      const start = afterId === null
        ? 0
        : source.findIndex((row) => row.id === afterId) + 1;
      return Promise.resolve({
        data: source.slice(start, start + limit),
        error: null,
      });
    },
    "quote fixture scan",
    (row) => row.id,
  );

  assertEquals(result.rows.length, 50_123);
  assertEquals(result.rows[0].id, "00000000-0000-0000-0000-000000000001");
  assertEquals(
    result.rows.at(-1)?.id,
    "00000000-0000-0000-0000-000000050123",
  );
  assertEquals(result.pageCount, 51);
  assertEquals(fetches, 51);
});

Deno.test("keyset scan fails closed when a page does not advance", async () => {
  await assertRejects(
    () =>
      collectAllKeysetRows(
        (afterId) =>
          Promise.resolve({
            data: [{ id: afterId ?? "0001" }, { id: "0001" }],
            error: null,
          }),
        "stuck scan",
        (row) => row.id,
        2,
      ),
    Error,
    "keyset order did not advance",
  );
});

Deno.test("keyset scan propagates page errors instead of returning partial coverage", async () => {
  let page = 0;
  await assertRejects(
    () =>
      collectAllKeysetRows(
        (_afterId, limit) => {
          page += 1;
          if (page === 2) {
            return Promise.resolve({
              data: null,
              error: { message: "network reset" },
            });
          }
          return Promise.resolve({
            data: Array.from({ length: limit }, (_, index) => ({
              id: idFor(index + 1),
            })),
            error: null,
          });
        },
        "partial scan",
        (row) => row.id,
        2,
      ),
    Error,
    "partial scan: network reset",
  );
});
