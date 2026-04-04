import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Truck, MapPin } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  haul_pending: "bg-gray-500/10 text-gray-400",
  scheduled: "bg-yellow-500/10 text-yellow-400",
  being_shipped: "bg-orange-500/10 text-orange-400",
  completed: "bg-red-500/10 text-red-400",
};

const TICKET_TYPES = [
  "demo", "loaner", "rental", "sale", "purchase", "service",
  "trade_in", "customer_transfer", "job_site_transfer",
  "location_transfer", "miscellaneous", "re_rent",
];

export function TrafficTicketsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["ops", "traffic-tickets", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("traffic_tickets")
        .select("*")
        .order("shipping_date", { ascending: true });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });

  if (isLoading) {
    return <div className="space-y-4 p-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Traffic Tickets</h1>
          <p className="text-sm text-muted-foreground">Equipment logistics — no equipment moves without a ticket</p>
        </div>
        <Button size="sm"><Truck className="mr-1 h-4 w-4" /> New Ticket</Button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {["all", "haul_pending", "scheduled", "being_shipped", "completed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === s ? "border-qep-orange bg-qep-orange/10 text-qep-orange" : "border-border text-muted-foreground"
            }`}
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {(tickets ?? []).length === 0 ? (
          <Card className="p-6 text-center"><p className="text-sm text-muted-foreground">No traffic tickets found.</p></Card>
        ) : (
          (tickets ?? []).map((ticket: any) => (
            <Card key={ticket.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[ticket.status] || ""}`}>
                      {ticket.status.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {ticket.ticket_type.replace(/_/g, " ")}
                    </span>
                    {ticket.locked && (
                      <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">Locked</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-foreground">Stock #{ticket.stock_number}</p>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {ticket.from_location} → {ticket.to_location}
                  </div>
                  <p className="text-xs text-muted-foreground">Ship: {ticket.shipping_date} • Contact: {ticket.to_contact_name}</p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
