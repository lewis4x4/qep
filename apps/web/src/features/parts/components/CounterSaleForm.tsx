import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invokeCreateInternalOrder, invokeSubmitInternalOrder } from "../lib/parts-api";

type Line = { part_number: string; description: string; quantity: string; unit_price: string };

export function CounterSaleForm() {
  const navigate = useNavigate();
  const [companyQuery, setCompanyQuery] = useState("");
  const [crmCompanyId, setCrmCompanyId] = useState<string | null>(null);
  const [orderSource, setOrderSource] = useState("counter");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { part_number: "", description: "", quantity: "1", unit_price: "" },
  ]);

  const companiesQ = useQuery({
    queryKey: ["crm-companies-search", companyQuery],
    enabled: companyQuery.trim().length >= 2,
    queryFn: async () => {
      const term = `%${companyQuery.trim()}%`;
      const { data, error } = await supabase
        .from("crm_companies")
        .select("id, name")
        .is("deleted_at", null)
        .ilike("name", term)
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  function buildLineItems() {
    return lines
      .filter((l) => l.part_number.trim())
      .map((l) => ({
        part_number: l.part_number.trim(),
        description: l.description.trim() || null,
        quantity: Math.max(1, parseInt(l.quantity, 10) || 1),
        unit_price: l.unit_price.trim() ? Number(l.unit_price) : null,
      }));
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const line_items = buildLineItems();
      if (!crmCompanyId) throw new Error("Select a CRM company");
      if (line_items.length === 0) throw new Error("Add at least one line");
      return invokeCreateInternalOrder({
        crm_company_id: crmCompanyId,
        order_source: orderSource,
        notes: notes.trim() || null,
        line_items,
      });
    },
    onSuccess: (data) => {
      const id = data.order?.id as string | undefined;
      if (id) navigate(`/parts/orders/${id}`);
    },
  });

  const createAndSubmitMut = useMutation({
    mutationFn: async () => {
      const line_items = buildLineItems();
      if (!crmCompanyId) throw new Error("Select a CRM company");
      if (line_items.length === 0) throw new Error("Add at least one line");
      const { order } = await invokeCreateInternalOrder({
        crm_company_id: crmCompanyId,
        order_source: orderSource,
        notes: notes.trim() || null,
        line_items,
      });
      const id = order?.id as string;
      await invokeSubmitInternalOrder(id);
      return id;
    },
    onSuccess: (id) => navigate(`/parts/orders/${id}`),
  });

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium">CRM company *</label>
        <Input
          placeholder="Type to search company name…"
          value={companyQuery}
          onChange={(e) => {
            setCompanyQuery(e.target.value);
            setCrmCompanyId(null);
          }}
        />
        {crmCompanyId && (
          <p className="text-xs text-muted-foreground">Selected company id: {crmCompanyId}</p>
        )}
        {companiesQ.isError && (
          <p className="text-xs text-destructive" role="alert">
            {(companiesQ.error as Error)?.message ?? "Company search failed."}
          </p>
        )}
        {companiesQ.data && companiesQ.data.length > 0 && !crmCompanyId && (
          <ul className="rounded border border-border/60 max-h-40 overflow-y-auto text-sm">
            {companiesQ.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 hover:bg-muted/50"
                  onClick={() => {
                    setCrmCompanyId(c.id);
                    setCompanyQuery(c.name);
                  }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Order source</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={orderSource}
            onChange={(e) => setOrderSource(e.target.value)}
          >
            <option value="counter">Counter</option>
            <option value="phone">Phone</option>
            <option value="online">Online (staff)</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Notes</label>
          <Input
            placeholder="Walk-in details, PO reference…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Lines</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { part_number: "", description: "", quantity: "1", unit_price: "" },
              ])
            }
          >
            Add line
          </Button>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-12 sm:col-span-3 space-y-1">
              <label className="text-[10px] text-muted-foreground">Part #</label>
              <Input
                className="font-mono text-sm"
                value={line.part_number}
                onChange={(e) => {
                  const v = e.target.value;
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, part_number: v } : x)));
                }}
              />
            </div>
            <div className="col-span-12 sm:col-span-4 space-y-1">
              <label className="text-[10px] text-muted-foreground">Description</label>
              <Input
                value={line.description}
                onChange={(e) => {
                  const v = e.target.value;
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: v } : x)));
                }}
              />
            </div>
            <div className="col-span-6 sm:col-span-2 space-y-1">
              <label className="text-[10px] text-muted-foreground">Qty</label>
              <Input
                value={line.quantity}
                onChange={(e) => {
                  const v = e.target.value;
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v } : x)));
                }}
              />
            </div>
            <div className="col-span-6 sm:col-span-2 space-y-1">
              <label className="text-[10px] text-muted-foreground">Unit price</label>
              <Input
                value={line.unit_price}
                onChange={(e) => {
                  const v = e.target.value;
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_price: v } : x)));
                }}
              />
            </div>
            <div className="col-span-12 sm:col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={lines.length <= 1}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
      </div>

      {(createMut.error || createAndSubmitMut.error) && (
        <p className="text-sm text-destructive">
          {(createMut.error ?? createAndSubmitMut.error)?.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending || createAndSubmitMut.isPending}
        >
          Save as draft
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => createAndSubmitMut.mutate()}
          disabled={createMut.isPending || createAndSubmitMut.isPending}
        >
          Submit to fulfillment
        </Button>
      </div>
    </Card>
  );
}
