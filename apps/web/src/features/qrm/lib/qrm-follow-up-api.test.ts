import { describe, expect, test } from "bun:test";
import {
  normalizeFollowUpSequenceRows,
  normalizeFollowUpSequenceRpcPayload,
  normalizeFollowUpStepRows,
  normalizeSequenceEnrollmentRows,
  normalizeSequenceNameRows,
} from "./qrm-follow-up-api";

describe("QRM follow-up API normalizers", () => {
  test("normalizes follow-up step rows and filters malformed step payloads", () => {
    expect(normalizeFollowUpStepRows([
      {
        id: "step-1",
        sequence_id: "seq-1",
        step_number: "1",
        day_offset: "3",
        step_type: "email",
        subject: "Checking in",
        body_template: "Hello",
        task_priority: 42,
        created_at: "2026-04-20T00:00:00Z",
      },
      { id: "bad-type", sequence_id: "seq-1", step_number: 2, day_offset: 5, step_type: "fax", created_at: "2026-04-20T00:00:00Z" },
      { id: "missing-sequence", step_number: 2, day_offset: 5, step_type: "task", created_at: "2026-04-20T00:00:00Z" },
    ])).toEqual([
      {
        id: "step-1",
        sequence_id: "seq-1",
        step_number: 1,
        day_offset: 3,
        step_type: "email",
        subject: "Checking in",
        body_template: "Hello",
        task_priority: null,
        created_at: "2026-04-20T00:00:00Z",
      },
    ]);
  });

  test("normalizes sequence rows and sequence name lookup rows", () => {
    expect(normalizeFollowUpSequenceRows([
      {
        id: "seq-1",
        name: "Quote sent follow-up",
        description: null,
        trigger_stage: "quote_sent",
        is_active: true,
        created_by: "user-1",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-02T00:00:00Z",
      },
      { id: "seq-2", name: "", trigger_stage: "quote_sent", created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-02T00:00:00Z" },
    ])).toEqual([
      {
        id: "seq-1",
        name: "Quote sent follow-up",
        description: null,
        trigger_stage: "quote_sent",
        is_active: true,
        created_by: "user-1",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-02T00:00:00Z",
      },
    ]);

    expect(normalizeSequenceNameRows([{ id: "seq-1", name: "Quote sent" }, { id: "seq-2", name: "" }]))
      .toEqual([{ id: "seq-1", name: "Quote sent" }]);
  });

  test("normalizes enrollment rows with metadata guards and status validation", () => {
    expect(normalizeSequenceEnrollmentRows([
      {
        id: "enroll-1",
        sequence_id: "seq-1",
        deal_id: "deal-1",
        deal_name: "Loader deal",
        contact_id: "contact-1",
        contact_name: "Alice",
        owner_id: "rep-1",
        hub_id: "hub-1",
        enrolled_at: "2026-04-20T00:00:00Z",
        current_step: "2",
        next_step_due_at: "2026-04-23T00:00:00Z",
        status: "active",
        completed_at: null,
        cancelled_at: null,
        metadata: { source: "quote_sent" },
        updated_at: "2026-04-21T00:00:00Z",
      },
      { id: "bad-status", sequence_id: "seq-1", deal_id: "deal-1", hub_id: "hub-1", enrolled_at: "2026-04-20T00:00:00Z", current_step: 1, status: "pending", updated_at: "2026-04-21T00:00:00Z" },
    ])).toEqual([
      {
        id: "enroll-1",
        sequence_id: "seq-1",
        deal_id: "deal-1",
        deal_name: "Loader deal",
        contact_id: "contact-1",
        contact_name: "Alice",
        owner_id: "rep-1",
        hub_id: "hub-1",
        enrolled_at: "2026-04-20T00:00:00Z",
        current_step: 2,
        next_step_due_at: "2026-04-23T00:00:00Z",
        status: "active",
        completed_at: null,
        cancelled_at: null,
        metadata: { source: "quote_sent" },
        updated_at: "2026-04-21T00:00:00Z",
      },
    ]);
  });

  test("normalizes saved sequence RPC payloads and drops malformed steps", () => {
    expect(normalizeFollowUpSequenceRpcPayload({
      id: "seq-1",
      name: "Quote sent follow-up",
      description: "Keep momentum",
      triggerStage: "quote_sent",
      isActive: true,
      createdBy: "user-1",
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-02T00:00:00Z",
      steps: [
        {
          id: "step-1",
          sequenceId: "seq-1",
          stepNumber: "1",
          dayOffset: "2",
          stepType: "task",
          subject: null,
          bodyTemplate: null,
          taskPriority: "high",
          createdAt: "2026-04-01T00:00:00Z",
        },
        { id: "bad", sequenceId: "seq-1", stepNumber: 2, dayOffset: 4, stepType: "bad", createdAt: "2026-04-01T00:00:00Z" },
      ],
    })).toEqual({
      id: "seq-1",
      name: "Quote sent follow-up",
      description: "Keep momentum",
      triggerStage: "quote_sent",
      isActive: true,
      createdBy: "user-1",
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-02T00:00:00Z",
      steps: [{
        id: "step-1",
        sequenceId: "seq-1",
        stepNumber: 1,
        dayOffset: 2,
        stepType: "task",
        subject: null,
        bodyTemplate: null,
        taskPriority: "high",
        createdAt: "2026-04-01T00:00:00Z",
      }],
    });

    expect(normalizeFollowUpSequenceRpcPayload({ id: "missing-required" })).toBeNull();
  });
});
