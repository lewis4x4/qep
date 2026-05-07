import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";

const qrmApiModulePath = new URL("../../lib/qrm-api.ts", import.meta.url).pathname;

const listCompanyActivities = mock(async () => []);
const createCrmActivity = mock(async (input: Record<string, unknown>) => ({
  id: "activity-1",
  workspaceId: "default",
  activityType: input.activityType,
  body: input.body,
  occurredAt: input.occurredAt,
  contactId: null,
  companyId: input.companyId,
  dealId: null,
  createdBy: "user-1",
  metadata: {},
  createdAt: input.occurredAt,
  updatedAt: input.occurredAt,
}));
const listCrmActivityTemplates = mock(async () => []);

mock.module(qrmApiModulePath, () => ({
  listCompanyActivities,
  createCrmActivity,
  listCrmActivityTemplates,
  patchCrmActivity: mock(async () => ({ id: "patched" })),
  patchCrmActivityTask: mock(async () => ({ id: "patched-task" })),
  deliverCrmActivity: mock(async () => ({ id: "delivered" })),
}));

const { QrmAccountActivitySection } = await import("../QrmAccountActivitySection");

function renderSection(options: { emptyStateCue?: ComponentProps<typeof QrmAccountActivitySection>["emptyStateCue"] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateQueries = mock(queryClient.invalidateQueries.bind(queryClient));
  queryClient.invalidateQueries = invalidateQueries as typeof queryClient.invalidateQueries;

  function TestProviders({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  render(
    <TestProviders>
      <QrmAccountActivitySection
        accountId="account-1"
        accountName="Acme Equipment"
        currentUserId="user-1"
        queryKey={["account-command", "account-1", "activities"]}
        title="Recent account activity"
        description="Recent calls and notes."
        emptyStateCue={options.emptyStateCue}
      />
    </TestProviders>,
  );

  return { invalidateQueries };
}

beforeEach(() => {
  cleanup();
  listCompanyActivities.mockClear();
  createCrmActivity.mockClear();
  listCrmActivityTemplates.mockClear();
});

describe("QrmAccountActivitySection", () => {
  test("shows an honest Iron cue and opens its primary suggested action", async () => {
    renderSection({
      emptyStateCue: {
        headline: "No logged touch in 42 days for Acme Equipment.",
        suggestion: "Iron cue from visible fleet data: UNIT-42 shows 5,100 engine hours; log a fleet-health note before this becomes reactive service work.",
        primaryLabel: "Add fleet note",
        primaryActivityType: "note",
      },
    });

    await waitFor(() => expect(listCompanyActivities).toHaveBeenCalledWith("account-1"));
    expect(screen.getByText("No logged touch in 42 days for Acme Equipment.")).toBeTruthy();
    expect(screen.getByText(/Iron cue from visible fleet data/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add fleet note" }));

    const typeSelect = await screen.findByLabelText("Type") as HTMLSelectElement;
    expect(typeSelect.value).toBe("note");
  });

  test("opens Log a call as Call and persists an account activity", async () => {
    const { invalidateQueries } = renderSection();

    await waitFor(() => expect(listCompanyActivities).toHaveBeenCalledWith("account-1"));
    fireEvent.click(screen.getByRole("button", { name: "Log a call" }));

    const typeSelect = await screen.findByLabelText("Type") as HTMLSelectElement;
    expect(typeSelect.value).toBe("call");

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Called Ryan about rental conversion." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Activity" }));

    await waitFor(() => {
      expect(createCrmActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "account-1",
          activityType: "call",
          body: "Called Ryan about rental conversion.",
        }),
        "user-1",
      );
    });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  });

  test("opens Add a note as Note and persists an account note", async () => {
    renderSection();

    await waitFor(() => expect(listCompanyActivities).toHaveBeenCalledWith("account-1"));
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));

    const typeSelect = await screen.findByLabelText("Type") as HTMLSelectElement;
    expect(typeSelect.value).toBe("note");

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Customer prefers service-first follow-up." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Activity" }));

    await waitFor(() => {
      expect(createCrmActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "account-1",
          activityType: "note",
          body: "Customer prefers service-first follow-up.",
        }),
        "user-1",
      );
    });
  });
});
