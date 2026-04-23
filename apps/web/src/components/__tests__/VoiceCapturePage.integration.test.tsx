import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
  toast: mock(() => undefined),
}));

const recentCaptures = [
  {
    id: "note-1",
    created_at: "2026-04-23T13:23:00.000Z",
    duration_seconds: 52,
    sync_status: "synced",
    hubspot_deal_id: "11111111-1111-4111-8111-111111111111",
    linked_deal_id: "11111111-1111-4111-8111-111111111111",
    transcript: "DFW site visit recap. Met with John onsite about skid steer upgrade.",
    sync_error: null,
    updated_at: "2026-04-23T13:25:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-1.webm",
  },
  {
    id: "note-2",
    created_at: "2026-04-22T19:41:00.000Z",
    duration_seconds: 74,
    sync_status: "pending",
    hubspot_deal_id: "22222222-2222-4222-8222-222222222222",
    linked_deal_id: "22222222-2222-4222-8222-222222222222",
    transcript: "North Star Construction follow-up. Interested in a 210P excavator.",
    sync_error: null,
    updated_at: "2026-04-22T19:43:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-2.webm",
  },
  {
    id: "note-3",
    created_at: "2026-04-22T14:18:00.000Z",
    duration_seconds: 37,
    sync_status: "pending",
    hubspot_deal_id: null,
    linked_deal_id: null,
    transcript: "Greenfield Materials check-in. They are waiting on budget approval.",
    sync_error: null,
    updated_at: "2026-04-22T14:19:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-3.webm",
  },
  {
    id: "note-4",
    created_at: "2026-04-21T20:05:00.000Z",
    duration_seconds: 65,
    sync_status: "synced",
    hubspot_deal_id: "33333333-3333-4333-8333-333333333333",
    linked_deal_id: "33333333-3333-4333-8333-333333333333",
    transcript: "Pine Ridge Landscaping proposal. Discussed adding a mulcher.",
    sync_error: null,
    updated_at: "2026-04-21T20:07:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-4.webm",
  },
  {
    id: "note-5",
    created_at: "2026-04-20T18:32:00.000Z",
    duration_seconds: 131,
    sync_status: "synced",
    hubspot_deal_id: "44444444-4444-4444-8444-444444444444",
    linked_deal_id: "44444444-4444-4444-8444-444444444444",
    transcript: "City bid review. Reviewing bid specs for the retention pond project.",
    sync_error: null,
    updated_at: "2026-04-20T18:35:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-5.webm",
  },
];

function makeQuery(data: unknown) {
  return {
    data,
    error: null,
    select() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    is() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: mock(async () => ({ data: { user: { id: "user-1" } } })),
      getSession: mock(async () => ({ data: { session: { access_token: "token" } } })),
    },
    from: mock((table: string) => {
      if (table === "voice_captures") return makeQuery(recentCaptures);
      if (table === "profiles") {
        return makeQuery([{ id: "user-1", full_name: "Brian Lewis", email: "brian@example.com" }]);
      }
      return makeQuery([]);
    }),
    storage: {
      from: mock(() => ({
        createSignedUrl: mock(async () => ({ data: { signedUrl: "https://example.com/audio.webm" } })),
      })),
    },
  },
}));

mock.module("@/features/qrm/lib/qrm-supabase", () => ({
  crmSupabase: {
    from: mock(() => makeQuery([])),
  },
}));

mock.module("@/features/sales/lib/offline-store", () => ({
  getQueuedVoiceNotes: mock(async () => [
    {
      id: "queued-1",
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      fileName: "recording.webm",
      durationSeconds: 28,
      dealId: null,
      dealLabel: null,
      queuedAt: "2026-04-23T14:05:00.000Z",
    },
  ]),
  enqueueVoiceNote: mock(async () => undefined),
  removeQueuedVoiceNotes: mock(async () => undefined),
}));

import { VoiceCapturePage } from "../VoiceCapturePage";

describe("VoiceCapturePage redesign", () => {
  test("renders the /sales/field-note voice cockpit with match, offline, and recent-note controls", async () => {
    render(
      <MemoryRouter initialEntries={["/sales/field-note"]}>
        <Routes>
          <Route
            path="/sales/field-note"
            element={<VoiceCapturePage userRole="manager" userEmail="brian@example.com" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("POST-VISIT CAPTURE")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Field Note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
    expect(screen.getByLabelText("Field note workflow")).toBeTruthy();
    expect(screen.getByText("Record")).toBeTruthy();
    expect(screen.getByText("Match to deal")).toBeTruthy();
    expect(screen.getByLabelText("QRM match bar")).toBeTruthy();
    expect(screen.getByText("Match Mode")).toBeTruthy();
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    expect(screen.getByText("Extracted details (preview)")).toBeTruthy();
    expect(screen.getByText("Offline & sync status")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search notes...")).toBeTruthy();
    expect(screen.getByDisplayValue("All")).toBeTruthy();
    expect(screen.getByDisplayValue("All time")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("DFW site visit recap")).toBeTruthy();
    });

    expect(screen.getByText("City bid review")).toBeTruthy();
    expect(screen.getAllByText("Synced to QRM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs match").length).toBeGreaterThan(0);
    expect(screen.getByText("Queued locally")).toBeTruthy();
    expect(screen.getAllByLabelText(/^Play /).length).toBeGreaterThanOrEqual(5);
  });
});
