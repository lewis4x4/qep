import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import type { ServiceJobWithRelations } from "../lib/types";
const trucks = [
  ["flatbed_tilt_deck", "Flatbed — Tilt Deck", 12000],
  ["flatbed_gooseneck", "Flatbed — Gooseneck", 19000],
  ["peterbilt_landoll", "Peterbilt — Landoll", 36000],
  ["peterbilt_fontaine", "Peterbilt — Fontaine", 115000],
  ["peterbilt_oversize", "Peterbilt — Oversize", 135000],
] as const;
export function ServiceHaulPanel({ job }: { job: ServiceJobWithRelations }) {
  const qc = useQueryClient();
  const [truck, setTruck] = useState<string>("");
  const [rateType, setRateType] = useState<"internal" | "customer">("customer");
  const [miles, setMiles] = useState("");
  const [from, setFrom] = useState(job.field_site_location ?? "");
  const [to, setTo] = useState(job.branch_id ?? "");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const valid = truck && miles.trim() && Number.isFinite(Number(miles)) && Number(miles)>=0;
  const action = useMutation({
    mutationFn: async (create: boolean) => {
      if (!valid) throw new Error("Select truck class and enter one-way miles.");
      const { data: rates, error: priceError } = await supabase.rpc("service_calculate_haul_charge", {
        p_workspace_id: job.workspace_id, p_truck_class: truck, p_mileage_one_way: Number(miles), p_rate_type: rateType,
      });
      if (priceError) throw new Error(priceError.message);
      const rate = Array.isArray(rates) ? rates[0] : rates;
      if (!rate || typeof rate.total_cents !== "number") throw new Error("No confirmed haul price. Retail rates remain provisional until configured.");
      setPreview(rate.total_cents);
      if (!create) return;
      if (!from.trim() || !to.trim() || !date) throw new Error("Pickup, drop-off and requested date are required.");
      const { error } = await supabase.functions.invoke("service-haul-router", { body: {
        action: "create", job_id: job.id, truck_class: truck, rate_type: rateType,
        mileage_one_way: Number(miles), mileage_source: "manual", from_location: from, to_location: to, shipping_date: date,
        to_contact_name: job.field_site_contact_name ?? job.requested_by_name, to_contact_phone: job.field_site_contact_phone,
      } });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["service-job", job.id] });
    },
  });
  return <section className="rounded-xl border p-4 space-y-3">
    <h3 className="font-semibold">Hauling and transport</h3>
    <p className="text-xs text-muted-foreground">Use round-trip cost from the selected truck sheet. Internal rates are confirmed; retail requires a configured rate. Manual mileage stays subject to manager review.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label="Haul truck class" value={truck} onChange={e => { setTruck(e.target.value);setPreview(null); }} className="rounded border p-2"><option value="">Truck class and capacity</option>{trucks.map(([id,label,capacity]) => <option key={id} value={id}>{label} · maximum {capacity.toLocaleString()} lb</option>)}</select>
      <select aria-label="Haul rate type" value={rateType} onChange={e => {setRateType(e.target.value as "internal" | "customer");setPreview(null);}} className="rounded border p-2"><option value="customer">Customer retail (configured rates only)</option><option value="internal">Internal</option></select>
      <input aria-label="Haul one-way miles" type="number" min="0" step="0.01" placeholder="One-way miles" value={miles} onChange={e => {setMiles(e.target.value);setPreview(null);}} className="rounded border p-2" />
      <input aria-label="Requested haul date" type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded border p-2" />
      <input aria-label="Haul pickup location" placeholder="Pickup location" value={from} onChange={e => setFrom(e.target.value)} className="rounded border p-2" />
      <input aria-label="Haul drop-off location" placeholder="Drop-off location" value={to} onChange={e => setTo(e.target.value)} className="rounded border p-2" />
    </div>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!valid || action.isPending} onClick={() => action.mutate(false)}>Check haul price</Button><Button disabled={!valid || action.isPending || !from || !to || !date} onClick={() => action.mutate(true)}>Create transport request</Button></div>
    {preview !== null && <p className="text-sm">{Number(miles)*2} round-trip miles · ${(preview/100).toFixed(2)}</p>}
    {action.error && <p role="alert" className="text-destructive text-sm">{action.error.message}</p>}
    {action.isSuccess && action.variables === true && <p role="status" className="text-sm">Transport request saved. <Link to="/ops/traffic" className="underline">Open dispatch</Link> to assign a verified driver.</p>}
  </section>;
}
