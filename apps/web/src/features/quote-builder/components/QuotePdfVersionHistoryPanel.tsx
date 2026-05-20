import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileClock, GitCompareArrows, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  diffQuotePdfVersions,
  listQuotePdfVersions,
  type QuotePdfVersionListItem,
} from "../lib/quote-api";
import type {
  QuotePdfVersionDiff,
  QuotePdfVersionFinanceSnapshot,
  QuotePdfVersionLineSnapshot,
  QuotePdfVersionTermsSnapshot,
  QuotePdfVersionTotalsSnapshot,
} from "../../../../../../shared/qep-moonshot-contracts";

interface QuotePdfVersionHistoryPanelProps {
  quotePackageId: string;
  listVersions?: typeof listQuotePdfVersions;
  diffVersions?: typeof diffQuotePdfVersions;
}

const totalLabels: Record<keyof QuotePdfVersionTotalsSnapshot, string> = {
  equipmentTotal: "Equipment total",
  attachmentTotal: "Attachment total",
  pricingLineTotal: "Pricing lines",
  subtotal: "Subtotal",
  discountTotal: "Discount",
  tradeAllowance: "Trade allowance",
  taxTotal: "Tax",
  customerTotal: "Customer total",
  cashDown: "Cash down",
  amountFinanced: "Amount financed",
  netTotal: "Net total",
};

const termLabels: Record<keyof QuotePdfVersionTermsSnapshot, string> = {
  validUntil: "Valid until",
  deliveryEta: "Delivery ETA",
  depositRequiredAmount: "Deposit required",
  specialTerms: "Special terms",
  taxLabel: "Tax label",
  taxDetail: "Tax detail",
};

const lineFieldLabels: Record<keyof QuotePdfVersionLineSnapshot, string> = {
  diffKey: "Line key",
  lineType: "Type",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  extendedPrice: "Extended price",
  displayAmount: "Displayed amount",
  tone: "Tone",
};

const financeFieldLabels: Record<keyof QuotePdfVersionFinanceSnapshot, string> = {
  type: "Type",
  kind: "Kind",
  label: "Label",
  termMonths: "Term",
  rate: "Rate",
  monthlyPayment: "Monthly payment",
  totalCost: "Total cost",
  lender: "Lender",
  downPayment: "Down payment",
  residualAmount: "Residual",
  isDefault: "Default",
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return moneyFormatter.format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

function formatScalar(value: string | number | boolean | null | undefined, field?: string): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    if (field && /(price|total|amount|payment|down|residual|deposit|allowance|financed)/i.test(field)) {
      return formatMoney(value);
    }
    if (field === "rate") return `${value}%`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

function versionLabel(versionNumber: number | null | undefined): string {
  return versionNumber == null ? "Unversioned" : `v${versionNumber}`;
}

function sortedVersionNumbers(versions: QuotePdfVersionListItem[]): number[] {
  return versions
    .map((version) => version.versionNumber)
    .filter((versionNumber): versionNumber is number => typeof versionNumber === "number")
    .sort((a, b) => b - a);
}

function VersionSummaryCard({ version }: { version: QuotePdfVersionListItem }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{versionLabel(version.versionNumber)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Sent {formatDate(version.customerVisibleAt)}</p>
        </div>
        <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
          {formatMoney(version.totalsSummary?.customerTotal)}
        </span>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>Recipient: {version.recipient ?? "—"}</span>
        <span>Generated: {formatDate(version.generatedAt)}</span>
        <span>Size: {formatBytes(version.sizeBytes)}</span>
        <span>SHA: {shortHash(version.contentSha256)}</span>
      </div>
    </div>
  );
}

function DiffBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
      status === "added" && "bg-emerald-500/10 text-emerald-300",
      status === "removed" && "bg-rose-500/10 text-rose-300",
      status === "changed" && "bg-amber-500/10 text-amber-300",
      status === "unchanged" && "bg-muted text-muted-foreground",
    )}>
      {status}
    </span>
  );
}

