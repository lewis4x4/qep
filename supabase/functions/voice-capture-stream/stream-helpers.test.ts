import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFinalTranscript,
  buildStreamExtractedData,
  findMissingChunkIndexes,
  normalizeStreamAction,
} from "./stream-helpers.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

Deno.test("buildFinalTranscript orders chunks and ignores duplicate indexes", () => {
  assertEquals(
    buildFinalTranscript([
      { chunk_index: 2, transcript: "third" },
      { chunk_index: 0, transcript: "first" },
      { chunk_index: 1, transcript: "second" },
      { chunk_index: 1, transcript: "duplicate second" },
      { chunk_index: 4, transcript: "" },
    ]),
    "first\nsecond\nthird",
  );
});

Deno.test("findMissingChunkIndexes reports gaps within expected count", () => {
  assertEquals(
    findMissingChunkIndexes(5, [
      { chunk_index: 0, transcript: "zero" },
      { chunk_index: 2, transcript: "two" },
      { chunk_index: 4, transcript: "four" },
    ]),
    [1, 3],
  );
});

Deno.test("normalizeStreamAction validates start and chunk bodies", () => {
  assertEquals(
    normalizeStreamAction({
      action: "start",
      clientSessionId: "client-1",
      companyId: COMPANY_ID,
    }),
    {
      ok: true,
      value: {
        action: "start",
        clientSessionId: "client-1",
        companyId: COMPANY_ID,
        contactId: null,
        dealId: null,
      },
    },
  );

  const chunk = normalizeStreamAction({
    action: "chunk",
    sessionId: SESSION_ID,
    clientSessionId: "client-1",
    clientChunkId: "chunk-0",
    chunkIndex: 0,
    audioBase64: "YWJjZGVmZ2hpamtsbW5vcA==",
    mimeType: "audio/webm;codecs=opus",
    durationMs: 10_000,
  });

  assertEquals(chunk.ok, true);
  if (chunk.ok) {
    assertEquals(chunk.value.action, "chunk");
    if (chunk.value.action === "chunk") {
      assertEquals(chunk.value.chunkIndex, 0);
      assertEquals(chunk.value.clientChunkId, "chunk-0");
    }
  }
});

Deno.test("normalizeStreamAction rejects unsupported action and bad ids", () => {
  assertEquals(
    normalizeStreamAction({
      action: "bogus",
      clientSessionId: "client-1",
      sessionId: SESSION_ID,
    }),
    { ok: false, error: "unsupported_action", status: 400 },
  );
  assertEquals(
    normalizeStreamAction({
      action: "start",
      clientSessionId: "client-1",
      companyId: "nope",
    }),
    { ok: false, error: "invalid_company_id", status: 400 },
  );
});

Deno.test("buildStreamExtractedData marks live call capture metadata", () => {
  assertEquals(
    buildStreamExtractedData({
      streamSessionId: SESSION_ID,
      clientSessionId: "client-1",
      chunkCount: 3,
      companyId: COMPANY_ID,
      finalizedAt: "2026-05-20T17:00:00.000Z",
    }),
    {
      source: "voice_capture_stream",
      captureMode: "live_call",
      streamSessionId: SESSION_ID,
      clientSessionId: "client-1",
      chunkCount: 3,
      companyId: COMPANY_ID,
      contactId: null,
      dealId: null,
      finalizedAt: "2026-05-20T17:00:00.000Z",
    },
  );
});
