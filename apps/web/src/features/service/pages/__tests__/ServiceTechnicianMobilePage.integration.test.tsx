import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getOfflineFieldQueue } from "../../lib/service-offline-field-mode";

const transitionMutate = mock(() => undefined);
let transitionState = {
  isPending: false,
  isError: false,
  error: null as Error | null,
  variables: null as { id: string; toStage: string } | null,
};

const jobFixtures = [
  {
    id: "job-scheduled",
    workspace_id: "default",
    customer_id: "cust-1",
    contact_id: null,
    machine_id: "machine-1",
    source_type: "field_tech",
    request_type: "repair",
    priority: "critical",
    current_stage: "scheduled",
    status_flags: ["machine_down"],
    branch_id: "north",
    advisor_id: null,
    service_manager_id: null,
    technician_id: "tech-1",
    requested_by_name: "Jordan Lane",
    customer_problem_summary: "Excavator will not restart after hot shutdown.",
    ai_diagnosis_summary: null,
    selected_job_code_id: null,
    haul_required: false,
    shop_or_field: "field",
    scheduled_start_at: "2026-04-22T14:00:00.000Z",
    scheduled_end_at: "2026-04-22T16:00:00.000Z",
    quote_total: null,
    invoice_total: null,
    portal_request_id: null,
    fulfillment_run_id: null,
    tracking_token: "track-scheduled",
    created_at: "2026-04-22T10:00:00.000Z",
    updated_at: "2026-04-22T10:00:00.000Z",
    closed_at: null,
    deleted_at: null,
    customer: { id: "cust-1", name: "Evergreen Farms" },
    machine: { id: "machine-1", make: "Kubota", model: "KX080", serial_number: "KBTA-17", year: 2024 },
    parts: [],
    quotes: [],
    latest_quote: [],
    hour_meter_reading: 1290.2,
    complaint: "Machine will not restart",
    cause: null,
    correction: null,
    segments: [
      {
        id: "segment-scheduled",
        segment_number: 1,
        description: "No restart",
        status: "open",
        technician_id: "tech-1",
        estimated_hours: 2,
        quoted_labor_hours: 2,
        hours_actual: null,
        diagnostic_signoff_status: "not_submitted",
        diagnostic_submitted_at: null,
        diagnostic_approved_at: null,
        repair_signoff_status: "not_started",
        repair_signed_off_at: null,
        labor_story: null,
        labor_story_complaint_verification: null,
        labor_story_diagnostic_steps: null,
        labor_story_root_cause: null,
        labor_story_parts_used: null,
        labor_story_work_performed: null,
        overrun_status: "not_evaluated",
        overrun_flagged_at: null,
        overrun_acknowledged_at: null,
        lockout_tagout_required: false,
        lockout_tagout_completed: false,
        warranty_parts_turn_in_required: false,
        warranty_parts_turn_in_completed: false,
        warranty_parts_label: null,
        photos: [],
      },
    ],
  },
  {
    id: "job-active",
    workspace_id: "default",
    customer_id: "cust-2",
    contact_id: null,
    machine_id: "machine-2",
    source_type: "field_tech",
    request_type: "repair",
    priority: "urgent",
    current_stage: "in_progress",
    status_flags: [],
    branch_id: "south",
    advisor_id: null,
    service_manager_id: null,
    technician_id: "tech-1",
    requested_by_name: "Taylor Hart",
    customer_problem_summary: "Hydraulic thumb drifting under load.",
    ai_diagnosis_summary: null,
    selected_job_code_id: null,
    haul_required: false,
    shop_or_field: "field",
    scheduled_start_at: "2026-04-22T18:00:00.000Z",
    scheduled_end_at: "2026-04-22T19:00:00.000Z",
    quote_total: null,
    invoice_total: null,
    portal_request_id: null,
    fulfillment_run_id: null,
    tracking_token: "track-active",
    created_at: "2026-04-22T09:00:00.000Z",
    updated_at: "2026-04-22T11:00:00.000Z",
    closed_at: null,
    deleted_at: null,
    customer: { id: "cust-2", name: "Blue River Ag" },
    machine: { id: "machine-2", make: "Develon", model: "DX140", serial_number: "DEV-44", year: 2023 },
    parts: [{ id: "part-1", part_number: "KIT-22", description: "Seal kit", quantity: 1, status: "staged" }],
    quotes: [],
    latest_quote: [],
    hour_meter_reading: 883.4,
    complaint: "Hydraulic thumb drifting",
    cause: null,
    correction: null,
    segments: [
      {
        id: "segment-active",
        segment_number: 1,
        description: "Hydraulic thumb drift",
        status: "open",
        technician_id: "tech-1",
        estimated_hours: 3,
        quoted_labor_hours: 3,
        hours_actual: 1.2,
        diagnostic_signoff_status: "not_submitted",
        diagnostic_submitted_at: null,
        diagnostic_approved_at: null,
        repair_signoff_status: "not_started",
        repair_signed_off_at: null,
        labor_story: null,
        labor_story_complaint_verification: null,
        labor_story_diagnostic_steps: null,
        labor_story_root_cause: null,
        labor_story_parts_used: null,
        labor_story_work_performed: null,
        overrun_status: "not_evaluated",
        overrun_flagged_at: null,
        overrun_acknowledged_at: null,
        lockout_tagout_required: false,
        lockout_tagout_completed: false,
        warranty_parts_turn_in_required: false,
        warranty_parts_turn_in_completed: false,
        warranty_parts_label: null,
        photos: [],
      },
    ],
  },
];

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

