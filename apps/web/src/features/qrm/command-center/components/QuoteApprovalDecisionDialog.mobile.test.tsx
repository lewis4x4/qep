import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mutate = mock(() => undefined);

mock.module("../hooks/useApprovals", () => ({
  useDecideQuoteApproval: () => ({ isPending: false, mutate }),
}));
mock.module("@/features/quote-builder/lib/quote-api", () => ({
  getQuoteApprovalCase: mock(async () => null),
}));
mock.module("@/features/quote-builder/components/ApprovalActivityLog", () => ({
  ApprovalActivityLog: () => <div>Approval activity</div>,
}));
mock.module("@/hooks/use-toast", () => ({ toast: mock(() => undefined) }));

const { QuoteApprovalDecisionDialog } = await import(
  "./QuoteApprovalDecisionDialog"
);

afterEach(cleanup);

describe("QuoteApprovalDecisionDialog mobile viewport", () => {
  test("bounds the dialog, preserves review-first focus, and keeps the decision footer reachable", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <QuoteApprovalDecisionDialog
          open
          onClose={() => undefined}
          approvalCase={{
            id: "approval-case-1",
            quotePackageId: null,
            versionNumber: 4,
            submittedByName: "Field Rep",
            branchName: "Raleigh",
            policySnapshot: {},
            reasonSummary: null,
            conditions: [],
          } as never}
        />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100dvh-1rem)]");
    expect(dialog.className).toContain("overflow-hidden");

    const scrollRegion = screen.getByTestId("approval-decision-scroll-region");
    expect(scrollRegion.className).toContain("min-h-0");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(
      scrollRegion.contains(
        screen.getByRole("button", { name: /Submit Decision/i }),
      ),
    ).toBe(true);
    expect(scrollRegion.getAttribute("tabindex")).toBe("-1");

    const heading = screen.getByTestId("approval-decision-heading");
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrollRegion.scrollTop).toBe(0);
  });
});
