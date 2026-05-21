import { assertEquals } from "jsr:@std/assert@1";
import {
  buildVoiceCaptureSpeakerSuggestions,
  ensureVoiceCaptureSpeakerSuggestions,
} from "./voice-speaker-labels.ts";

class FakeQuery {
  private filters: Record<string, unknown> = {};
  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
    private readonly mode: "select" | "update",
    private readonly payload?: Record<string, unknown>,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.client.selectOne(this.table, this.filters), error: null });
  }

  then(
    resolve: (value: { data: null; error: null }) => void,
    _reject?: (reason?: unknown) => void,
  ) {
    if (this.mode === "update") {
      this.client.update(this.table, this.filters, this.payload ?? {});
    }
    resolve({ data: null, error: null });
  }
}

class FakeTable {
  constructor(private readonly client: FakeSupabaseClient, private readonly table: string) {}

  select() {
    return new FakeQuery(this.client, this.table, "select");
  }

  insert(row: Record<string, unknown>) {
    return Promise.resolve(this.client.insert(this.table, row));
  }

  update(payload: Record<string, unknown>) {
    return new FakeQuery(this.client, this.table, "update", payload);
  }
}

class FakeSupabaseClient {
  rows: Record<string, Array<Record<string, unknown>>> = {
    profiles: [{ id: "user-1", full_name: "Rylee Rep", email: "rylee@example.com" }],
    crm_contacts: [
      { id: "contact-1", workspace_id: "qep", deleted_at: null, first_name: "Casey", last_name: "Customer" },
      { id: "contact-foreign", workspace_id: "other", deleted_at: null, first_name: "Foreign", last_name: "Contact" },
    ],
    crm_companies: [
      { id: "company-1", workspace_id: "qep", deleted_at: null, name: "QEP Rentals" },
      { id: "company-foreign", workspace_id: "other", deleted_at: null, name: "Foreign Co" },
    ],
    voice_capture_speaker_labels: [],
  };

  from(table: string) {
    return new FakeTable(this, table);
  }

  selectOne(table: string, filters: Record<string, unknown>) {
    return this.rows[table]?.find((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value)
    ) ?? null;
  }

  insert(table: string, row: Record<string, unknown>) {
    if (table === "voice_capture_speaker_labels") {
      const duplicate = this.rows[table].some((existing) =>
        existing.workspace_id === row.workspace_id &&
        existing.voice_capture_id === row.voice_capture_id &&
        existing.speaker_key === row.speaker_key
      );
      if (duplicate) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
    }
    this.rows[table].push({ ...row });
    return { data: null, error: null };
  }

  update(table: string, filters: Record<string, unknown>, payload: Record<string, unknown>) {
    this.rows[table] = this.rows[table].map((row) => {
      const matches = Object.entries(filters).every(([key, value]) => row[key] === value);
      return matches ? { ...row, ...payload } : row;
    });
  }
}

Deno.test("buildVoiceCaptureSpeakerSuggestions creates suggestions only, never assignments", () => {
  const suggestions = buildVoiceCaptureSpeakerSuggestions({
    workspaceId: "qep",
    captureId: "capture-1",
    actorUserId: "user-1",
    captureMode: "live_call",
    linkedContactId: "contact-1",
    linkedCompanyId: "company-1",
    recorderDisplayName: "Rylee Rep",
    linkedContactName: "Casey Customer",
  });

  assertEquals(suggestions.length, 2);
  assertEquals(suggestions[0], {
    speaker_key: "rep",
    suggested_display_name: "Rylee Rep",
    suggested_entity_type: "user",
    suggested_entity_id: "user-1",
    suggestion_source: "recorder_profile",
    suggestion_confidence: 0.9,
  });
  assertEquals(suggestions[1]?.speaker_key, "customer");
  assertEquals(Object.keys(suggestions[1] ?? {}).some((key) => key.startsWith("assigned_")), false);
});

Deno.test("ensureVoiceCaptureSpeakerSuggestions ignores foreign-workspace linked entity names", async () => {
  const client = new FakeSupabaseClient();

  await ensureVoiceCaptureSpeakerSuggestions(client as never, {
    workspaceId: "qep",
    captureId: "capture-foreign",
    actorUserId: "user-1",
    captureMode: "live_call",
    linkedContactId: "contact-foreign",
    linkedCompanyId: "company-foreign",
    extractedContactName: "Transcript Customer",
  });

  const customer = client.rows.voice_capture_speaker_labels.find((row) => row.speaker_key === "customer");
  assertEquals(client.rows.voice_capture_speaker_labels.length, 2);
  assertEquals(customer?.suggested_display_name, "Transcript Customer");
  assertEquals(customer?.suggested_entity_type, "freeform");
  assertEquals(customer?.suggested_entity_id, null);
});

Deno.test("ensureVoiceCaptureSpeakerSuggestions is idempotent and does not overwrite confirmed rows", async () => {
  const client = new FakeSupabaseClient();

  await ensureVoiceCaptureSpeakerSuggestions(client as never, {
    workspaceId: "qep",
    captureId: "capture-1",
    actorUserId: "user-1",
    captureMode: "live_call",
    linkedContactId: "contact-1",
    linkedCompanyId: "company-1",
    linkedDealId: "deal-1",
  });

  await ensureVoiceCaptureSpeakerSuggestions(client as never, {
    workspaceId: "qep",
    captureId: "capture-1",
    actorUserId: "user-1",
    captureMode: "live_call",
    linkedContactId: "contact-1",
    linkedCompanyId: "company-1",
    linkedDealId: "deal-1",
  });

  assertEquals(client.rows.voice_capture_speaker_labels.length, 2);
  assertEquals(client.rows.voice_capture_speaker_labels.map((row) => row.status), ["suggested", "suggested"]);

  client.rows.voice_capture_speaker_labels[0] = {
    ...client.rows.voice_capture_speaker_labels[0],
    status: "confirmed",
    suggested_display_name: "Confirmed Rep",
    assigned_display_name: "Confirmed Rep",
    assigned_by: "user-1",
  };

  await ensureVoiceCaptureSpeakerSuggestions(client as never, {
    workspaceId: "qep",
    captureId: "capture-1",
    actorUserId: "user-1",
    captureMode: "live_call",
    linkedContactId: "contact-1",
    linkedCompanyId: "company-1",
  });

  assertEquals(client.rows.voice_capture_speaker_labels.length, 2);
  assertEquals(client.rows.voice_capture_speaker_labels[0]?.status, "confirmed");
  assertEquals(client.rows.voice_capture_speaker_labels[0]?.suggested_display_name, "Confirmed Rep");
});
