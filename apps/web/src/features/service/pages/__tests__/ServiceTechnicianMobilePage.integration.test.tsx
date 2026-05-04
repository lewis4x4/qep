import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const transitionMutate = mock(() => undefined);
let transitionState = {
  isPending: false,
  isError: false,
  error: null as Error | null,
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
  },
];

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
    transitionMutate.mockClear();
    transitionState = {
      isPending: false,
      isError: false,
      error: null,
    };
  });

  test("renders technician queue stats and opens the selected work order", () => {
    render(
      <MemoryRouter>
        <ServiceTechnicianMobilePage />
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter>
        <ServiceTechnicianMobilePage />
      </MemoryRouter>,
    );

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
    };

    render(
      <MemoryRouter>
        <ServiceTechnicianMobilePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Blue River Ag"));

    const action = screen.getByRole("button", { name: "Block / wait" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText(/Actions stay locked to prevent duplicate stage transitions/i)).toBeTruthy();

    fireEvent.click(action);
    expect(transitionMutate).not.toHaveBeenCalled();
  });

  test("shows field-safe retry guidance when a transition fails", () => {
    transitionState = {
      isPending: false,
      isError: true,
      error: new Error("Network request failed"),
    };

    render(
      <MemoryRouter>
        <ServiceTechnicianMobilePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Blue River Ag"));

    expect(screen.getByRole("alert").textContent).toContain("Update did not save");
    expect(screen.getByRole("alert").textContent).toContain("no stage transition is recorded until service confirms");
    expect(screen.getByRole("alert").textContent).toContain("Network request failed");
  });
});
