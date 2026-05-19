import { describe, expect, it } from "bun:test";
import {
  isVoiceCaptureActivity,
  readVoiceCaptureTargetMetadata,
  readVoiceCaptureTimelineSignals,
  readVoiceCaptureTranscript,
  voiceCaptureSignalsHaveContent,
} from "./voice-capture-activity-metadata";
import type { QrmActivityItem } from "./types";

function activityWithMetadata(metadata: Record<string, unknown>): QrmActivityItem {
  return {
    id: "activity-1",
    workspaceId: "workspace-1",
    activityType: "call",
    body: "Voice capture",
    occurredAt: "2026-05-01T15:00:00.000Z",
    contactId: null,
    companyId: null,
    dealId: null,
    createdBy: "rep-1",
    metadata,
    createdAt: "2026-05-01T15:00:00.000Z",
    updatedAt: "2026-05-01T15:00:00.000Z",
  };
}

describe("voice capture activity metadata", () => {
  it("reads voice-capture summary fields through metadata guards", () => {
    const signals = readVoiceCaptureTimelineSignals(activityWithMetadata({
      source: "voice_capture",
      extractedSummary: {
        contactName: "Ava Fields",
        machineInterest: "VIO55",
        managerAttentionFlag: true,
        competitorsMentioned: ["Bobcat", "", 42],
      },
      actionItems: ["Send quote", "", 12],
    }));

    expect(signals).toEqual({
      summary: {
        contactName: "Ava Fields",
        companyName: null,
        machineInterest: "VIO55",
        applicationUseCase: null,
        equipmentMake: null,
        equipmentModel: null,
        dealStage: null,
        urgencyLevel: null,
        financingInterest: null,
        tradeInLikelihood: null,
        nextStep: null,
        followUpDate: null,
        keyConcerns: null,
        competitorsMentioned: ["Bobcat"],
        recommendedNextAction: null,
        managerAttentionFlag: true,
      },
      actionItems: ["Send quote"],
    });
    expect(signals && voiceCaptureSignalsHaveContent(signals)).toBe(true);
  });

  it("reads transcript and inbox target metadata for voice-capture activity", () => {
    const activity = activityWithMetadata({
      source: "voice_capture",
      targetSource: "inbox",
      transcript: "Customer asked for a same-day quote.",
      resolvedCompanyId: "company-inbox",
    });

    expect(readVoiceCaptureTranscript(activity)).toBe("Customer asked for a same-day quote.");
    expect(readVoiceCaptureTargetMetadata(activity)).toEqual({
      source: "inbox",
      label: "Voice Capture Inbox",
      needsAssignment: true,
      resolvedDealId: null,
      resolvedCompanyId: "company-inbox",
      resolvedContactId: null,
    });
  });

  it("ignores non-voice and malformed summary metadata", () => {
    expect(isVoiceCaptureActivity(activityWithMetadata({ source: "note" }))).toBe(false);
    expect(readVoiceCaptureTranscript(activityWithMetadata({ source: "note" }))).toBeNull();
    expect(readVoiceCaptureTargetMetadata(activityWithMetadata({ source: "note" }))).toBeNull();
    expect(readVoiceCaptureTimelineSignals(activityWithMetadata({
      source: "voice_capture",
      extractedSummary: [],
    }))).toBeNull();
  });
});
