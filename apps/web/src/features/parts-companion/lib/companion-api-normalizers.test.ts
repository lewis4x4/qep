import { describe, expect, test } from "bun:test";
import {
  normalizeCounterInquiries,
  normalizeMachineProfile,
  normalizeMachineProfiles,
  normalizePartsPreferences,
  normalizeQueueItem,
  normalizeQueueItems,
  normalizeRequestActivities,
} from "./companion-api-normalizers";

const queueRow = {
  id: "request-1",
  workspace_id: "default",
  requested_by: "user-1",
  assigned_to: "user-2",
  request_source: "service",
  priority: "urgent",
  status: "locating",
  customer_id: "company-1",
  customer_name: "Tigercat Logistics",
  machine_profile_id: "machine-1",
  machine_description: "333G",
  work_order_number: "WO-1",
  bay_number: "B1",
  items: [{ part_number: "P-100", description: "Filter", quantity: "2", status: "pulled", notes: "Shelf A" }],
  notes: "Need today",
  estimated_completion: "2026-05-03T15:00:00.000Z",
  auto_escalated: true,
  escalated_at: "2026-05-03T14:00:00.000Z",
  created_at: "2026-05-03T12:00:00.000Z",
  updated_at: "2026-05-03T13:00:00.000Z",
  fulfilled_at: null,
  cancelled_at: null,
  requester_name: "Requester",
  assignee_name: "Assignee",
  machine_manufacturer: "Deere",
  machine_model: "333G",
  machine_category: "loader",
  age_minutes: "30",
  priority_sort: "1",
  is_overdue: true,
};

const machineRow = {
  id: "machine-1",
  workspace_id: "default",
  manufacturer: "Deere",
  model: "333G",
  model_family: "333",
  year_range_start: "2020",
  year_range_end: "2026",
  category: "loader",
  specs: { hp: 100 },
  maintenance_schedule: [{ interval_hours: "250", tasks: ["Oil"], parts: ["P-100"] }],
  fluid_capacities: { engine: { capacity: "2 gal", spec: "15w40" } },
  common_wear_parts: { filters: [{ part_number: "P-100", description: "Filter", avg_replace_hours: "250" }] },
  source_documents: ["manual.pdf", 42],
  extraction_confidence: "0.9",
  manually_verified: true,
  notes: "Verified",
  created_at: "2026-05-03T12:00:00.000Z",
  updated_at: "2026-05-03T13:00:00.000Z",
};

describe("parts companion API normalizers", () => {
  test("normalizes queue items and validates request enums", () => {
    expect(normalizeQueueItems([
      queueRow,
      { ...queueRow, id: "request-2", request_source: "bad", priority: "bad", status: "bad", items: [{ part_number: "P-101", status: "bad" }] },
      { id: "bad" },
    ])).toEqual([
      {
        id: "request-1",
        workspace_id: "default",
        requested_by: "user-1",
        assigned_to: "user-2",
        request_source: "service",
        priority: "urgent",
        status: "locating",
        customer_id: "company-1",
        customer_name: "Tigercat Logistics",
        machine_profile_id: "machine-1",
        machine_description: "333G",
        work_order_number: "WO-1",
        bay_number: "B1",
        items: [{ part_number: "P-100", description: "Filter", quantity: 2, status: "pulled", notes: "Shelf A" }],
        notes: "Need today",
        estimated_completion: "2026-05-03T15:00:00.000Z",
        auto_escalated: true,
        escalated_at: "2026-05-03T14:00:00.000Z",
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T13:00:00.000Z",
        fulfilled_at: null,
        cancelled_at: null,
        requester_name: "Requester",
        assignee_name: "Assignee",
        machine_manufacturer: "Deere",
        machine_model: "333G",
        machine_category: "loader",
        age_minutes: 30,
        priority_sort: 1,
        is_overdue: true,
      },
      {
        ...normalizeQueueItem(queueRow)!,
        id: "request-2",
        request_source: "internal",
        priority: "normal",
        status: "requested",
        items: [{ part_number: "P-101", description: null, quantity: 0, status: "pending", notes: null }],
      },
    ]);
  });

  test("normalizes request activity rows", () => {
    expect(normalizeRequestActivities([
      {
        id: "activity-1",
        request_id: "request-1",
        user_id: "user-1",
        action: "assigned",
        from_value: "old",
        to_value: "new",
        notes: "Assigned",
        metadata: { source: "test" },
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "activity-1",
        request_id: "request-1",
        user_id: "user-1",
        action: "assigned",
        from_value: "old",
        to_value: "new",
        notes: "Assigned",
        metadata: { source: "test" },
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes machine profiles and nested maintenance metadata", () => {
    expect(normalizeMachineProfiles([machineRow, { id: "bad" }])).toEqual([
      {
        id: "machine-1",
        workspace_id: "default",
        manufacturer: "Deere",
        model: "333G",
        model_family: "333",
        year_range_start: 2020,
        year_range_end: 2026,
        category: "loader",
        specs: { hp: 100 },
        maintenance_schedule: [{ interval_hours: 250, tasks: ["Oil"], parts: ["P-100"] }],
        fluid_capacities: { engine: { capacity: "2 gal", spec: "15w40" } },
        common_wear_parts: { filters: [{ part_number: "P-100", description: "Filter", avg_replace_hours: 250 }] },
        source_documents: ["manual.pdf"],
        extraction_confidence: 0.9,
        manually_verified: true,
        notes: "Verified",
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T13:00:00.000Z",
      },
    ]);

    expect(normalizeMachineProfile(null)).toBeNull();
  });

  test("normalizes counter inquiries and preferences", () => {
    expect(normalizeCounterInquiries([
      {
        id: "inquiry-1",
        user_id: "user-1",
        inquiry_type: "stock_check",
        machine_profile_id: "machine-1",
        machine_description: "333G",
        query_text: "Need filter",
        result_parts: ["P-100", 42],
        outcome: "resolved",
        duration_seconds: "12",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "inquiry-1",
        user_id: "user-1",
        inquiry_type: "stock_check",
        machine_profile_id: "machine-1",
        machine_description: "333G",
        query_text: "Need filter",
        result_parts: ["P-100"],
        outcome: "resolved",
        duration_seconds: 12,
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);

    expect(normalizePartsPreferences({
      id: "pref-1",
      user_id: "user-1",
      dark_mode: true,
      queue_panel_collapsed: true,
      default_queue_filter: "bad",
      show_fulfilled_requests: true,
      keyboard_shortcuts_enabled: true,
      sound_notifications: false,
    })).toEqual({
      id: "pref-1",
      user_id: "user-1",
      dark_mode: true,
      queue_panel_collapsed: true,
      default_queue_filter: "all",
      show_fulfilled_requests: true,
      keyboard_shortcuts_enabled: true,
      sound_notifications: false,
    });
  });

  test("returns empty companion collections for malformed inputs", () => {
    expect(normalizeQueueItems(null)).toEqual([]);
    expect(normalizeRequestActivities(undefined)).toEqual([]);
    expect(normalizeMachineProfiles({})).toEqual([]);
    expect(normalizeCounterInquiries(null)).toEqual([]);
    expect(normalizePartsPreferences({ id: "missing user" })).toBeNull();
  });
});
