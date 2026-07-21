import { describe, expect, test } from "bun:test";

describe("IronBar voice safety gate", () => {
  test("parks a transcript for confirmation instead of dispatching it immediately", async () => {
    const source = await Bun.file(`${import.meta.dir}/IronBar.tsx`).text();

    expect(source).toContain("setPendingVoiceConfirmation({");
    expect(source).toContain("<IronVoiceConfirmation");
    expect(source).toContain("buildConfirmedIronVoiceRequest(");
    expect(source).not.toContain('await send(transcribed.transcript, { mode: "voice" })');
  });

  test("restores the editable transcript focus when confirmation is canceled", async () => {
    const source = await Bun.file(`${import.meta.dir}/IronBar.tsx`).text();

    expect(source).toContain("const cancelPendingVoice = useCallback");
    expect(source).toContain("window.setTimeout(() => inputRef.current?.focus(), 0)");
    expect(source).toContain("onCancel={cancelPendingVoice}");
  });
});
