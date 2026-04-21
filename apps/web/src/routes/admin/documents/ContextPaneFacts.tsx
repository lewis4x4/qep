import { useMemo } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DocumentCenterFact } from "@/features/documents/router";

export interface ContextPaneFactsProps {
  facts: DocumentCenterFact[];
}

const FACT_GROUPS: Array<{ title: string; types: string[] }> = [
  { title: "Parties", types: ["party_customer", "party_vendor", "party_lienholder"] },
  { title: "Dates", types: ["effective_date", "expiration_date", "renewal_window"] },
  { title: "Equipment", types: ["equipment_tag"] },
  { title: "Parts", types: ["part_sku", "parts_list_total"] },
  { title: "Money", types: ["monetary_amount"] },
  {
    title: "Obligations",
    types: ["obligation_delivery", "obligation_inspection", "obligation_service_interval"],
  },
  { title: "Signatures", types: ["signature_present", "signature_missing"] },
  { title: "Lineage", types: ["document_class", "amendment_of", "supersedes"] },
];

function factLabel(fact: DocumentCenterFact): string {
  const value = fact.value as { raw?: string; normalized?: string; currency?: string };
  const normalized = value.normalized?.trim() || value.raw?.trim() || "(empty)";
  if (fact.factType === "monetary_amount" && value.currency) {
    return `${value.currency} ${normalized}`;
  }
  return normalized;
}

export function ContextPaneFacts({ facts }: ContextPaneFactsProps) {
  const groupsWithFacts = useMemo(() => {
    const typeToFacts = new Map<string, DocumentCenterFact[]>();
    for (const fact of facts) {
      const bucket = typeToFacts.get(fact.factType) ?? [];
      bucket.push(fact);
      typeToFacts.set(fact.factType, bucket);
    }
    return FACT_GROUPS.map((group) => ({
      ...group,
      entries: group.types.flatMap((type) => typeToFacts.get(type) ?? []),
    })).filter((group) => group.entries.length > 0);
  }, [facts]);

  if (facts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 text-foreground">
          <Sparkles className="h-3 w-3" />
          <span className="text-xs font-medium">No extracted facts yet</span>
        </div>
        <p className="mt-1 text-[11px]">
          Trigger the document twin to populate parties, dates, equipment, and obligations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groupsWithFacts.map((group) => (
        <div key={group.title}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </p>
          <div className="mt-1 space-y-1">
            {group.entries.map((fact) => {
              const verified = Boolean(fact.verifiedAt);
              return (
                <div
                  key={fact.id}
                  className="flex items-start gap-2 rounded-md border border-border/80 px-2 py-1.5"
                  title={fact.factType}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground">{factLabel(fact)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {fact.factType.replace(/_/g, " ")}
                    </p>
                  </div>
                  {verified ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" aria-label="Verified" />
                  ) : null}
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      fact.confidence >= 0.8
                        ? "border-emerald-500/60 text-emerald-500"
                        : fact.confidence >= 0.5
                        ? "border-amber-500/60 text-amber-500"
                        : "border-rose-500/60 text-rose-500",
                    )}
                  >
                    {(fact.confidence * 100).toFixed(0)}%
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
