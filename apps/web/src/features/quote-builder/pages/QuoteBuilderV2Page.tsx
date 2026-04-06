import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MessageSquare, FileText, ArrowRight, ArrowLeft, Save, MapPin } from "lucide-react";
import { EquipmentSelector } from "../components/EquipmentSelector";
import { FinancingCalculator } from "../components/FinancingCalculator";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { TradeInSection } from "../components/TradeInSection";
import { saveQuotePackage } from "../lib/quote-api";
import { useActiveBranches } from "@/hooks/useBranches";
import { BranchDocumentHeader, BranchDocumentFooter } from "@/components/BranchDocumentHeader";

type EntryMode = "voice" | "ai_chat" | "manual";
type Step = "entry" | "equipment" | "financing" | "review";

interface SelectedEquipment {
  id?: string;
  make: string;
  model: string;
  year: number | null;
  price: number;
  attachments: Array<{ name: string; price: number }>;
}

export function QuoteBuilderV2Page() {
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("deal_id") || searchParams.get("crm_deal_id") || "";
  const contactId = searchParams.get("contact_id") || searchParams.get("crm_contact_id") || "";

  const [step, setStep] = useState<Step>("entry");
  const [entryMode, setEntryMode] = useState<EntryMode>("manual");
  const [quoteBranch, setQuoteBranch] = useState("");
  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];
  const [selectedEquipment, setSelectedEquipment] = useState<SelectedEquipment[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Array<{ name: string; price: number }>>([]);
  const [tradeAllowance, setTradeAllowance] = useState<number>(0);
  const [tradeValuationId, setTradeValuationId] = useState<string | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<{ machine: string; attachments: string[]; reasoning: string } | null>(null);

  const equipmentTotal = selectedEquipment.reduce((sum, e) => sum + (e.price || 0), 0);
  const attachmentTotal = selectedAttachments.reduce((sum, a) => sum + a.price, 0);
  const subtotal = equipmentTotal + attachmentTotal;
  const netTotal = subtotal - tradeAllowance;
  const dealerCost = subtotal * 0.8; // Estimated — real cost from catalog
  const marginAmount = netTotal - dealerCost;
  const marginPct = netTotal > 0 ? (marginAmount / netTotal) * 100 : 0;

  const saveMutation = useMutation({
    mutationFn: () => saveQuotePackage({
      deal_id: dealId,
      contact_id: contactId || undefined,
      equipment: selectedEquipment,
      attachments_included: selectedAttachments,
      trade_in_valuation_id: tradeValuationId,
      trade_allowance: tradeAllowance,
      equipment_total: equipmentTotal,
      attachment_total: attachmentTotal,
      subtotal,
      trade_credit: tradeAllowance,
      net_total: netTotal,
      margin_amount: marginAmount,
      margin_pct: marginPct,
      ai_recommendation: aiRecommendation,
      entry_mode: entryMode,
    }),
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Quote Builder</h1>
        <p className="text-sm text-muted-foreground">
          Build quotes with voice, AI chat, or manual entry. Zero-blocking — works with or without IntelliDealer.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {(["entry", "equipment", "financing", "review"] as Step[]).map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              step === s
                ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                : "border-border text-muted-foreground hover:border-foreground/20"
            }`}
          >
            {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Step 1: Entry Mode */}
      {step === "entry" && (
        <div className="space-y-4">
          {/* Branch selector */}
          {branches.length > 0 && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                value={quoteBranch}
                onChange={(e) => setQuoteBranch(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm bg-background"
              >
                <option value="">Select quoting branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.slug}>{b.display_name}</option>
                ))}
              </select>
              {!quoteBranch && (
                <span className="text-[11px] text-muted-foreground">Branch appears on the printed quote</span>
              )}
            </div>
          )}

          <h2 className="text-sm font-semibold text-foreground">How would you like to build this quote?</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              { mode: "voice" as EntryMode, icon: Mic, label: "Voice", desc: "Record a deal description — AI populates all fields" },
              { mode: "ai_chat" as EntryMode, icon: MessageSquare, label: "AI Chat", desc: "Type a description — AI populates fields" },
              { mode: "manual" as EntryMode, icon: FileText, label: "Manual", desc: "Traditional form entry" },
            ]).map(({ mode, icon: Icon, label, desc }) => (
              <button
                key={mode}
                onClick={() => { setEntryMode(mode); setStep("equipment"); }}
                className={`rounded-xl border p-4 text-left transition hover:border-qep-orange/50 ${
                  entryMode === mode ? "border-qep-orange bg-qep-orange/5" : "border-border"
                }`}
              >
                <Icon className="h-6 w-6 text-qep-orange" />
                <p className="mt-2 font-semibold text-foreground">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Equipment Selection */}
      {step === "equipment" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Select Equipment</h2>

          <EquipmentSelector
            onSelect={(entry) => {
              setSelectedEquipment((prev) => [...prev, {
                id: entry.id,
                make: entry.make,
                model: entry.model,
                year: entry.year,
                price: entry.list_price || 0,
                attachments: entry.attachments || [],
              }]);
            }}
            onRecommendation={(rec) => {
              setAiRecommendation(rec);
            }}
          />

          {aiRecommendation && (
            <Card className="border-qep-orange/30 bg-qep-orange/5 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">AI Recommendation</p>
              <p className="mt-1 font-semibold text-foreground">{aiRecommendation.machine}</p>
              {aiRecommendation.attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">Attachments: {aiRecommendation.attachments.join(", ")}</p>
              )}
              <p className="mt-2 text-sm italic text-foreground/80">{aiRecommendation.reasoning}</p>
            </Card>
          )}

          {selectedEquipment.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected Equipment</p>
              {selectedEquipment.map((e, i) => (
                <div key={i} className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium">{e.make} {e.model} {e.year && `(${e.year})`}</span>
                  <span className="font-semibold text-foreground">${(e.price || 0).toLocaleString()}</span>
                </div>
              ))}
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("entry")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("financing")} disabled={selectedEquipment.length === 0}>
              Financing <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Financing + Trade-In */}
      {step === "financing" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Financing & Trade-In</h2>

          {dealId && (
            <TradeInSection
              dealId={dealId}
              onTradeValueChange={(value, valId) => {
                setTradeAllowance(value || 0);
                setTradeValuationId(valId);
              }}
            />
          )}

          <FinancingCalculator totalAmount={netTotal} marginPct={marginPct} />

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("equipment")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("review")}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 4: Review + Save */}
      {step === "review" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Review Quote</h2>

          <MarginCheckBanner marginPct={marginPct} />

          <Card className="p-4 space-y-3">
            {/* Branch letterhead on printed quote */}
            {quoteBranch && (
              <BranchDocumentHeader branchSlug={quoteBranch} className="pb-3 border-b mb-2" />
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Equipment</span>
              <span className="font-medium">${equipmentTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Attachments</span>
              <span className="font-medium">${attachmentTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold">${subtotal.toLocaleString()}</span>
            </div>
            {tradeAllowance > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>Trade-In Credit</span>
                <span>-${tradeAllowance.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="font-bold text-foreground">Net Total</span>
              <span className="text-lg font-bold text-qep-orange">${netTotal.toLocaleString()}</span>
            </div>
            {quoteBranch && <BranchDocumentFooter branchSlug={quoteBranch} />}
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("financing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !dealId}
            >
              <Save className="mr-1 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Quote"}
            </Button>
          </div>

          {saveMutation.isSuccess && (
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-sm text-emerald-400">Quote saved successfully.</p>
            </Card>
          )}
          {saveMutation.isError && (
            <Card className="border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm text-red-400">Failed to save quote. Try again.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
