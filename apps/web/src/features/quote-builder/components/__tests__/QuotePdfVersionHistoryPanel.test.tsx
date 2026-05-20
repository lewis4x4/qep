import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import { QuotePdfVersionHistoryPanel } from "../QuotePdfVersionHistoryPanel";

const listQuotePdfVersionsMock = mock(async () => ({
  versions: [
    {
      artifactId: "art-3",
      versionNumber: 3,
      recipient: "newest@example.com",
      customerVisibleAt: "2026-05-20T10:00:00.000Z",
      generatedAt: "2026-05-20T09:59:00.000Z",
      sizeBytes: 4096,
      contentSha256: "abc123abcdef",
      totalsSummary: { customerTotal: 120000 },
    },
    {
      artifactId: "art-2",
      versionNumber: 2,
      recipient: "older@example.com",
      customerVisibleAt: "2026-05-19T10:00:00.000Z",
      generatedAt: "2026-05-19T09:59:00.000Z",
      sizeBytes: 3072,
      contentSha256: "def456abcdef",
      totalsSummary: { customerTotal: 118000 },
    },
  ],
}));

const diffQuotePdfVersionsMock = mock(async () => ({
  diff: {
    lineDiffs: [],
    totalDiffs: [],
    financingDiffs: [],
    termDiffs: [],
    narrativeChanged: false,
  },
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <QuotePdfVersionHistoryPanel
        quotePackageId="pkg-1"
        listVersions={listQuotePdfVersionsMock}
        diffVersions={diffQuotePdfVersionsMock}
      />
    </QueryClientProvider>,
  );
}

describe("QuotePdfVersionHistoryPanel", () => {
  test("renders versions, defaults to newest vs previous, and calls diff API with expected version numbers", async () => {
    listQuotePdfVersionsMock.mockClear();
    diffQuotePdfVersionsMock.mockClear();

    renderPanel();

    expect((await screen.findAllByText("v3")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("v2").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(diffQuotePdfVersionsMock).toHaveBeenCalled();
    });

    const lastCall = diffQuotePdfVersionsMock.mock.calls.at(-1)?.[0] as {
      quotePackageId: string;
      fromVersionNumber: number;
      toVersionNumber: number;
    };

    expect(lastCall.quotePackageId).toBe("pkg-1");
    expect(lastCall.fromVersionNumber).toBe(2);
    expect(lastCall.toVersionNumber).toBe(3);

    const previousSelect = screen.getByLabelText("Previous version") as HTMLSelectElement;
    const newerSelect = screen.getByLabelText("Newer version") as HTMLSelectElement;
    expect(previousSelect.value).toBe("2");
    expect(newerSelect.value).toBe("3");
  });
});
