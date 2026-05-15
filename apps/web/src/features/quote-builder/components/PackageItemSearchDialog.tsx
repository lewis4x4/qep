import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, PackagePlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { searchQuotePackageItems, type QuotePackageCatalogItem, type QuotePackageCatalogKind } from "../lib/quote-api";

const KIND_LABELS: Record<QuotePackageCatalogKind, string> = {
  attachment: "Attachments",
  option: "Options",
  accessory: "Accessories",
  part: "Parts",
  warranty: "Warranty",
};

const KIND_SINGULAR_LABELS: Record<QuotePackageCatalogKind, string> = {
  attachment: "Attachment",
  option: "Option",
  accessory: "Accessory",
  part: "Part",
  warranty: "Warranty",
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

interface PackageItemSearchDialogProps {
  open: boolean;
  kind: QuotePackageCatalogKind;
  selectedIds: string[];
  compatibleItems?: QuotePackageCatalogItem[];
  onOpenChange: (open: boolean) => void;
  onAdd: (item: QuotePackageCatalogItem) => void;
}

export function PackageItemSearchDialog({
  open,
  kind,
  selectedIds,
  compatibleItems = [],
  onOpenChange,
  onAdd,
}: PackageItemSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuotePackageCatalogItem[]>([]);
  const requestSeqRef = useRef(0);
  const activeKindRef = useRef(kind);
  const selected = new Set(selectedIds);
  const kindLabel = KIND_LABELS[kind];
  const searchPlaceholder = kind === "part"
    ? "Search parts by part number, description, or manufacturer..."
    : `Search ${kindLabel.toLowerCase()} by name or category...`;

  useEffect(() => {
    activeKindRef.current = kind;
  }, [kind]);

  const searchMutation = useMutation({
    mutationFn: async (nextQuery?: string) => {
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      const requestKind = kind;
      const items = await searchQuotePackageItems({ kind: requestKind, query: nextQuery ?? query });
      return { items, kind: requestKind, seq };
    },
    onSuccess: (result) => {
      if (result.seq !== requestSeqRef.current) return;
      if (result.kind !== activeKindRef.current) return;
      setResults(result.items);
    },
  });

  useEffect(() => {
    if (!open) return;
    setResults([]);
    searchMutation.mutate("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  const compatibleVisible = kind === "attachment" && compatibleItems.length > 0;
  const resultIds = new Set(results.map((item) => item.id));
  const combinedResults = [
    ...(compatibleVisible ? compatibleItems.filter((item) => !resultIds.has(item.id)) : []),
    ...results,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add {kindLabel.toLowerCase()} to the package</DialogTitle>
          <DialogDescription>
            Search catalog-backed package items so the quote gets the right name, price, and source trail. Manual entry stays available when a catalog row is missing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && searchMutation.mutate(query)}
              placeholder={searchPlaceholder}
              className="rounded border border-input bg-card px-3 py-2 text-sm"
              autoFocus
            />
            <Button onClick={() => searchMutation.mutate(query)} disabled={searchMutation.isPending}>
              <Search className="mr-1 h-4 w-4" />
              {searchMutation.isPending ? "Searching..." : "Search"}
            </Button>
          </div>

          {compatibleVisible && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              Compatible attachment suggestions from the selected equipment are shown first.
            </div>
          )}

          {searchMutation.isError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Catalog search failed. You can still add this item manually below Step 3.
            </div>
          )}

          {combinedResults.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {combinedResults.map((item) => {
                const isSelected = selected.has(item.id) || selected.has(item.sourceId);
                const qtyOnHand = typeof item.metadata?.qty_on_hand === "number"
                  ? item.metadata.qty_on_hand
                  : null;
                return (
                  <div key={`${item.kind}-${item.id}`} className="rounded-xl border border-border/80 bg-card/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[item.brandName, item.category].filter(Boolean).join(" • ") || "QEP package catalog"}
                        </p>
                      </div>
                      <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-xs font-semibold text-qep-orange">
                        {money(item.price)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        {item.universal ? "Universal" : KIND_SINGULAR_LABELS[item.kind]}
                        {item.kind === "part" && qtyOnHand != null ? ` · ${qtyOnHand} on hand` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant={isSelected ? "outline" : "default"}
                        onClick={() => onAdd(item)}
                        disabled={isSelected}
                      >
                        {isSelected ? <Check className="mr-1 h-4 w-4" /> : <PackagePlus className="mr-1 h-4 w-4" />}
                        {isSelected ? "Added" : "Add"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !searchMutation.isPending ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No {kindLabel.toLowerCase()} found. Try another search or use the manual fallback in Step 3.
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