function renderMobilePage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ServiceTechnicianMobilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "tech-1",
      full_name: "Jordan Lane",
      role: "rep",
    },
  }),
}));

mock.module("../../hooks/useServiceJobs", () => ({
  useServiceJobList: () => ({
    data: { jobs: jobFixtures },
    isLoading: false,
  }),
  useServiceJob: (id?: string) => ({
    data: jobFixtures.find((job) => job.id === id) ?? null,
    isLoading: false,
  }),
}));

mock.module("../../hooks/useServiceJobMutation", () => ({
  useTransitionServiceJob: () => ({
    mutate: transitionMutate,
    ...transitionState,
  }),
}));

mock.module("../../components/VoiceFieldNotes", () => ({
  VoiceFieldNotes: ({ jobId }: { jobId: string }) => <div>Voice notes stub {jobId}</div>,
}));

const { ServiceTechnicianMobilePage } = await import("../ServiceTechnicianMobilePage");

describe("ServiceTechnicianMobilePage (integration)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    setNavigatorOnline(true);
    transitionMutate.mockClear();
    transitionState = {
      isPending: false,
      isError: false,
      error: null,
      variables: null,
    };
  });

  test("renders technician queue stats and opens the selected work order", () => {
    renderMobilePage();

    expect(screen.getByText("Service Technician Workspace")).toBeTruthy();
    expect(screen.getByText("Jordan, here is your board.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Machine Down" })).toBeTruthy();
    expect(screen.getAllByText("Evergreen Farms").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /open/i })[0]!);

    expect(screen.getByText("Quick actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start work" })).toBeTruthy();
    expect(screen.getByText("Voice notes stub job-scheduled")).toBeTruthy();
  });

  test("fires a service transition from the technician detail sheet", () => {
    renderMobilePage();

    fireEvent.click(screen.getByText("Blue River Ag"));
    fireEvent.click(screen.getByRole("button", { name: "Block / wait" }));

    expect(transitionMutate).toHaveBeenCalledWith({
      id: "job-active",
      toStage: "blocked_waiting",
    });
  });

  test("locks technician actions while a transition is pending to prevent duplicate taps", () => {
    transitionState = {
      isPending: true,
      isError: false,
      error: null,
      variables: { id: "job-active", toStage: "blocked_waiting" },
    };

    renderMobilePage();

    fireEvent.click(screen.getByText("Blue River Ag"));

    const action = screen.getByRole("button", { name: "Block / wait" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText(/Actions stay locked to prevent duplicate stage transitions/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(action);
    expect(transitionMutate).not.toHaveBeenCalled();
  });

  test("shows field-safe retry guidance when a transition fails", () => {
    transitionState = {
      isPending: false,
      isError: true,
      error: new Error("Network request failed"),
      variables: null,
    };

    renderMobilePage();

    fireEvent.click(screen.getByText("Blue River Ag"));

    expect(screen.getByRole("alert").textContent).toContain("Update did not save");
    expect(screen.getByRole("alert").textContent).toContain("no stage transition is recorded until service confirms");
    expect(screen.getByRole("alert").textContent).toContain("Network request failed");
  });

  test("queues meter, three-C, and labor packets while offline", async () => {
    setNavigatorOnline(false);

    renderMobilePage();

    fireEvent.click(screen.getByText("Blue River Ag"));
    fireEvent.change(screen.getByLabelText("Hour meter"), { target: { value: "889.1" } });
    fireEvent.change(screen.getByLabelText("Cause"), { target: { value: "Loose fitting" } });
    fireEvent.change(screen.getByLabelText("Correction"), { target: { value: "Tightened fitting and checked drift" } });
    fireEvent.change(screen.getByLabelText("Labor hours"), { target: { value: "2.4" } });
    fireEvent.click(screen.getByRole("button", { name: /Queue Packet/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("queued");
    });

    const queue = await getOfflineFieldQueue();
    expect(queue.map((action) => action.kind)).toEqual(["job_update", "segment_labor"]);
    expect(queue[0]).toMatchObject({
      kind: "job_update",
      jobId: "job-active",
      fields: {
        hour_meter_reading: 889.1,
        cause: "Loose fitting",
        correction: "Tightened fitting and checked drift",
      },
    });
    expect(queue[1]).toMatchObject({
      kind: "segment_labor",
      segmentId: "segment-active",
      fields: {
        hours_actual: 2.4,
      },
    });
  });
});