function DiffRows({ diff }: { diff: QuotePdfVersionDiff }) {
  const hasDiffs = diff.lineDiffs.length > 0
    || diff.totalDiffs.length > 0
    || diff.financingDiffs.length > 0
    || diff.termDiffs.length > 0
    || diff.narrativeChanged;

  if (!hasDiffs) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
        No customer-visible differences were found between these sent PDF versions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Line item changes</p>
        {diff.lineDiffs.length > 0 ? (
          <div className="space-y-2">
            {diff.lineDiffs.map((line) => {
              const fields = line.changedFields.length > 0 ? line.changedFields : ["displayAmount"];
              const beforeLine = line.before;
              const afterLine = line.after;
              const displayLine = afterLine ?? beforeLine;
              return (
                <div key={`${line.diffKey}-${line.status}`} className="rounded-lg border border-border/60 bg-background/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{displayLine?.description ?? line.diffKey}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{displayLine?.lineType ?? "line"}</p>
                    </div>
                    <DiffBadge status={line.status} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs">
                    {fields.map((field) => {
                      const key = field as keyof QuotePdfVersionLineSnapshot;
                      return (
                        <div key={field} className="grid gap-2 rounded border border-border/50 bg-card/40 px-2 py-1 sm:grid-cols-[140px_1fr_1fr]">
                          <span className="font-medium text-muted-foreground">{lineFieldLabels[key] ?? field}</span>
                          <span className="text-rose-200">Before: {formatScalar(beforeLine?.[key] as string | number | null | undefined, field)}</span>
                          <span className="text-emerald-200">After: {formatScalar(afterLine?.[key] as string | number | null | undefined, field)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No line item changes.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Totals</p>
        {diff.totalDiffs.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {diff.totalDiffs.map((total) => (
              <div key={String(total.field)} className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm">
                <p className="font-medium text-foreground">{totalLabels[total.field] ?? total.field}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMoney(total.before)} → <span className="text-emerald-300">{formatMoney(total.after)}</span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No total changes.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Financing</p>
        {diff.financingDiffs.length > 0 ? (
          <div className="space-y-2">
            {diff.financingDiffs.map((finance) => (
              <div key={`${finance.label}-${finance.status}`} className="rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{finance.label}</p>
                  <DiffBadge status={finance.status} />
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {(finance.changedFields.length > 0 ? finance.changedFields : ["monthlyPayment"]).map((field) => {
                    const key = field as keyof QuotePdfVersionFinanceSnapshot;
                    return (
                      <div key={field} className="grid gap-2 rounded border border-border/50 bg-card/40 px-2 py-1 sm:grid-cols-[140px_1fr_1fr]">
                        <span className="font-medium text-muted-foreground">{financeFieldLabels[key] ?? field}</span>
                        <span className="text-rose-200">Before: {formatScalar(finance.before?.[key] as string | number | boolean | null | undefined, field)}</span>
                        <span className="text-emerald-200">After: {formatScalar(finance.after?.[key] as string | number | boolean | null | undefined, field)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No financing changes.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Terms & narrative</p>
        {diff.termDiffs.length > 0 || diff.narrativeChanged ? (
          <div className="space-y-2">
            {diff.termDiffs.map((term) => (
              <div key={String(term.field)} className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm">
                <p className="font-medium text-foreground">{termLabels[term.field] ?? term.field}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatScalar(term.before, String(term.field))} → <span className="text-emerald-300">{formatScalar(term.after, String(term.field))}</span>
                </p>
              </div>
            ))}
            {diff.narrativeChanged && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
                Customer-facing narrative text changed between these PDF versions.
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No terms or narrative changes.</p>
        )}
      </section>
    </div>
  );
}

export function QuotePdfVersionHistoryPanel({
  quotePackageId,
  listVersions = listQuotePdfVersions,
  diffVersions = diffQuotePdfVersions,
}: QuotePdfVersionHistoryPanelProps) {
  const [fromVersionNumber, setFromVersionNumber] = useState<number | null>(null);
  const [toVersionNumber, setToVersionNumber] = useState<number | null>(null);

  const versionsQuery = useQuery({
    queryKey: ["quote-builder", "quote-pdf-versions", quotePackageId],
    queryFn: () => listVersions(quotePackageId),
    enabled: Boolean(quotePackageId),
    staleTime: 10_000,
  });

  const versions = useMemo(() => {
    return [...(versionsQuery.data?.versions ?? [])].sort((a, b) => {
      const byVersion = (b.versionNumber ?? -1) - (a.versionNumber ?? -1);
      if (byVersion !== 0) return byVersion;
      return new Date(b.customerVisibleAt ?? b.generatedAt ?? 0).getTime()
        - new Date(a.customerVisibleAt ?? a.generatedAt ?? 0).getTime();
    });
  }, [versionsQuery.data?.versions]);
  const selectableVersionNumbers = useMemo(() => sortedVersionNumbers(versions), [versions]);

  useEffect(() => {
    if (selectableVersionNumbers.length < 2) return;
    const [newest, previous] = selectableVersionNumbers;
    const currentSelectionStillValid = toVersionNumber != null
      && fromVersionNumber != null
      && selectableVersionNumbers.includes(toVersionNumber)
      && selectableVersionNumbers.includes(fromVersionNumber)
      && toVersionNumber !== fromVersionNumber;
    if (!currentSelectionStillValid) {
      setToVersionNumber(newest);
      setFromVersionNumber(previous);
    }
  }, [fromVersionNumber, selectableVersionNumbers, toVersionNumber]);

  const diffQuery = useQuery({
    queryKey: ["quote-builder", "quote-pdf-version-diff", quotePackageId, fromVersionNumber, toVersionNumber],
    queryFn: () => diffVersions({
      quotePackageId,
      fromVersionNumber: fromVersionNumber!,
      toVersionNumber: toVersionNumber!,
    }),
    enabled: Boolean(quotePackageId && fromVersionNumber != null && toVersionNumber != null && fromVersionNumber !== toVersionNumber),
    staleTime: 10_000,
  });

  return (
    <Card className="border-border/60 bg-card/60 p-4 space-y-4" data-testid="quote-pdf-version-history-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileClock className="h-4 w-4 text-qep-orange" />
            <p className="text-sm font-medium text-foreground">Sent PDF Version History</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every email send creates an immutable PDF artifact. Compare what changed between sent customer copies.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => versionsQuery.refetch()}
          disabled={versionsQuery.isFetching}
        >
          {versionsQuery.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {versionsQuery.isLoading ? (
        <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
          Loading sent PDF versions…
        </div>
      ) : versionsQuery.isError ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
          {versionsQuery.error instanceof Error ? versionsQuery.error.message : "Failed to load sent PDF versions."}
        </div>
      ) : versions.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
          No versioned PDF sends yet. The next email send will create v1.
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {versions.slice(0, 4).map((version) => (
              <VersionSummaryCard key={version.artifactId} version={version} />
            ))}
          </div>

          {selectableVersionNumbers.length < 2 ? (
            <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
              Send at least two PDF versions to unlock line-by-line diffs.
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Previous version
                  <select
                    value={fromVersionNumber ?? ""}
                    onChange={(event) => setFromVersionNumber(Number(event.target.value))}
                    className="block rounded border border-input bg-card px-3 py-2 text-sm text-foreground"
                  >
                    {selectableVersionNumbers.map((versionNumber) => (
                      <option key={`from-${versionNumber}`} value={versionNumber}>{versionLabel(versionNumber)}</option>
                    ))}
                  </select>
                </label>
                <GitCompareArrows className="mb-2 h-4 w-4 text-muted-foreground" />
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Newer version
                  <select
                    value={toVersionNumber ?? ""}
                    onChange={(event) => setToVersionNumber(Number(event.target.value))}
                    className="block rounded border border-input bg-card px-3 py-2 text-sm text-foreground"
                  >
                    {selectableVersionNumbers.map((versionNumber) => (
                      <option key={`to-${versionNumber}`} value={versionNumber}>{versionLabel(versionNumber)}</option>
                    ))}
                  </select>
                </label>
              </div>

              {fromVersionNumber === toVersionNumber ? (
                <p className="text-sm text-amber-300">Choose two different versions to compare.</p>
              ) : diffQuery.isLoading || diffQuery.isFetching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading PDF version diff…
                </div>
              ) : diffQuery.isError ? (
                <p className="text-sm text-rose-300">
                  {diffQuery.error instanceof Error ? diffQuery.error.message : "Failed to load PDF version diff."}
                </p>
              ) : diffQuery.data?.diff ? (
                <DiffRows diff={diffQuery.data.diff} />
              ) : (
                <p className="text-sm text-muted-foreground">No diff is available for the selected sent PDF versions.</p>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
