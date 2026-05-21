import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastMock = mock(() => undefined);
const rpcMock = mock(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null }));

type LabelRow = Record<string, unknown> & {
  id: string;
  voice_capture_id: string;
  speaker_key: string;
  status: string;
  suggested_display_name: string | null;
  suggested_entity_type: string | null;
  suggested_entity_id: string | null;
  suggestion_source: string;
  suggestion_confidence: number | null;
};

let labelRows: LabelRow[] = [];

function makeLabel(overrides: Partial<LabelRow> = {}): LabelRow {
  return {
    id: "label-1",
    workspace_id: "qep",
    voice_capture_id: "capture-1",
    speaker_key: "speaker_1",
    status: "suggested",
    suggested_display_name: "Rylee Rep",
    suggested_entity_type: "user",
    suggested_entity_id: "user-1",
    suggestion_source: "recorder_profile",
    suggestion_confidence: 0.95,
    assigned_display_name: null,
    assigned_entity_type: null,
    assigned_entity_id: null,
    assigned_by: null,
    assigned_at: null,
    rejected_by: null,
    rejected_at: null,
    created_by: "user-1",
    created_at: "2026-05-20T20:00:00.000Z",
    updated_at: "2026-05-20T20:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

function makeQuery() {
  let rows = [...labelRows];
  return {
    select() {
      return this;
    },
    eq(column: string, value: unknown) {
      rows = rows.filter((row) => row[column] === value);
      return this;
    },
    order() {
      rows = [...rows].sort((a, b) => String(a.speaker_key).localeCompare(String(b.speaker_key)));
      return this;
    },
    get data() {
      return rows;
    },
    error: null,
  };
}

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: mock(() => makeQuery()),
    rpc: rpcMock,
  },
}));

const { VoiceSpeakerLabelPanel } = await import("./VoiceSpeakerLabelPanel");

beforeEach(() => {
  toastMock.mockClear();
  rpcMock.mockClear();
  labelRows = [makeLabel()];
  rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "confirm_voice_capture_speaker_label") {
      const confirmed = {
        ...labelRows[0],
        status: "confirmed",
        assigned_display_name: args.p_display_name,
        assigned_by: "user-1",
        assigned_at: "2026-05-20T20:05:00.000Z",
      } as LabelRow;
      labelRows = [confirmed];
      return { data: confirmed, error: null };
    }
    if (fn === "reject_voice_capture_speaker_label") {
      const rejected = {
        ...labelRows[0],
        status: "rejected",
        rejected_by: "user-1",
        rejected_at: "2026-05-20T20:05:00.000Z",
      } as LabelRow;
      labelRows = [rejected];
      return { data: rejected, error: null };
    }
    return { data: null, error: null };
  });
});

afterEach(cleanup);

describe("VoiceSpeakerLabelPanel", () => {
  test("loads suggestions without auto-assigning and confirms only on user click", async () => {
    render(<VoiceSpeakerLabelPanel captureId="capture-1" />);

    await waitFor(() => {
      expect(screen.getByText("Suggested speaker label — not assigned yet. Confirm to apply this label.")).toBeTruthy();
    });

    expect(screen.getByText("speaker_1")).toBeTruthy();
    expect(screen.getByText("Rylee Rep")).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("confirm_voice_capture_speaker_label", {
        p_label_id: "label-1",
        p_display_name: "Rylee Rep",
        p_entity_type: "user",
        p_entity_id: "user-1",
      });
    });
    expect(screen.getByText("confirmed")).toBeTruthy();
  });

  test("lets the user edit the confirmation name or reject the suggestion explicitly", async () => {
    render(<VoiceSpeakerLabelPanel captureId="capture-1" />);

    await waitFor(() => expect(screen.getByText("speaker_1")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Edit name/i }));
    fireEvent.change(screen.getByLabelText("Speaker name for speaker_1"), {
      target: { value: "Casey Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("confirm_voice_capture_speaker_label", expect.objectContaining({
        p_display_name: "Casey Customer",
      }));
    });

    cleanup();
    rpcMock.mockClear();
    labelRows = [makeLabel({ id: "label-2", speaker_key: "customer", suggested_display_name: "Casey Customer" })];
    render(<VoiceSpeakerLabelPanel captureId="capture-1" />);

    await waitFor(() => expect(screen.getByText("customer")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("reject_voice_capture_speaker_label", {
        p_label_id: "label-2",
      });
    });
    expect(screen.getByText("rejected")).toBeTruthy();
  });
});
