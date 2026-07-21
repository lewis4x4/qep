import { describe, expect, test } from "bun:test";

describe("LoginPage accessibility contract", () => {
  test("uses a WCAG-readable inactive-tab color on the dark tab list", async () => {
    const source = await Bun.file(`${import.meta.dir}/LoginPage.tsx`).text();

    expect(source).toContain(
      'bg-[#0A121E] p-1 text-slate-300',
    );
    expect(source).not.toContain(
      'bg-[#0A121E] p-1">',
    );
  });
});
