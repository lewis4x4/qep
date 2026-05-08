import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import type { QrmCompanySummary, QrmContactSummary } from "../../lib/types";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
}));

const qrmApiModulePath = new URL("../../lib/qrm-api.ts", import.meta.url).pathname;
const routerApiModulePath = new URL("../../lib/qrm-router-api.ts", import.meta.url).pathname;

const mockListCrmCompanies = mock(() =>
  Promise.resolve({ items: [] as QrmCompanySummary[], nextCursor: null }),
);
const mockGetCrmCompany = mock(() => Promise.resolve(null as QrmCompanySummary | null));

mock.module(qrmApiModulePath, () => ({
  listCrmCompanies: mockListCrmCompanies,
  getCrmCompany: mockGetCrmCompany,
}));

const mockCreateContact = mock(() => Promise.resolve(contactSummary({ id: "contact-new" })));
const mockPatchContact = mock(() => Promise.resolve(contactSummary({ id: "contact-1" })));

mock.module(routerApiModulePath, () => ({
  createCrmContactViaRouter: mockCreateContact,
  patchCrmContactViaRouter: mockPatchContact,
}));

const { QrmContactEditorSheet } = await import("../QrmContactEditorSheet");

function contactSummary(overrides: Partial<QrmContactSummary> = {}): QrmContactSummary {
  return {
    id: "contact-1",
    workspaceId: "workspace-1",
    dgeCustomerProfileId: null,
    firstName: "Jane",
    lastName: "Smith",
    email: null,
    phone: null,
    cell: null,
    directPhone: null,
    birthDate: null,
    smsOptIn: false,
    title: null,
    primaryCompanyId: null,
    primaryCompanyName: null,
    assignedRepId: null,
    mergedIntoContactId: null,
    sourceCustomerNumber: null,
    sourceContactNumber: null,
    sourceStatusCode: null,
    sourceSalespersonCode: null,
    myDealerUser: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides,
  };
}

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Providers({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(ui, { wrapper: Providers });
}

describe("QrmContactEditorSheet", () => {
  beforeEach(() => {
    mockListCrmCompanies.mockReset();
    mockGetCrmCompany.mockReset();
    mockCreateContact.mockReset();
    mockPatchContact.mockReset();
    mockListCrmCompanies.mockImplementation(() =>
      Promise.resolve({ items: [] as QrmCompanySummary[], nextCursor: null }),
    );
    mockGetCrmCompany.mockImplementation(() => Promise.resolve(null));
    mockCreateContact.mockImplementation(() => Promise.resolve(contactSummary({ id: "contact-new" })));
    mockPatchContact.mockImplementation(() => Promise.resolve(contactSummary({ id: "contact-1" })));
  });

  afterEach(() => {
    cleanup();
  });

  test("blocks saving when the selected primary company is no longer visible", async () => {
    renderWithClient(
      <QrmContactEditorSheet
        open={true}
        onOpenChange={() => undefined}
        contact={contactSummary({ primaryCompanyId: "11111111-1111-4111-8111-111111111111" })}
      />,
    );

    expect(await screen.findByText(/selected company is no longer available/i)).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: /save contact/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);

    expect(mockPatchContact).not.toHaveBeenCalled();
  });

  test("handles rejected create mutations without leaking an unhandled rejection", async () => {
    mockCreateContact.mockImplementation(() => Promise.reject(new Error("CRM router request failed.")));
    let unhandled = false;
    const onUnhandled = () => {
      unhandled = true;
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    try {
      renderWithClient(
        <QrmContactEditorSheet
          open={true}
          onOpenChange={() => undefined}
        />,
      );

      fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
      fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Smith" } });
      fireEvent.click(screen.getByRole("button", { name: /create contact/i }));

      expect(await screen.findByText("CRM router request failed.")).toBeTruthy();
      expect(mockCreateContact).toHaveBeenCalled();
      expect(unhandled).toBe(false);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
    }
  });
});
