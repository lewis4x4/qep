import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

const listCrmFollowUpSequences = mock(async () => [
  {
    id: "seq-1",
    name: "Post-Quote Follow-Up (5-Step)",
    description: "Automated follow-up sequence triggered when a deal moves to the quote_sent stage.",
    triggerStage: "quote_sent",
    isActive: true,
    createdBy: "user-1",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    steps: [
      {
        id: "step-1",
        sequenceId: "seq-1",
        stepNumber: 1,
        dayOffset: 0,
        stepType: "task",
        subject: "Confirm the next move",
        bodyTemplate: "Call the customer and confirm the next committed move.",
        taskPriority: "HIGH",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
      {
        id: "step-2",
        sequenceId: "seq-1",
        stepNumber: 2,
        dayOffset: 2,
        stepType: "email",
        subject: "Keep the quote moving",
        bodyTemplate: "Send the customer the next decision checkpoint.",
        taskPriority: "MEDIUM",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    ],
  },
]);

const listCrmSequenceEnrollments = mock(async () => [
  {
    id: "enrollment-1",
    sequenceId: "seq-1",
    sequenceName: "Post-Quote Follow-Up (5-Step)",
    dealId: "deal-1",
    dealName: "Excavator quote",
    contactId: "contact-1",
    contactName: "Chris Customer",
    ownerId: "owner-1",
    hubId: "hub-1",
    enrolledAt: "2026-05-03T12:00:00.000Z",
    currentStep: 1,
    nextStepDueAt: "2026-05-08T12:00:00.000Z",
    status: "active",
    completedAt: null,
    cancelledAt: null,
    metadata: {},
    updatedAt: "2026-05-03T12:00:00.000Z",
  },
]);

mock.module("../../lib/qrm-follow-up-api", () => ({
  ALLOWED_SEQUENCE_TRIGGER_STAGES: ["quote_sent"],
  listCrmFollowUpSequences,
  listCrmSequenceEnrollments,
  saveCrmFollowUpSequence: mock(async () => ({
    id: "seq-new",
    name: "Post-quote revenue rescue",
    description: "Saved starter sequence",
    triggerStage: "quote_sent",
    isActive: true,
    createdBy: "user-1",
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T12:00:00.000Z",
    steps: [],
  })),
  updateCrmSequenceEnrollmentStatus: mock(async () => undefined),
}));

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
}));

const { QrmFollowUpSequencesPage } = await import("../QrmFollowUpSequencesPage");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("QrmFollowUpSequencesPage (integration)", () => {
  test("presents sequences as live automation and starts a world-class starter flow", async () => {
    render(
      <Providers>
        <QrmFollowUpSequencesPage userId="user-1" />
      </Providers>,
    );

    expect(screen.getByText("QRM Sequences")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("Post-Quote Follow-Up (5-Step)").length).toBeGreaterThan(0);
    });

    expect(listCrmFollowUpSequences).toHaveBeenCalled();
    expect(listCrmSequenceEnrollments).toHaveBeenCalled();
    expect(screen.queryByText("DEMO")).toBeNull();
    expect(screen.getByText("Live QEP automation")).toBeTruthy();
    expect(screen.getByText(/reads and writes live QEP automation records/i)).toBeTruthy();
    expect(screen.getByText("World-class measurement")).toBeTruthy();
    expect(screen.getByText("Moonshot operating standard")).toBeTruthy();
    expect(screen.getByText("RPC + tables")).toBeTruthy();
    expect(screen.getByText("Pause · resume · cancel")).toBeTruthy();
    expect(screen.getByText("Excavator quote")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /new sequence/i }));

    await waitFor(() => {
      expect((screen.getByLabelText("Sequence name") as HTMLInputElement).value).toBe("Post-quote revenue rescue");
    });

    expect(screen.getByText(/Starter automation drafted/i)).toBeTruthy();
    expect(screen.getByDisplayValue("Confirm the next committed quote move")).toBeTruthy();
    expect(screen.getByDisplayValue("Keeping your equipment decision moving")).toBeTruthy();
  });
});
