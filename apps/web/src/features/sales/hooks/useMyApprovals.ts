/**
 * useMyApprovals — list the current rep's submitted quote approval cases.
 *
 * Powers the dedicated /sales/my-approvals page and the Pipeline page's
 * "X quotes awaiting approval" banner. Lets a rep see every quote they
 * submitted for manager review at a glance, with status, decision notes,
 * and a tap-through to the underlying Quote Builder.
 *
 * Data shape:
 *   quote_approval_cases (filtered by submitted_by = auth.uid)
 *     ↳ quote_packages (embedded; quote_number, customer_name, net_total, margin_pct)
 *     ↳ quote_approval_case_conditions (embedded list)
 *
 * Note on schema:
 *   - quote_approval_cases does NOT have a `submitted_at` column. The case
 *     row is created at submission time, so `created_at` IS the submission
 *     timestamp. We expose it as `submitted_at` in the hook return so the
 *     UI doesn't need to know.
 *   - quote_packages has `net_total` (not `total_amount`). We expose it as
 *     `total_amount` in the return for UI clarity.
 *   - Names are denormalized onto the case row (`submitted_by_name`,
 *     `assigned_to_name`, `decided_by_name`) — no profile join required.
 *
 * Zero-blocking: if the query fails or the user is unauthenticated, the
 * hook returns empty arrays/zero counts. The UI degrades to the empty
 * state and the banner self-hides.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type MyApprovalStatus =
  | "pending"
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "rejected"
  | "escalated"
  | "cancelled"
  | "superseded"
  | "expired";

export interface MyApprovalCondition {
  condition_type: string;
  condition_payload_json: Record<string, unknown> | null;
}

export interface MyApprovalRow {
  id: string;
  status: MyApprovalStatus;
  /** Alias of `created_at`. There is no `submitted_at` column on the table;
   *  the case row is inserted at submission time. */
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  submission_note: string | null;
  route_mode: string | null;
  assigned_role: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  quote_package_id: string;
  /** quote_packages.net_total exposed as `total_amount` for UI clarity. */
  total_amount: number | null;
  margin_pct: number | null;
  quote_number: string | null;
  customer_name: string | null;
  customer_company: string | null;
  conditions: MyApprovalCondition[];
}

const PENDING_STATUSES = new Set<MyApprovalStatus>(["pending", "escalated"]);
const DECIDED_STATUSES = new Set<MyApprovalStatus>([
  "approved",
  "approved_with_conditions",
  "rejected",
]);

const QUERY_KEY = ["sales", "my-approvals"] as const;
const FETCH_LIMIT = 50;
const STALE_MS = 30_000;
const REFETCH_MS = 60_000;

interface RawApprovalRow {
  id: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  submission_note: string | null;
  route_mode: string | null;
  assigned_role: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  quote_package_id: string;
  // PostgREST embed: with !inner on a to-one FK, this is a single object,
  // not an array. We normalize defensively.
  quote_packages:
    | {
        quote_number: string | null;
        customer_name: string | null;
        customer_company: string | null;
        net_total: number | null;
        margin_pct: number | null;
      }
    | Array<{
        quote_number: string | null;
        customer_name: string | null;
        customer_company: string | null;
        net_total: number | null;
        margin_pct: number | null;
      }>
    | null;
  quote_approval_case_conditions:
    | Array<{
        condition_type: string;
        condition_payload_json: Record<string, unknown> | null;
      }>
    | null;
}

async function fetchMyApprovals(): Promise<MyApprovalRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("quote_approval_cases")
    .select(
      `
      id,
      status,
      created_at,
      decided_at,
      decided_by,
      decided_by_name,
      decision_note,
      submission_note,
      route_mode,
      assigned_role,
      assigned_to,
      assigned_to_name,
      quote_package_id,
      quote_packages!inner(quote_number, customer_name, customer_company, net_total, margin_pct),
      quote_approval_case_conditions(condition_type, condition_payload_json)
    `,
    )
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) throw error;

  const rows = (data ?? []) as unknown as RawApprovalRow[];

  return rows.map((row) => {
    const pkg = Array.isArray(row.quote_packages)
      ? (row.quote_packages[0] ?? null)
      : row.quote_packages;
    return {
      id: row.id,
      status: row.status as MyApprovalStatus,
      submitted_at: row.created_at,
      decided_at: row.decided_at,
      decided_by: row.decided_by,
      decided_by_name: row.decided_by_name,
      decision_note: row.decision_note,
      submission_note: row.submission_note,
      route_mode: row.route_mode,
      assigned_role: row.assigned_role,
      assigned_to: row.assigned_to,
      assigned_to_name: row.assigned_to_name,
      quote_package_id: row.quote_package_id,
      total_amount: pkg?.net_total ?? null,
      margin_pct: pkg?.margin_pct ?? null,
      quote_number: pkg?.quote_number ?? null,
      customer_name: pkg?.customer_name ?? null,
      customer_company: pkg?.customer_company ?? null,
      conditions: (row.quote_approval_case_conditions ?? []).map((c) => ({
        condition_type: c.condition_type,
        condition_payload_json: c.condition_payload_json,
      })),
    };
  });
}

export function useMyApprovals() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMyApprovals,
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    // Silent degrade: on failure we render the empty state, not an error wall.
    retry: 1,
  });

  const approvals: MyApprovalRow[] = query.data ?? [];

  const { pendingCount, decidedCount, changesRequestedCount } = useMemo(() => {
    let pending = 0;
    let decided = 0;
    let changes = 0;
    for (const a of approvals) {
      if (PENDING_STATUSES.has(a.status)) pending += 1;
      else if (DECIDED_STATUSES.has(a.status)) decided += 1;
      else if (a.status === "changes_requested") changes += 1;
    }
    return {
      pendingCount: pending,
      decidedCount: decided,
      changesRequestedCount: changes,
    };
  }, [approvals]);

  return {
    approvals,
    pendingCount,
    decidedCount,
    changesRequestedCount,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
