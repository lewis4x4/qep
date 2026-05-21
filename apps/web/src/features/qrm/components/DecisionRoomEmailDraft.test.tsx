import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
  toast: mock(() => undefined),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mock(async () => ({ data: { session: { access_token: "token-1" } } })),
    },
  },
}));

const { DecisionRoomEmailDraft } = await import("./DecisionRoomEmailDraft");

const seat: DecisionRoomSeat = {
  id: "contact:seat-1",
  status: "named",
  archetype: "operations",
  archetypeLabel: "Operations",
  name: "Jamie Buyer",
  title: "Ops Manager",
  email: "jamie@example.com",
  phone: null,
  confidence: "high",
  stance: "neutral",
  powerWeight: 0.7,
  vetoWeight: 0.4,
  evidence: [{ kind: "activity", label: "Concerned about install timing", occurredAt: null, sourceId: null }],
  lastSignalAt: null,
  findGuidance: null,
};

function renderWithQueryClient(children: PropsWithChildren["children"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("DecisionRoomEmailDraft voice gate", () => {
  test("blocks copy and mailto until the generated draft is edited", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        subject: "Install timing next step",
        body: "Can we talk about install timing tomorrow?",
        recipientEmail: "jamie@example.com",
        voice_compliance: {
          policy: "E2.2/QEP-125",
          required: true,
          status: "requires_human_edit",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;

    renderWithQueryClient(
      <DecisionRoomEmailDraft
        seat={seat}
        dealId="11111111-1111-4111-8111-111111111111"
        dealName="Excavator deal"
        companyName="Acme Construction"
        repName="Rylee"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Draft an email to this seat/i }));
    fireEvent.click(screen.getByRole("button", { name: /Draft email/i }));

    const subjectInput = await screen.findByLabelText("Editable email subject");
    expect(screen.getByText(/E2\.2 voice gate: human edit required/i)).toBeTruthy();

    const copyButton = screen.getByRole("button", { name: /Copy edited draft/i }) as HTMLButtonElement;
    expect(copyButton.disabled).toBe(true);
    const mailtoLink = screen.getByRole("link", { name: /Open edited draft in mail client/i });
    expect(mailtoLink.getAttribute("aria-disabled")).toBe("true");

    fireEvent.change(subjectInput, { target: { value: "Edited install timing next step" } });

    await waitFor(() => expect(copyButton.disabled).toBe(false));
    expect(mailtoLink.getAttribute("aria-disabled")).toBe("false");
    expect(mailtoLink.getAttribute("href")).toContain("subject=Edited%20install%20timing%20next%20step");
  });
});
