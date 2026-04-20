/**
 * moveCompletionHelpers — pure utilities for the Slice 5 closure UI.
 *
 * Lives in its own module (not inside MoveCard.tsx) so Bun tests can import
 * it without pulling in React/@tanstack/query. Mirrors the pattern used by
 * askIronHelpers.ts and signalCardHelpers.ts.
 */

import type { QrmTouchChannel } from "../lib/qrm-router-api";

/** Ordered list for the touch-composer dropdown. Keep call/email first. */
export const TOUCH_CHANNEL_OPTIONS: ReadonlyArray<{
  value: QrmTouchChannel;
  label: string;
}> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "sms", label: "SMS" },
  { value: "field_visit", label: "Field visit" },
  { value: "voice_note", label: "Voice note" },
  { value: "chat", label: "Chat" },
  { value: "other", label: "Other" },
];

const CHANNEL_VALUES: ReadonlySet<QrmTouchChannel> = new Set<QrmTouchChannel>(
  TOUCH_CHANNEL_OPTIONS.map((o) => o.value),
);

export function isValidTouchChannel(v: unknown): v is QrmTouchChannel {
  return typeof v === "string" && CHANNEL_VALUES.has(v as QrmTouchChannel);
}

/**
 * Sanitize a free-form summary before sending to the API. We trim, collapse
 * interior whitespace, and cap at 280 chars — long enough for a one-line
 * note, short enough to keep the signals/graph queries fast.
 */
export function sanitizeTouchSummary(raw: string, maxChars = 280): string {
  if (typeof raw !== "string") return "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars - 1) + "…";
}

/**
 * Parse the duration input the composer shows (e.g. "8", "8m", "1h30m") and
 * return a seconds integer. Returns null on garbage input or empty string —
 * the composer should omit the field rather than sending 0.
 *
 * Deliberately narrow: we accept "<digits>" as minutes, "<digits>m",
 * "<digits>h", or "<digits>h<digits>m". Anything else → null, no toast, no
 * browser alert; the UI surfaces the validation inline.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const plainMinutes = /^(\d+)$/.exec(trimmed);
  if (plainMinutes) return Number(plainMinutes[1]) * 60;

  const minutesOnly = /^(\d+)m$/.exec(trimmed);
  if (minutesOnly) return Number(minutesOnly[1]) * 60;

  const hoursOnly = /^(\d+)h$/.exec(trimmed);
  if (hoursOnly) return Number(hoursOnly[1]) * 3_600;

  const hhmm = /^(\d+)h(\d+)m$/.exec(trimmed);
  if (hhmm) return Number(hhmm[1]) * 3_600 + Number(hhmm[2]) * 60;

  return null;
}

/**
 * Human label for a touch channel. Falls back to a Title Case of the key
 * so new DB enum values don't break the UI if the client is out of date.
 */
export function humanizeTouchChannel(channel: string): string {
  const match = TOUCH_CHANNEL_OPTIONS.find((o) => o.value === channel);
  if (match) return match.label;
  return channel
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
