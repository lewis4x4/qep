import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calculator, Database, RefreshCw } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCentsAsDollars,
  listOems,
  parseDollarInput,
  resolveOemDealerCost,
  type OemAdminRow,
  type ResolvedOemCost,
} from "../lib/oems-api";

export function OemsPage() {
  return (
    <RequireAdmin>
      <OemsPageInner />
    </RequireAdmin>
  );
}

function OemsPageInner() {
  const [oems, setOems] = useState<OemAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedOemKey, setSelectedOemKey] = useState("");
  const [listPrice, setListPrice] = useState("100000");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedCost, setResolvedCost] = useState<ResolvedOemCost | null>(null);
  const [noTierMatch, setNoTierMatch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listOems()
      .then((rows) => {
        if (cancelled) return;
        setOems(rows);
        setSelectedOemKey((current) => current || rows[0]?.oemKey || "");
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedOem = useMemo(
    () => oems.find((row) => row.oemKey === selectedOemKey) ?? null,
    [oems, selectedOemKey],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResolveError(null);
    setResolvedCost(null);
    setNoTierMatch(false);

    const listPriceCents = parseDollarInput(listPrice);
    if (!selectedOemKey) {
      setResolveError("Select an OEM before resolving dealer cost.");
      return;
    }
    if (listPriceCents === null) {
      setResolveError("Enter a valid non-negative list price.");
      return;
    }

    setResolving(true);
    try {
      const result = await resolveOemDealerCost({
        oemKey: selectedOem?.parentOemKey ?? selectedOemKey,
        brandKey: selectedOemKey,
        listPriceCents,
        effectiveOn: effectiveOn || null,
      });
      if (result) {
        setResolvedCost(result);
      } else {
        setNoTierMatch(true);
      }
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Failed to resolve dealer cost.");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/admin">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Admin home
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
              <Database className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">OEM cost resolver</h1>
              <p className="text-sm text-muted-foreground">
                Enter an OEM and list price to verify the active dealer-cost tier before importer and quote repricing work uses it.
              </p>
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/price-sheets">Open price sheets</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4" aria-hidden />
              Test calculation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {loadError}
              </div>
            ) : null}

            <form className="grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-medium">
                OEM
                <select
                  aria-label="OEM"
                  value={selectedOemKey}
                  disabled={loading || oems.length === 0}
                  onChange={(event) => setSelectedOemKey(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {loading ? <option>Loading OEMs…</option> : null}
                  {!loading && oems.length === 0 ? <option>No OEM records found</option> : null}
                  {oems.map((oem) => (
                    <option key={oem.id} value={oem.oemKey}>{oem.displayName}</option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  List price
                  <input
                    aria-label="List price"
                    inputMode="decimal"
                    value={listPrice}
                    onChange={(event) => setListPrice(event.target.value)}
                    placeholder="100000"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Effective date
                  <input
                    aria-label="Effective date"
                    type="date"
                    value={effectiveOn}
                    onChange={(event) => setEffectiveOn(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
              </div>

              {selectedOem ? (
                <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{selectedOem.displayName}</span>
                    <Badge variant="outline">{selectedOem.oemKey}</Badge>
                    {selectedOem.parentOemKey ? <Badge variant="secondary">Parent {selectedOem.parentOemKey}</Badge> : null}
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    Source {selectedOem.sourceFormat} · Cadence {selectedOem.priceSheetCadence}
                  </p>
                </div>
              ) : null}

              {resolveError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {resolveError}
                </div>
              ) : null}

              <Button type="submit" disabled={loading || resolving || oems.length === 0}>
                {resolving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Resolve dealer cost
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolved tier</CardTitle>
          </CardHeader>
          <CardContent>
            {resolvedCost ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Dealer cost</p>
                  <p className="text-3xl font-black">{formatCentsAsDollars(resolvedCost.dealerCostCents)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground">Discount</p>
                    <p className="font-semibold">{resolvedCost.discountOffListPct.toFixed(2)}%</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground">Brand tier</p>
                    <p className="font-semibold uppercase">{resolvedCost.brandKey}</p>
                  </div>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Parent OEM</dt>
                    <dd className="font-medium uppercase">{resolvedCost.parentOemKey}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Effective</dt>
                    <dd className="font-medium">{resolvedCost.effectiveFrom}{resolvedCost.effectiveTo ? ` → ${resolvedCost.effectiveTo}` : " → current"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="max-w-[180px] truncate font-medium">{resolvedCost.sourceReference ?? "—"}</dd>
                  </div>
                </dl>
              </div>
            ) : noTierMatch ? (
              <p className="text-sm text-muted-foreground">
                No dealer-cost tier matched that OEM, brand, and effective date.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run a calculation to confirm the resolver path, discount tier, and dealer cost.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
