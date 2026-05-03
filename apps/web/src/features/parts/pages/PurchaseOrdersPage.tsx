import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { PartsSubNav } from "../components/PartsSubNav";
import {
  formatVendorPurchaseOrderStatus,
  formatVendorPurchaseOrderType,
  normalizePurchaseOrderRows,
  normalizeVendorOptionRows,
  type VendorPurchaseOrderStatus,
  type VendorPurchaseOrderType,
} from "../lib/purchase-order-utils";

function makeDraftPoNumber(): string {
  return `PO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [orderType, setOrderType] = useState<VendorPurchaseOrderType>("miscellaneous");
  const [description, setDescription] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const vendorsQuery = useQuery({
    queryKey: ["vendor-profiles", "po-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return normalizeVendorOptionRows(data);
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["vendor-purchase-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_purchase_orders")
        .select("id, po_number, order_type, status, description, location_code, vendor_id, created_at, vendor_profiles(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return normalizePurchaseOrderRows(data);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!vendorId) throw new Error("Vendor is required.");

      const { data, error } = await supabase
        .from("vendor_purchase_orders")
        .insert({
          po_number: makeDraftPoNumber(),
          vendor_id: vendorId,
          order_type: orderType,
          status: "po_requested",
          description: description.trim() || null,
          location_code: locationCode.trim() || null,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Failed to create purchase order.");
      if (typeof data.id !== "string" || data.id.length === 0) {
        throw new Error("Failed to create purchase order.");
      }
      return data.id;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["vendor-purchase-orders"] });
      setDescription("");
      setLocationCode("");
      navigate(`/parts/purchase-orders/${id}`);
    },
  });

  const orders = ordersQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((row) => {
      const vendorName = row.vendor_profiles?.name ?? "";
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.po_number.toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q) ||
        vendorName.toLowerCase().includes(q) ||
        (row.location_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter]);

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dedicated vendor POs for equipment, fixed assets, replenishment, and miscellaneous buys that do not belong in parts orders.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium">Create purchase order</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="rounded border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="">Select vendor</option>
            {(vendorsQuery.data ?? []).map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as VendorPurchaseOrderType)}
            className="rounded border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="miscellaneous">Miscellaneous</option>
            <option value="equipment">Equipment</option>
            <option value="fixed_asset">Fixed Asset</option>
            <option value="equipment_replenishment">Equipment Replenishment</option>
          </select>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
          />
          <Input
            value={locationCode}
            onChange={(e) => setLocationCode(e.target.value)}
            placeholder="Location"
          />
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating…" : "Create purchase order"}
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO number, vendor, description, or location"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-input bg-card px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="po_requested">PO Request</option>
            <option value="waiting_authorization">Waiting for Authorization</option>
            <option value="authorized">Authorized</option>
            <option value="on_order">On Order</option>
            <option value="canceled">Canceled</option>
            <option value="back_order">Back Order</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {ordersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading purchase orders…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders match the current search.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => {
              const vendorName = row.vendor_profiles?.name ?? "Vendor";
              return (
                <Link
                  key={row.id}
                  to={`/parts/purchase-orders/${row.id}`}
                  className="block rounded-lg border border-border/60 bg-card/40 p-4 hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.po_number}</p>
                      <p className="text-sm text-muted-foreground">{vendorName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatVendorPurchaseOrderType(row.order_type)}{row.location_code ? ` · ${row.location_code}` : ""}
                      </p>
                      {row.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatVendorPurchaseOrderStatus(row.status)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
