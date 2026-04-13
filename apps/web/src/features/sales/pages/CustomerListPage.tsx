import { useState } from "react";
import { useCustomers } from "../hooks/useCustomers";
import { SalesCustomerCard } from "../components/SalesCustomerCard";
import { CustomerSearchBar } from "../components/CustomerSearchBar";
import {
  Flame,
  Truck,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Filter chip config ─────────────────────────────────── */
const CUSTOMER_FILTERS = [
  { key: "all", label: "All" },
  { key: "hot", label: "Hot", icon: Flame, color: "text-red-400" },
  { key: "active", label: "Active Deals", icon: Zap, color: "text-qep-orange" },
  { key: "overdue", label: "Due Follow-up", icon: Clock, color: "text-muted-foreground" },
] as const;

export function CustomerListPage() {
  const { customers, allCustomers, search, setSearch, isLoading } =
    useCustomers();
  const [filter, setFilter] = useState("all");

  // Apply secondary filter on top of search
  const filtered = customers.filter((c) => {
    if (filter === "hot") return c.opportunity_score >= 70;
    if (filter === "active") return c.open_deals > 0;
    if (filter === "overdue")
      return c.days_since_contact != null && c.days_since_contact >= 7;
    return true;
  });

  // Hero stats
  const totalOpen = allCustomers.reduce((sum, c) => sum + c.open_deals, 0);
  const hotCount = allCustomers.filter((c) => c.opportunity_score >= 70).length;

  return (
    <div className="flex flex-col pb-20 max-w-lg mx-auto">
      {/* Hero stats */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-0.5">
              My Book of Business
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-black text-foreground tracking-[-0.02em]">
                {allCustomers.length}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">
                active customers
              </span>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em]">
                Open Deals
              </p>
              <p className="text-[15px] font-extrabold text-qep-orange">
                {totalOpen}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em]">
                Hot
              </p>
              <p className="text-[15px] font-extrabold text-red-400 flex items-center gap-1 justify-end">
                <Flame className="w-[13px] h-[13px]" />
                {hotCount}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <CustomerSearchBar value={search} onChange={setSearch} />
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 px-3 py-2.5 overflow-x-auto scrollbar-none border-b border-white/[0.06] sticky top-0 z-10 bg-[hsl(var(--background))]">
        {CUSTOMER_FILTERS.map((f) => {
          const Icon = "icon" in f ? f.icon : null;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-3 py-[7px] rounded-full text-xs font-bold border transition-all duration-150",
                active
                  ? "bg-qep-orange text-white border-qep-orange"
                  : "bg-[hsl(var(--card))] text-muted-foreground border-white/[0.06] hover:border-white/20",
              )}
            >
              {Icon && (
                <Icon
                  className={cn(
                    "w-3 h-3",
                    active ? "text-white" : ("color" in f ? f.color : "text-muted-foreground"),
                  )}
                />
              )}
              {f.label}
            </button>
          );
        })}
      </div>

      {/* AI-ranked banner */}
      <div className="px-4 pt-2.5 pb-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-[22px] h-[22px] rounded-[7px] bg-qep-orange/10 flex items-center justify-center">
            <Zap className="w-[11px] h-[11px] text-qep-orange" />
          </div>
          <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.08em]">
            Iron-Ranked by Opportunity
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground/60 font-semibold">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Customer list */}
      <div className="px-4 py-2.5 space-y-2.5">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length > 0 ? (
          filtered.map((customer, idx) => (
            <SalesCustomerCard
              key={customer.customer_id}
              customer={customer}
              rank={idx}
              showRank={filter === "all" && !search}
            />
          ))
        ) : search ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              No customers match &ldquo;{search}&rdquo;
            </p>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              No customers yet. Start by logging a visit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
