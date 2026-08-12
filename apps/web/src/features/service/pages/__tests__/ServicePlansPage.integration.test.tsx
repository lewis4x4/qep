import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

const reviewCalls: Array<Record<string, unknown>> = [];
const activationCalls: Array<Record<string, unknown>> = [];
const cancellationCalls: Array<Record<string, unknown>> = [];

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "manager-1",
      full_name: "Morgan Lee",
      role: "manager",
      active_workspace_id: "default",
    },
  }),
}));

mock.module("../../lib/service-plan-api", () => ({
  listServicePlanPrograms: async () => ([
    {
      id: "program-1",
      program_code: "BR-DRAFT-PM-250",
      name: "BlackRock Draft 250-Hour / 6-Month PM",
      sponsor: "BlackRock provisional draft",
      description: "Inactive first-pass cadence hypothesis only.",
      catalog_owner: "BlackRock",
      is_provisional: true,
      review_status: "draft",
      is_active: false,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      activated_by: null,
      activated_at: null,
      deactivated_at: null,
      intervals: [{
        id: "interval-1",
        program_id: "program-1",
        interval_code: "PM-250-6M",
        name: "250h / 6mo",
        interval_hours: 250,
        interval_months: 6,
        interval_days: null,
        entitlement_unit: "pm_service",
        entitlement_quantity: 1,
        is_active: true,
      }],
    },
    {
      id: "program-2",
      program_code: "QEP-PM-500",
      name: "Reviewed Active 500",
      sponsor: null,
      description: null,
      catalog_owner: "QEP",
      is_provisional: false,
      review_status: "reviewed",
      is_active: false,
      reviewed_by: "manager-1",
      reviewed_at: "2026-08-01T00:00:00.000Z",
      review_notes: "OEM fit confirmed",
      activated_by: null,
      activated_at: null,
      deactivated_at: null,
      intervals: [{
        id: "interval-2",
        program_id: "program-2",
        interval_code: "PM-500",
        name: "500h / 12mo",
        interval_hours: 500,
        interval_months: 12,
        interval_days: null,
        entitlement_unit: "pm_service",
        entitlement_quantity: 1,
        is_active: true,
      }],
    },
  ]),
  listOpenServicePlanSchedulePrompts: async () => ([
    {
      id: "prompt-1",
      due_event_id: "due-1",
      service_job_id: "job-1",
      prompt_type: "advisor_schedule_pm",
      prompt_key: "due-1",
      evidence: { entitlement_reserved: true },
      created_at: "2026-08-12T12:00:00.000Z",
      due_basis: "hours",
      due_on: null,
      due_hours: 370,
      due_status: "job_created",
      service_agreement_id: "agreement-1",
      equipment_id: "eq-1",
      job_number: "WO-370",
      scheduled_start_at: null,
    },
  ]),
  reviewServicePlanProgram: async (input: Record<string, unknown>) => {
    reviewCalls.push(input);
    return {
      id: "program-1",
      program_code: "BR-DRAFT-PM-250",
      name: "BlackRock Draft 250-Hour / 6-Month PM",
      sponsor: "BlackRock provisional draft",
      description: "Inactive first-pass cadence hypothesis only.",
      catalog_owner: "BlackRock",
      is_provisional: false,
      review_status: "reviewed",
      is_active: false,
      reviewed_by: "manager-1",
      reviewed_at: "2026-08-12T12:00:00.000Z",
      review_notes: String(input.reviewNotes ?? ""),
      activated_by: null,
      activated_at: null,
      deactivated_at: null,
      intervals: [],
    };
  },
  setServicePlanProgramActivation: async (input: Record<string, unknown>) => {
    activationCalls.push(input);
    return {
      id: String(input.programId),
      program_code: "QEP-PM-500",
      name: "Reviewed Active 500",
      sponsor: null,
      description: null,
      catalog_owner: "QEP",
      is_provisional: false,
      review_status: "reviewed",
      is_active: Boolean(input.isActive),
      reviewed_by: "manager-1",
      reviewed_at: "2026-08-01T00:00:00.000Z",
      review_notes: "OEM fit confirmed",
      activated_by: "manager-1",
      activated_at: "2026-08-12T12:00:00.000Z",
      deactivated_at: null,
      intervals: [],
    };
  },
  cancelServicePlanPmDueEvent: async (input: Record<string, unknown>) => {
    cancellationCalls.push(input);
  },
}));

const { ServicePlansPage } = await import("../ServicePlansPage");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ServicePlansPage (integration)", () => {
  test("renders catalog, blocked activation, and open prompts", async () => {
    render(
      <Providers>
        <ServicePlansPage />
      </Providers>,
    );

    expect(screen.getByText("PM program catalog")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("BlackRock Draft 250-Hour / 6-Month PM").length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/not customer-live/i)).toBeTruthy();
    expect(screen.getByText(/Record a QEP review with notes first/i)).toBeTruthy();
    expect(screen.getByText(/Provisional programs cannot be activated/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Activate" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Job WO-370")).toBeTruthy();
    expect(screen.getByText(/entitlement reserved/i)).toBeTruthy();
  });

  test("records review notes through the review action", async () => {
    reviewCalls.length = 0;
    render(
      <Providers>
        <ServicePlansPage />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("BlackRock Draft 250-Hour / 6-Month PM").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByPlaceholderText("QEP review notes (required before activation)"), {
      target: { value: "OEM model and kit validated for Ocala." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record review" }));

    await waitFor(() => {
      expect(reviewCalls.length).toBe(1);
    });
    expect(reviewCalls[0]).toMatchObject({
      workspaceId: "default",
      programId: "program-1",
      reviewerId: "manager-1",
      reviewNotes: "OEM model and kit validated for Ocala.",
    });
  });

  test("activates a reviewed non-provisional program", async () => {
    activationCalls.length = 0;
    render(
      <Providers>
        <ServicePlansPage />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Reviewed Active 500")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Reviewed Active 500"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => {
      expect(activationCalls.length).toBe(1);
    });
    expect(activationCalls[0]).toMatchObject({
      programId: "program-2",
      isActive: true,
      actorId: "manager-1",
    });
  });

  test("requires a reason and uses the controlled PM cancellation action", async () => {
    cancellationCalls.length = 0;
    render(
      <Providers>
        <ServicePlansPage />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Job WO-370")).toBeTruthy();
    });

    const cancelButton = screen.getByRole("button", { name: "Cancel due work" }) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Cancellation reason"), {
      target: { value: "Customer moved service outside the coverage window." },
    });
    expect(cancelButton.disabled).toBe(false);
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(cancellationCalls.length).toBe(1);
    });
    expect(cancellationCalls[0]).toMatchObject({
      workspaceId: "default",
      dueEventId: "due-1",
      cancellationKind: "cancelled",
      reason: "Customer moved service outside the coverage window.",
      actorId: "manager-1",
    });
  });
});
