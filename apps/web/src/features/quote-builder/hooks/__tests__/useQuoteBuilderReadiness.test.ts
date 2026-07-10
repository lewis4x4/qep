import { describe, expect, test } from "bun:test";

import type { QuotePacketReadiness } from "../../../../../../../shared/qep-moonshot-contracts";
import {
  applyOemRequoteReadiness,
  OEM_REQUOTE_READINESS_BLOCKER,
} from "../useQuoteBuilderReadiness";

const readyPacket: QuotePacketReadiness = {
  draft: { ready: true, missing: [] },
  send: { ready: true, missing: [] },
  canSave: true,
  canSend: true,
  missing: [],
};

describe("applyOemRequoteReadiness", () => {
  test("keeps draft saving available but blocks every customer send readiness surface", () => {
    const result = applyOemRequoteReadiness(readyPacket, true);

    expect(result.draft).toEqual(readyPacket.draft);
    expect(result.canSave).toBe(true);
    expect(result.send.ready).toBe(false);
    expect(result.canSend).toBe(false);
    expect(result.send.missing).toContain(OEM_REQUOTE_READINESS_BLOCKER);
    expect(result.missing).toContain(OEM_REQUOTE_READINESS_BLOCKER);
  });

  test("returns the existing readiness unchanged when no OEM review is pending", () => {
    expect(applyOemRequoteReadiness(readyPacket, false)).toBe(readyPacket);
  });
});
