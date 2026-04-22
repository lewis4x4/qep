import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { PartsSubNav } from "../components/PartsSubNav";
import {
  formatVendorPurchaseOrderStatus,
  formatVendorPurchaseOrderType,
  nextVendorPurchaseOrderStatuses,
  sumVendorPurchaseOrderLines,
  type VendorPurchaseOrderStatus,
  type VendorPurchaseOrderType,
} from "../lib/purchase-order-utils";

type PurchaseOrderHeader = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_type: VendorPurchaseOrderType;
  status: VendorPurchaseOrderStatus;
  location_code: string | null;
  description: string | null;
  crm_company_id: string | null;
  order_comments: string | null;
  shipping_contact_name: string | null;
  shipping_address_line_1: string | null;
  shipping_address_line_2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  shipping_method: string | null;
  shipping_charge_cents: number;
  delivery_notes: string | null;
  terms_and_conditions: string | null;
  long_description: string | null;
  authorized_at: string | null;
  ordered_at: string | null;
  completed_at: string | null;
  created_at: string;
  vendor_profiles?: { name?: string } | { name?: string }[] | null;
  crm_companies?: { name?: string } | { name?: string }[] | null;
};

type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  line_number: number;
  line_type: "miscellaneous" | "equipment_base" | "option";
  item_code: string | null;
  description: string;
  quantity: number;
  unit_cost_cents: number;
};

type Touchpoint = {
  id: string;
  purchase_order_id: string;
  contact_name: string | null;
  note: string;
  occurred_at: string;
};

type VendorRow = {
  id: string;
  name: string;
};

type EquipmentModel = {
  id: string;
  brand_id: string;
  model_code: string;
  name_display: string;
  list_price_cents: number;
};

