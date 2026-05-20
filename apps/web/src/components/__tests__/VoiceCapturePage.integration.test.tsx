import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    summary_bullets: [
      "John wants a skid steer upgrade after the DFW site visit.",
      "Customer is evaluating availability before committing.",
      "Rep should send model options and pricing.",
      "Budget still needs confirmation from the buyer.",
      "Next step is a follow-up quote review.",
    ],
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
    summary_bullets: null,
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
    summary_bullets: null,
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
    summary_bullets: null,
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
    summary_bullets: null,
    sync_error: null,
    updated_at: "2026-04-20T18:35:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-5.webm",
  },
  {
    id: "note-6",
    created_at: "2026-04-19T18:32:00.000Z",
    duration_seconds: 21,
    sync_status: "pending",
    hubspot_deal_id: null,
    linked_deal_id: null,
    transcript: "You",
    summary_bullets: null,
    sync_error: null,
    updated_at: "2026-04-19T18:35:00.000Z",
    user_id: "user-1",
    audio_storage_path: "user-1/note-6.webm",
  },
];

function makeQuery(data: unknown) {
  let rows = Array.isArray(data) ? [...data] : data;
  const query = {
    get data() {
      return rows;
    },
    error: null,
    select() {
      return this;
    },
    order() {
      return this;
    },
    limit(count?: number) {
      if (typeof count === "number" && Array.isArray(rows)) rows = rows.slice(0, count);
      return this;
    },
    eq(column: string, value: unknown) {
      if (Array.isArray(rows)) {
        rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
      }
      return this;
    },
    in(column: string, values: unknown[]) {
      if (Array.isArray(rows)) {
        rows = rows.filter((row) => values.includes((row as Record<string, unknown>)[column]));
      }
      return this;
    },
    is() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null });
    },
    single() {
      return Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null });
    },
  };
  return query;
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
      status: "queued",
      lastError: null,
      attemptCount: 0,
      lastAttemptAt: null,
    },
    {
      id: "queued-2",
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      fileName: "recording.webm",
      durationSeconds: 33,
      dealId: "55555555-5555-4555-8555-555555555555",
      dealLabel: "Retry field note",
      queuedAt: "2026-04-23T14:02:00.000Z",
      status: "failed",
      lastError: "Rate limited. Try again in a minute.",
      attemptCount: 2,
      lastAttemptAt: "2026-04-23T14:04:00.000Z",
    },
  ]),
  enqueueVoiceNote: mock(async () => undefined),
  removeQueuedVoiceNotes: mock(async () => undefined),
  updateQueuedVoiceNote: mock(async () => undefined),
}));

import { VoiceCapturePage, isLowSignalFieldNoteTranscript } from "../VoiceCapturePage";

describe("VoiceCapturePage transcript signal guard", () => {
  test("rejects OpenAI filler hallucinations but allows short actionable notes", () => {
    expect(isLowSignalFieldNoteTranscript("You", 21)).toBe(true);
    expect(isLowSignalFieldNoteTranscript("hello there", 16)).toBe(true);
    expect(isLowSignalFieldNoteTranscript("call John tomorrow", 21)).toBe(false);
    expect(isLowSignalFieldNoteTranscript("210G excavator", 16)).toBe(false);
  });
});

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
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByDisplayValue("All")).toBeTruthy();
    expect(screen.getByDisplayValue("All time")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/John wants a skid steer upgrade after the DFW site visit/i)).toBeTruthy();
    });

    expect(screen.getByText("City bid review")).toBeTruthy();
    expect(screen.getByText("Transcript needs re-record")).toBeTruthy();
    expect(screen.getByText(/Transcript was too short to trust/i)).toBeTruthy();
    expect(screen.queryByText(/^Transcript preview:\s*You$/)).toBeNull();
    expect(screen.getAllByText("Synced to QRM").length).toBeGreaterThan(0);
    expect(screen.getByText("1111...1111")).toBeTruthy();
    expect(screen.queryByText("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(screen.getAllByText("Needs match").length).toBeGreaterThan(0);
    expect(screen.getByText("Queued locally")).toBeTruthy();
    expect(screen.getByText("Retry needed")).toBeTruthy();
    expect(screen.getAllByText(/Rate limited\. Try again in a minute\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 need retry/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^Play /).length).toBeGreaterThanOrEqual(5);

    fireEvent.click(screen.getAllByRole("button", { name: "Open note" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Key takeaways")).toBeTruthy();
      expect(screen.getAllByText(/Rep should send model options and pricing/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Full transcript")).toBeTruthy();
    });
  });
});
