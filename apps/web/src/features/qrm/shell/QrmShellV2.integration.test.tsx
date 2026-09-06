import { expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
let fail = false;
mock.module("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "manager-1", role: "manager" } }) }));
mock.module("../lib/qrm-router-api", () => ({
  listQrmMoves: async () => { if (fail) throw new Error("offline"); return [{ id: "move-1" }, { id: "move-2" }]; },
  listQrmSignals: async () => { if (fail) throw new Error("offline"); return [{ id: "signal-1" }]; },
}));
const { QrmShellV2 } = await import("./QrmShellV2");
function View() { return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><QrmShellV2 /></MemoryRouter></QueryClientProvider>; }
test("shell counts come from the real queue responses and do not claim LIVE", async () => {
  fail = false;
  render(<View />);
  await waitFor(() => expect(screen.getByText("2", { exact: true })).toBeTruthy());
  expect(screen.getByText("1", { exact: true })).toBeTruthy();
  expect(screen.queryByText("7", { exact: true })).toBeNull();
  expect(screen.queryByText("12", { exact: true })).toBeNull();
  expect(screen.queryByText("LIVE", { exact: true })).toBeNull();
});
test("query failures are unknown counts rather than false zeros", async () => {
  fail = true;
  render(<View />);
  await waitFor(() => expect(screen.getByText("Queue counts unavailable")).toBeTruthy());
  expect(screen.queryByText("0", { exact: true })).toBeNull();
});
