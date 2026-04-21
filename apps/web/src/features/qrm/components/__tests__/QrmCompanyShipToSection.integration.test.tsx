import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
  toast: mock(() => undefined),
}));

const routerApiModulePath = new URL("../../lib/qrm-router-api.ts", import.meta.url).pathname;

const fetchCompanyShipTos = mock(async () => [
  {
    id: "ship-to-1",
    workspaceId: "default",
    companyId: "company-1",
    name: "Main yard",
    contactName: "Jordan Lane",
    phone: "386-555-0100",
    addressLine1: "1200 County Road 12",
    addressLine2: null,
    city: "Lake City",
    state: "FL",
    postalCode: "32055",
    country: "USA",
    instructions: "Call before entering the gate.",
    isPrimary: true,
    sortOrder: 0,
    createdAt: "2026-04-21T12:00:00.000Z",
    updatedAt: "2026-04-21T12:00:00.000Z",
  },
]);

mock.module(routerApiModulePath, () => ({
  fetchCompanyShipTos,
  createCompanyShipTo: mock(async () => ({ id: "ship-to-2" })),
  patchCompanyShipTo: mock(async () => ({ id: "ship-to-1" })),
}));

const { QrmCompanyShipToSection } = await import("../QrmCompanyShipToSection");

function TestProviders({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe("QrmCompanyShipToSection (integration)", () => {
  test("renders saved ship-to destinations with the primary badge", async () => {
    render(
      <TestProviders>
        <QrmCompanyShipToSection companyId="company-1" />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(fetchCompanyShipTos).toHaveBeenCalled();
    });

    expect(screen.getByText("Ship-To Addresses")).toBeTruthy();
    expect(screen.getByText("Main yard")).toBeTruthy();
    expect(screen.getByText("Jordan Lane")).toBeTruthy();
    expect(screen.getByText(/1200 County Road 12/)).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
  });
});
