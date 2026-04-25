/**
 * QRM Moonshot Command Center — page entry.
 *
 * Canonical QRM command center served at `/qrm`.
 * The legacy QRM hub has been retired from the live route.
 */

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  ShieldAlert,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import type { UserRole } from "@/lib/database.types";
import { canUseElevatedQrmScopes } from "@/lib/home-route";
import { isIronRole, resolveIronRoleAndBlend } from "../../lib/iron-roles";
import { useIronRoleBlend } from "../../lib/useIronRoleBlend";
import type {
  CommandCenterScope,
  IronRole,
  RecommendationCardPayload,
} from "../api/commandCenter.types";
import { useCommandCenter } from "../hooks/useCommandCenter";
import { getRoleHeadline } from "../lib/roleVariant";
import { RoleVariantShell } from "./RoleVariantShell";

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

interface QrmCommandCenterPageProps {
  userRole: UserRole;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  ironRoleFromProfile?: string | null;
}

export function QrmCommandCenterPage({
  userRole,
  userId,
  ironRoleFromProfile,
}: QrmCommandCenterPageProps) {
  // Phase 0 P0.5 — load blend; falls through to legacy single-role on empty.
  // Single-pass: resolveIronRoleAndBlend parses the blend rows once and
  // returns both the dominant role info AND the parsed blend, instead of
  // calling getIronRoleBlend + getEffectiveIronRole separately (which would
  // re-parse the rows twice per render).
  const { blend: blendRows } = useIronRoleBlend(userId);
  const { info: ironRoleInfo, blend } = resolveIronRoleAndBlend(
    userRole,
    blendRows,
    ironRoleFromProfile,
  );
  const ironRole: IronRole = isIronRole(ironRoleInfo.role) ? ironRoleInfo.role : "iron_advisor";
  const elevatedViewer = canUseElevatedQrmScopes(userRole, ironRole);
  // P0.5 W1-2 — when the operator holds a non-trivial blend, render the
  // dominant weight as a percentage on the role badge so the user can see
  // the implicit "60%" alongside the "Also covering: 40%" entries shown
  // by RoleVariantShell. Single-role users (blend.length <= 1) get the
  // unadorned badge — adding a "100%" chip would just be noise.
  const dominantWeightLabel = blend.length > 1
    ? ` · ${Math.round(blend[0].weight * 100)}%`
    : "";
  const headline = getRoleHeadline(ironRole);
  const [scope, setScope] = useState<CommandCenterScope>(
    elevatedViewer ? "team" : "mine",
  );

  const query = useCommandCenter(scope);

  const commandStrip = query.data?.commandStrip;
  const aiChiefOfStaff = query.data?.aiChiefOfStaff;
  const recommendationCount = query.data
    ? query.data.actionLanes.revenueReady.length + query.data.actionLanes.revenueAtRisk.length + query.data.actionLanes.blockers.length
    : 0;

  const blockedDeals = commandStrip?.blockedDeals ?? 0;
  const overdueFollowUps = commandStrip?.overdueFollowUps ?? 0;
  const atRiskRevenue = commandStrip?.atRiskRevenue ?? 0;

  const whatMattersHeadline = query.isLoading
    ? "Command-center pressure is loading."
    : commandStrip
      ? atRiskRevenue > 0
        ? `${formatCurrency(atRiskRevenue)} at risk across ${overdueFollowUps} overdue follow-up${overdueFollowUps === 1 ? "" : "s"} and ${recommendationCount} guided move${recommendationCount === 1 ? "" : "s"}.`
        : `${blockedDeals} blocked deal${blockedDeals === 1 ? "" : "s"}, ${overdueFollowUps} overdue follow-up${overdueFollowUps === 1 ? "" : "s"}, and ${recommendationCount} guided move${recommendationCount === 1 ? "" : "s"} are in play.`
      : "Command-center summary is not available yet.";
  const whatMattersBullets = commandStrip
    ? [
        overdueFollowUps > 0
          ? `${overdueFollowUps} follow-up${overdueFollowUps === 1 ? " is" : "s are"} overdue${atRiskRevenue > 0 ? ` with ${formatCurrency(atRiskRevenue)} in at-risk exposure` : ""}`
          : null,
        recommendationCount > 0
          ? `${recommendationCount} guided move${recommendationCount === 1 ? " is" : "s are"} unlocked to close or de-risk deals`
          : null,
        blockedDeals > 0
          ? `${blockedDeals} blocked deal${blockedDeals === 1 ? "" : "s"} — clear before scanning lower priorities`
          : "0 blocked deals — keep the pipeline moving",
      ].filter((bullet): bullet is string => Boolean(bullet))
    : [];

  const nextMoveHeadline = query.isLoading
    ? "Preparing the next move."
    : aiChiefOfStaff?.bestMove
      ? aiChiefOfStaff.bestMove.headline
      : blockedDeals > 0
        ? `Clear ${blockedDeals} blocked deal${blockedDeals === 1 ? "" : "s"} before scanning lower-priority work.`
        : "Use this pass to confirm the board is quiet and keep the next action lane clean.";
  const nextMoveDetail =
    aiChiefOfStaff?.bestMove?.rationale?.[0] ?? null;

  const riskIfIgnored =
    commandStrip && (blockedDeals > 0 || overdueFollowUps > 0 || atRiskRevenue > 0)
      ? "If this page becomes a dashboard instead of a command lane, urgent work will hide in plain sight."
      : "Without a clear top brief, operators spend time scanning instead of deciding.";

  const handleAccept = useCallback((card: RecommendationCardPayload) => {
    // Phase 0 P0.8 — log trace_id for telemetry. Full event emission in Phase 2.
    if (card.traceId) {
      console.info("[QRM] recommendation accepted", { traceId: card.traceId, entityId: card.entityId });
    }
  }, []);

  const handleDismiss = useCallback((card: RecommendationCardPayload) => {
    // Phase 0 P0.8 — log trace_id for telemetry. Full event emission in Phase 2.
    if (card.traceId) {
      console.info("[QRM] recommendation dismissed", { traceId: card.traceId, entityId: card.entityId });
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-4 sm:px-6 lg:px-8 min-h-full">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="text-4xl sm:text-5xl font-display font-medium tracking-tight text-white mb-2">{headline.title}</h1>
          <p className="text-lg font-light text-slate-400">{headline.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-qep-orange bg-qep-orange/10 px-3 py-1 rounded-full">
            {ironRoleInfo.display}
            {dominantWeightLabel}
          </span>
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 bg-white/5 px-3 py-1 rounded-full">
            Slice 1 · spine
          </span>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <article className="flex gap-3 rounded-2xl border border-[#f28a07]/35 bg-[#f28a07]/10 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f28a07] text-[#15100a]">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
              What matters now
            </p>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-white">
              {whatMattersHeadline}
            </p>
            {whatMattersBullets.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[12px] text-slate-300">
                {whatMattersBullets.map((bullet, idx) => (
                  <li key={idx} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-emerald-400">✓</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>

        <article className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25 text-[#f6a53a]">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Next move
            </p>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-white">
              {nextMoveHeadline}
            </p>
            {nextMoveDetail ? (
              <p className="mt-1.5 text-[12px] leading-snug text-slate-400">
                {nextMoveDetail}
              </p>
            ) : null}
          </div>
        </article>

        <article className="flex gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-300">
              Risk if ignored
            </p>
            <p className="mt-1.5 text-sm leading-snug text-slate-200">{riskIfIgnored}</p>
          </div>
        </article>
      </div>

      {query.isLoading && (
        <GlassPanel className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading QRM Command Center...
        </GlassPanel>
      )}

      {query.isError && (
        <GlassPanel className="flex flex-col items-center gap-3 border-red-500/40 bg-red-500/[0.02] py-20 text-sm text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-lg font-light">Could not load Command Center</p>
          <p className="text-xs text-red-400/80 mb-4">
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()} className="rounded-full border-red-500/20 hover:bg-red-500/10">
            Retry
          </Button>
        </GlassPanel>
      )}

      {query.data && (
        <RoleVariantShell
          data={query.data}
          scope={scope}
          ironRole={ironRole}
          isElevatedViewer={elevatedViewer}
          blend={blend}
          onScopeChange={setScope}
          onAccept={handleAccept}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}

export default QrmCommandCenterPage;
