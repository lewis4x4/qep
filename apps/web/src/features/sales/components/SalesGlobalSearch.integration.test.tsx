import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
let fail = false;
const searches: string[] = [];
mock.module("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "rep-1", active_workspace_id: "ws-1" } }) }));
mock.module("@/features/qrm/lib/qrm-router-api", () => ({ searchQrmGraph: async (query: string) => {
  searches.push(query);
  if (fail) throw new Error("offline");
  return [{ type: "deal", id: "remote-deal", title: "Remote customer deal", subtitle: "Loader", updatedAt: "", rank: 1 }];
} }));
const { SalesGlobalSearch } = await import("./SalesGlobalSearch");
function Location() { return <span data-testid="path">{useLocation().pathname}</span>; }
function View() { return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><SalesGlobalSearch onClose={() => {}} /><Location /></MemoryRouter></QueryClientProvider>; }
test("queries remote matching records and opens the selected deal itself", async () => {
  fail = false;
  render(<View />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search sales records" }), { target: { value: "Remote" } });
  await waitFor(() => expect(screen.getByText("Remote customer deal")).toBeTruthy());
  expect(searches).toContain("Remote");
  fireEvent.click(screen.getByText("Remote customer deal"));
  expect(screen.getByTestId("path").textContent).toBe("/sales/deals/remote-deal");
});
test("failed search remains a retryable failure, never an empty result", async () => {
  fail = true;
  render(<View />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search sales records" }), { target: { value: "Remote" } });
  await waitFor(() => expect(screen.getByText("Search failed. Your query is retained.")).toBeTruthy());
  expect(screen.queryByText(/No matching records/)).toBeNull();
  fail = false;
  fireEvent.click(screen.getByText("Retry search"));
  await waitFor(() => expect(screen.getByText("Remote customer deal")).toBeTruthy());
});