type AttachmentRow = {
  id: string;
  brand_id: string | null;
  name: string;
  list_price_cents: number;
  compatible_model_ids: string[] | null;
  universal: boolean;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function PurchaseOrderDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [touchpointNote, setTouchpointNote] = useState("");
  const [touchpointContact, setTouchpointContact] = useState("");
  const [miscDescription, setMiscDescription] = useState("");
  const [miscQuantity, setMiscQuantity] = useState("1");
  const [miscCost, setMiscCost] = useState("0");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  const headerQuery = useQuery({
    queryKey: ["vendor-purchase-order", id],
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: PurchaseOrderHeader | null; error: unknown }> } };
        };
      })
        .from("vendor_purchase_orders")
        .select("*, vendor_profiles(name), crm_companies(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linesQuery = useQuery({
    queryKey: ["vendor-purchase-order-lines", id],
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, options?: Record<string, boolean>) => Promise<{ data: PurchaseOrderLine[] | null; error: unknown }> } };
        };
      })
        .from("vendor_purchase_order_lines")
        .select("*")
        .eq("purchase_order_id", id)
        .order("line_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const touchpointsQuery = useQuery({
    queryKey: ["vendor-purchase-order-touchpoints", id],
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, options?: Record<string, boolean>) => Promise<{ data: Touchpoint[] | null; error: unknown }> } };
        };
      })
        .from("vendor_purchase_order_touchpoints")
        .select("id, purchase_order_id, contact_name, note, occurred_at")
        .eq("purchase_order_id", id)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ["vendor-purchase-order-equipment-catalog"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: boolean) => { limit: (count: number) => Promise<{ data: EquipmentModel[] | null; error: unknown }> } };
        };
      })
        .from("qb_equipment_models")
        .select("id, brand_id, model_code, name_display, list_price_cents")
        .eq("active", true)
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attachmentsQuery = useQuery({
    queryKey: ["vendor-purchase-order-attachments", selectedModelId],
    enabled: Boolean(selectedModelId),
    queryFn: async () => {
      const model = (equipmentQuery.data ?? []).find((row) => row.id === selectedModelId);
      if (!model) return [];
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: boolean) => { limit: (count: number) => Promise<{ data: AttachmentRow[] | null; error: unknown }> } };
        };
      })
        .from("qb_attachments")
        .select("id, brand_id, name, list_price_cents, compatible_model_ids, universal")
        .eq("active", true)
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter((attachment) => {
        const compatibleIds = Array.isArray(attachment.compatible_model_ids) ? attachment.compatible_model_ids : [];
        return attachment.brand_id === model.brand_id && (attachment.universal || compatibleIds.includes(model.id));
      });
    },
  });

  const saveHeaderMutation = useMutation({
    mutationFn: async (payload: Partial<PurchaseOrderHeader>) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("vendor_purchase_orders")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["vendor-purchase-order", id] });
    },
  });

  const addMiscLineMutation = useMutation({
    mutationFn: async () => {
      const lines = linesQuery.data ?? [];
      const quantity = Number.parseFloat(miscQuantity);
      const cost = Number.parseFloat(miscCost);
      if (!miscDescription.trim() || !Number.isFinite(quantity) || !Number.isFinite(cost)) {
        throw new Error("Description, quantity, and cost are required.");
      }
      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("vendor_purchase_order_lines")
        .insert({
          purchase_order_id: id,
          line_number: lines.length + 1,
          line_type: "miscellaneous",
          description: miscDescription.trim(),
          quantity,
          unit_cost_cents: Math.round(cost * 100),
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMiscDescription("");
      setMiscQuantity("1");
      setMiscCost("0");
      await qc.invalidateQueries({ queryKey: ["vendor-purchase-order-lines", id] });
    },
  });

  const addEquipmentLineMutation = useMutation({
    mutationFn: async () => {
      const lines = linesQuery.data ?? [];
      const model = (equipmentQuery.data ?? []).find((row) => row.id === selectedModelId);
      if (!model) throw new Error("Select a base number first.");

      const inserts: Array<Record<string, unknown>> = [
        {
          purchase_order_id: id,
          line_number: lines.length + 1,
          line_type: "equipment_base",
          item_code: model.model_code,
          description: model.name_display,
          quantity: 1,
          unit_cost_cents: model.list_price_cents,
          qb_equipment_model_id: model.id,
        },
      ];

      const options = attachmentsQuery.data ?? [];
      selectedOptionIds.forEach((attachmentId, index) => {
        const attachment = options.find((row) => row.id === attachmentId);
        if (!attachment) return;
        inserts.push({
          purchase_order_id: id,
          line_number: lines.length + 2 + index,
          line_type: "option",
          item_code: attachment.id,
          description: attachment.name,
          quantity: 1,
          unit_cost_cents: attachment.list_price_cents,
          qb_attachment_id: attachment.id,
        });
      });

      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Array<Record<string, unknown>>) => Promise<{ error: unknown }> };
      })
        .from("vendor_purchase_order_lines")
        .insert(inserts);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSelectedModelId("");
      setSelectedOptionIds([]);
      await qc.invalidateQueries({ queryKey: ["vendor-purchase-order-lines", id] });
    },
  });

  const addTouchpointMutation = useMutation({
    mutationFn: async () => {
      if (!touchpointNote.trim()) throw new Error("Call tracking note is required.");
      const { error } = await (supabase as unknown as {
        from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: unknown }> };
      })
        .from("vendor_purchase_order_touchpoints")
        .insert({
          purchase_order_id: id,
          contact_name: touchpointContact.trim() || null,
          note: touchpointNote.trim(),
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      setTouchpointNote("");
      setTouchpointContact("");
      await qc.invalidateQueries({ queryKey: ["vendor-purchase-order-touchpoints", id] });
    },
  });

  const header = headerQuery.data;
  const lines = linesQuery.data ?? [];
  const touchpoints = touchpointsQuery.data ?? [];
  const nextStatuses = header ? nextVendorPurchaseOrderStatuses(header.status) : [];
  const lineTotal = sumVendorPurchaseOrderLines(lines.map((line) => ({
    quantity: line.quantity,
    unit_cost_cents: line.unit_cost_cents,
  })));

  if (!id) {
    return null;
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/parts/purchase-orders"
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2"
        >
          ← All vendor POs
        </Link>
      </div>

      {headerQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : header ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{header.po_number}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {one(header.vendor_profiles)?.name ?? "Vendor"} · {formatVendorPurchaseOrderType(header.order_type)}
            </p>
          </div>

          <Card className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                {formatVendorPurchaseOrderStatus(header.status)}
              </span>
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {formatVendorPurchaseOrderType(header.order_type)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Description</span>
                <Input
                  value={header.description ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ description: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Location</span>
                <Input
                  value={header.location_code ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ location_code: e.target.value })}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Shipping contact</span>
                <Input
                  value={header.shipping_contact_name ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ shipping_contact_name: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Shipping method</span>
                <Input
                  value={header.shipping_method ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ shipping_method: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Terms &amp; Conditions</span>
                <textarea
                  value={header.terms_and_conditions ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ terms_and_conditions: e.target.value })}
                  className="w-full min-h-[90px] rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Long description</span>
                <textarea
                  value={header.long_description ?? ""}
                  onChange={(e) => saveHeaderMutation.mutate({ long_description: e.target.value })}
                  className="w-full min-h-[90px] rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>

            {nextStatuses.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      saveHeaderMutation.mutate({
                        status,
                        authorized_at: status === "authorized" ? new Date().toISOString() : header.authorized_at,
                        ordered_at: status === "on_order" ? new Date().toISOString() : header.ordered_at,
                        completed_at: status === "completed" ? new Date().toISOString() : header.completed_at,
                      })
                    }
                    disabled={saveHeaderMutation.isPending}
                  >
                    {formatVendorPurchaseOrderStatus(status)}
                  </Button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Details</h2>
                <p className="text-sm text-muted-foreground">Equipment bases, options, and miscellaneous items on this PO.</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">Total ${(lineTotal / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">{lines.length} lines</p>
              </div>
            </div>

            <div className="space-y-2">
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lines yet.</p>
              ) : (
                lines.map((line) => (
                  <div key={line.id} className="rounded border border-border/60 bg-card/40 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{line.item_code || `Line ${line.line_number}`}</p>
                        <p className="text-xs text-muted-foreground">{line.description}</p>
                      </div>
                      <div className="text-right">
                        <p>{line.quantity} × ${(line.unit_cost_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-xs text-muted-foreground">{line.line_type}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4 space-y-3">
                <p className="font-medium">Add miscellaneous line</p>
                <Input value={miscDescription} onChange={(e) => setMiscDescription(e.target.value)} placeholder="Description" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={miscQuantity} onChange={(e) => setMiscQuantity(e.target.value)} placeholder="Qty" />
                  <Input value={miscCost} onChange={(e) => setMiscCost(e.target.value)} placeholder="Unit cost" />
                </div>
                <Button size="sm" onClick={() => addMiscLineMutation.mutate()} disabled={addMiscLineMutation.isPending}>
                  Add misc line
                </Button>
              </Card>

              <Card className="p-4 space-y-3">
                <p className="font-medium">Add base &amp; options</p>
                <select
                  value={selectedModelId}
                  onChange={(e) => {
                    setSelectedModelId(e.target.value);
                    setSelectedOptionIds([]);
                  }}
                  className="rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Select base number</option>
                  {(equipmentQuery.data ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.model_code} · {model.name_display}
                    </option>
                  ))}
                </select>
                {attachmentsQuery.data && attachmentsQuery.data.length > 0 && (
                  <div className="space-y-2">
                    {attachmentsQuery.data.map((attachment) => (
                      <label key={attachment.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedOptionIds.includes(attachment.id)}
                          onChange={(e) =>
                            setSelectedOptionIds((current) =>
                              e.target.checked
                                ? [...current, attachment.id]
                                : current.filter((id) => id !== attachment.id),
                            )
                          }
                        />
                        <span>{attachment.name}</span>
                        <span className="text-muted-foreground">
                          ${(attachment.list_price_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <Button size="sm" onClick={() => addEquipmentLineMutation.mutate()} disabled={addEquipmentLineMutation.isPending}>
                  Add base and options
                </Button>
              </Card>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">Call tracking</h2>
            <div className="space-y-2">
              {touchpoints.map((touchpoint) => (
                <div key={touchpoint.id} className="rounded border border-border/60 bg-card/40 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{touchpoint.contact_name || "Vendor contact"}</p>
                      <p className="text-xs text-muted-foreground">{touchpoint.note}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(touchpoint.occurred_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={touchpointContact}
                onChange={(e) => setTouchpointContact(e.target.value)}
                placeholder="Contact name"
              />
              <Input
                value={touchpointNote}
                onChange={(e) => setTouchpointNote(e.target.value)}
                placeholder="Note"
              />
            </div>
            <Button size="sm" onClick={() => addTouchpointMutation.mutate()} disabled={addTouchpointMutation.isPending}>
              Add call tracking note
            </Button>
          </Card>
        </>
      ) : (
        <Card className="p-4 text-sm text-destructive">Could not load purchase order.</Card>
      )}
    </div>
  );
}
