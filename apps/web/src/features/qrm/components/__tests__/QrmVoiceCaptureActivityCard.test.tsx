import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { QrmActivityItem } from "../../lib/types";
import { readVoiceCaptureTimelineSignals } from "../../lib/voice-capture-activity-metadata";
import { QrmVoiceCaptureActivityCard } from "../QrmVoiceCaptureActivityCard";

function buildVoiceActivity(metadata: Record<string, unknown>, body = "Fallback body transcript"): QrmActivityItem {
  return {
    id: "voice-activity-1",
    workspaceId: "workspace-1",
    activityType: "note",
    body,
    occurredAt: "2026-05-19T16:00:00.000Z",
    contactId: null,
    companyId: null,
    dealId: null,
    createdBy: "rep-1",
    metadata,
    createdAt: "2026-05-19T16:00:00.000Z",
    updatedAt: "2026-05-19T16:00:00.000Z",
  };
}

describe("QrmVoiceCaptureActivityCard", () => {
  test("renders transcript, target metadata, and signal summary", () => {
    const activity = buildVoiceActivity({
      source: "voice_capture",
      targetSource: "inbox",
      transcript: "Talked with Randy about VIO55 financing options.",
      extractedSummary: {
        contactName: "Randy",
        machineInterest: "VIO55",
        nextStep: "Send quote",
        managerAttentionFlag: false,
      },
      actionItems: ["Send quote by 4pm"],
    });

    const signals = readVoiceCaptureTimelineSignals(activity);
    render(<QrmVoiceCaptureActivityCard activity={activity} signals={signals} showSignals={true} />);

    expect(screen.getByText("Voice capture")).toBeTruthy();
    expect(screen.getByText("Voice Capture Inbox")).toBeTruthy();
    expect(screen.getByText("Needs assignment")).toBeTruthy();
    expect(screen.getByText("Field note signals")).toBeTruthy();

    const transcript = screen.getByText("Talked with Randy about VIO55 financing options.");
    expect(transcript).toBeTruthy();
  });
});
