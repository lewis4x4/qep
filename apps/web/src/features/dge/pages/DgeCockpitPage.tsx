import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Search, DollarSign, Compass } from "lucide-react";
import { CustomerInsightCard } from "../components/CustomerInsightCard";
import { MarketValuationCard } from "../components/MarketValuationCard";
import { PredictiveVisitList } from "../components/PredictiveVisitList";
import { DgeScenarioPanel } from "../components/DgeScenarioPanel";
import { fetchCustomerProfile, fetchMarketValuation } from "../lib/dge-api";
import type { CustomerProfileResponse, MarketValuationResult } from "../types";

interface DgeCockpitPageProps {
  userId: string;
}

/**
 * Unified Deal Genome Engine cockpit — stitches together the existing
 * customer DNA lookup, market valuation, predictive visit list, and deal
 * scenario generator into a single surface for sales reps and managers.
 */
export function DgeCockpitPage({ userId }: DgeCockpitPageProps) {
  // Customer lookup state
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerData, setCustomerData] = useState<CustomerProfileResponse | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  // Valuation form state
  const [valForm, setValForm] = useState({ make: "", model: "", year: "", hours: "", condition: "good" });
  const [valuationData, setValuationData] = useState<MarketValuationResult | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  // Deal scenario state
  const [scenarioDealId, setScenarioDealId] = useState("");
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  async function runCustomerLookup() {
    const email = customerEmail.trim();
    if (!email) return;
    setCustomerLoading(true);
    setCustomerError(null);
    try {
      const data = await fetchCustomerProfile({ email, includeFleet: true });
      setCustomerData(data);
      if (!data) setCustomerError("No DNA profile found for that email.");
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : "Lookup failed");
      setCustomerData(null);
    } finally {
      setCustomerLoading(false);
    }
  }

  async function runValuation() {
    const { make, model, year, hours, condition } = valForm;
    if (!make.trim() || !model.trim() || !year || !hours) {
      setValuationError("Make, model, year, and hours are required.");
      return;
    }
    setValuationLoading(true);
    setValuationError(null);
    try {
      const data = await fetchMarketValuation({
        make: make.trim(),
        model: model.trim(),
        year: parseInt(year, 10),
        hours: parseInt(hours, 10),
        condition,
      });
      setValuationData(data);
    } catch (err) {
      setValuationError(err instanceof Error ? err.message : "Valuation failed");
      setValuationData(null);
    } finally {
      setValuationLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-qep-orange/10 p-2">
          <Brain className="h-5 w-5 text-qep-orange" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Deal Genome Engine — Cockpit</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Unified sales intelligence surface: customer DNA, market valuation, predictive visits, and deal scenarios.
          </p>
        </div>
      </div>

      {/* Row 1: Customer DNA + Market Valuation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Customer lookup */}
        <div className="space-y-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer lookup</h2>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@example.com"
                onKeyDown={(e) => e.key === "Enter" && runCustomerLookup()}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <Button size="sm" onClick={runCustomerLookup} disabled={customerLoading || !customerEmail.trim()}>
                {customerLoading ? "Loading…" : "Look up"}
              </Button>
            </div>
          </Card>
          <CustomerInsightCard
            data={customerData}
            loading={customerLoading}
            error={customerError}
            onRefresh={runCustomerLookup}
          />
        </div>

        {/* Market valuation */}
        <div className="space-y-3">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valuation inputs</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={valForm.make}
                onChange={(e) => setValForm((f) => ({ ...f, make: e.target.value }))}
                placeholder="Make (e.g. Develon)"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                value={valForm.model}
                onChange={(e) => setValForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="Model (e.g. DX225LC-7)"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                value={valForm.year}
                onChange={(e) => setValForm((f) => ({ ...f, year: e.target.value }))}
                placeholder="Year"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                value={valForm.hours}
                onChange={(e) => setValForm((f) => ({ ...f, hours: e.target.value }))}
                placeholder="Hours"
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
              <select
                value={valForm.condition}
                onChange={(e) => setValForm((f) => ({ ...f, condition: e.target.value }))}
                className="col-span-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <Button size="sm" className="mt-2 w-full" onClick={runValuation} disabled={valuationLoading}>
              {valuationLoading ? "Valuing…" : "Run valuation"}
            </Button>
          </Card>
          <MarketValuationCard
            data={valuationData}
            loading={valuationLoading}
            error={valuationError}
            onRefresh={runValuation}
          />
        </div>
      </div>

      {/* Row 2: Predictive visits */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Compass className="h-4 w-4 text-qep-orange" aria-hidden />
          <h2 className="text-sm font-bold text-foreground">My predictive visit list</h2>
        </div>
        <PredictiveVisitList userId={userId} />
      </div>

      {/* Row 3: Deal scenario */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-4 w-4 text-qep-orange" aria-hidden />
          <h2 className="text-sm font-bold text-foreground">Deal scenarios</h2>
        </div>
        <Card className="p-3 mb-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={scenarioDealId}
              onChange={(e) => setScenarioDealId(e.target.value)}
              placeholder="Paste a QRM deal UUID"
              className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs"
            />
            <Button
              size="sm"
              onClick={() => setActiveDealId(scenarioDealId.trim() || null)}
              disabled={!scenarioDealId.trim()}
            >
              Load scenarios
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Tip: open any deal from the QRM pipeline and copy its URL ID.
          </p>
        </Card>
        {activeDealId && <DgeScenarioPanel dealId={activeDealId} />}
      </div>
    </div>
  );
}
