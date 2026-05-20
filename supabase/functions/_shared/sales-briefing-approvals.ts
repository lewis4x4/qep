export interface RepStuckApproval {
  quote_package_id: string;
  quote_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  submitted_at: string;
  hours_pending: number;
  assigned_role: string | null;
}

export interface ManagerPendingApproval {
  approval_case_id: string;
  quote_package_id: string;
  quote_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  margin_pct: number | null;
  submitted_at: string;
  submitted_by_name: string | null;
  hours_pending: number;
}

export interface PendingApprovals {
  rep_stuck: RepStuckApproval[];
  manager_pending: ManagerPendingApproval[];
  manager_pending_count: number;
}

const REP_STUCK_THRESHOLD_HOURS = 4;
const REP_STUCK_LIMIT = 5;
const MANAGER_PENDING_LIMIT = 3;
const MANAGER_ROLES = new Set(["manager", "owner", "admin"]);

function hoursBetween(fromIso: string, now: number): number {
  const ts = new Date(fromIso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((now - ts) / 3_600_000));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value != null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function gatherPendingApprovals(
  db: { from: (table: string) => any },
  userId: string,
  role: string | null,
  workspaceId: string | null,
  logPrefix = "[sales-briefing]",
): Promise<PendingApprovals> {
  const now = Date.now();
  const isManager = role != null && MANAGER_ROLES.has(role);

  let repStuck: RepStuckApproval[] = [];
  try {
    const { data, error } = await db
      .from("quote_approval_cases")
      .select(
        "id, quote_package_id, quote_number, customer_name, customer_company, net_total, created_at, assigned_role, status",
      )
      .eq("submitted_by", userId)
      .in("status", ["pending", "escalated"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error(`${logPrefix} rep_stuck query failed:`, error);
    } else {
      repStuck = ((data ?? []) as Record<string, unknown>[])
        .map((row: Record<string, unknown>): RepStuckApproval | null => {
          const submittedAt = typeof row.created_at === "string" ? row.created_at : null;
          if (!submittedAt) return null;
          const hours = hoursBetween(submittedAt, now);
          if (hours < REP_STUCK_THRESHOLD_HOURS) return null;
          const quotePackageId = typeof row.quote_package_id === "string" ? row.quote_package_id : null;
          if (!quotePackageId) return null;
          return {
            quote_package_id: quotePackageId,
            quote_number: typeof row.quote_number === "string" ? row.quote_number : null,
            customer_name:
              (typeof row.customer_name === "string" && row.customer_name) ||
              (typeof row.customer_company === "string" && row.customer_company) ||
              null,
            total_amount: numberOrNull(row.net_total),
            submitted_at: submittedAt,
            hours_pending: hours,
            assigned_role: typeof row.assigned_role === "string" ? row.assigned_role : null,
          } as RepStuckApproval;
        })
        .filter((row: RepStuckApproval | null): row is RepStuckApproval => row !== null)
        .slice(0, REP_STUCK_LIMIT);
    }
  } catch (err) {
    console.error(`${logPrefix} rep_stuck threw:`, err);
    repStuck = [];
  }

  let managerPending: ManagerPendingApproval[] = [];
  let managerPendingCount = 0;
  if (isManager) {
    try {
      const orFilter = workspaceId
        ? `assigned_to.eq.${userId},and(assigned_role.eq.${role},workspace_id.eq.${workspaceId})`
        : `assigned_to.eq.${userId},assigned_role.eq.${role}`;

      const { data, error, count } = await db
        .from("quote_approval_cases")
        .select(
          "id, quote_package_id, quote_number, customer_name, customer_company, net_total, margin_pct, created_at, submitted_by_name, status",
          { count: "exact" },
        )
        .or(orFilter)
        .in("status", ["pending", "escalated"])
        .order("created_at", { ascending: true });

      if (error) {
        console.error(`${logPrefix} manager_pending query failed:`, error);
      } else {
        managerPendingCount = typeof count === "number" ? count : (data ?? []).length;
        managerPending = ((data ?? []) as Record<string, unknown>[])
          .slice(0, MANAGER_PENDING_LIMIT)
          .map((row: Record<string, unknown>): ManagerPendingApproval | null => {
            const submittedAt = typeof row.created_at === "string" ? row.created_at : null;
            const quotePackageId = typeof row.quote_package_id === "string" ? row.quote_package_id : null;
            const caseId = typeof row.id === "string" ? row.id : null;
            if (!submittedAt || !quotePackageId || !caseId) return null;
            return {
              approval_case_id: caseId,
              quote_package_id: quotePackageId,
              quote_number: typeof row.quote_number === "string" ? row.quote_number : null,
              customer_name:
                (typeof row.customer_name === "string" && row.customer_name) ||
                (typeof row.customer_company === "string" && row.customer_company) ||
                null,
              total_amount: numberOrNull(row.net_total),
              margin_pct: numberOrNull(row.margin_pct),
              submitted_at: submittedAt,
              submitted_by_name:
                typeof row.submitted_by_name === "string" ? row.submitted_by_name : null,
              hours_pending: hoursBetween(submittedAt, now),
            } as ManagerPendingApproval;
          })
          .filter((row: ManagerPendingApproval | null): row is ManagerPendingApproval => row !== null);
      }
    } catch (err) {
      console.error(`${logPrefix} manager_pending threw:`, err);
      managerPending = [];
      managerPendingCount = 0;
    }
  }

  return {
    rep_stuck: repStuck,
    manager_pending: managerPending,
    manager_pending_count: managerPendingCount,
  };
}
