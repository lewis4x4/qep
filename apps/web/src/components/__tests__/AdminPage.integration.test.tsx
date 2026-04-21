import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
  toast: mock(() => undefined),
}));

const supabaseModulePath = new URL("../../lib/supabase.ts", import.meta.url).pathname;

mock.module(supabaseModulePath, () => {
  function makeChain(result: { data: unknown; error: null | { message: string } } = { data: [], error: null }) {
    const resolved = Promise.resolve(result);
    const singleResult = {
      data: Array.isArray(result.data) ? ((result.data as unknown[])[0] ?? null) : result.data,
      error: result.error,
    };
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "in", "order", "is", "not", "limit", "update", "insert", "delete"] as const;
    for (const method of methods) chain[method] = () => chain;
    chain.maybeSingle = () => Promise.resolve(singleResult);
    chain.single = () => Promise.resolve(singleResult);
    chain.then = resolved.then.bind(resolved);
    chain.catch = resolved.catch.bind(resolved);
    return chain;
  }

  return {
    supabase: {
      from: () => makeChain(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      },
      storage: {
        from: () => ({
          remove: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});

const { AdminPage } = await import("../AdminPage");

describe("AdminPage (integration)", () => {
  test("shows Document Center launch action in Knowledge Base tab", async () => {
    render(
      <MemoryRouter>
        <AdminPage userRole="admin" userId="user-1" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Document Center")).toBeTruthy();
    });

    const launchLink = screen.getByRole("link", { name: /open document center/i });
    expect(launchLink.getAttribute("href")).toBe("/admin/documents");
  });
});
