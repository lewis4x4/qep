import { Link, useLocation } from "react-router-dom";
import {
  Boxes,
  BookOpen,
  BriefcaseBusiness,
  FileText,
  Package,
  Receipt,
  Settings,
  Wrench,
  Repeat,
  Truck,
} from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";

const NAV_ITEMS = [
  { to: "/portal", icon: Boxes, label: "Fleet" },
  { to: "/portal/deals", icon: BriefcaseBusiness, label: "Deals" },
  { to: "/portal/service", icon: Wrench, label: "Service" },
  { to: "/portal/parts", icon: Package, label: "Parts" },
  { to: "/portal/invoices", icon: Receipt, label: "Invoices" },
  { to: "/portal/quotes", icon: FileText, label: "Quotes" },
  { to: "/portal/subscriptions", icon: Repeat, label: "Subscriptions" },
  { to: "/portal/rentals", icon: Truck, label: "Rentals" },
  { to: "/portal/documents", icon: BookOpen, label: "Documents" },
];

const ROUTE_META = [
  {
    prefix: "/portal/subscriptions",
    eyebrow: "Customer operating room",
    title: "Subscriptions",
    subtitle: "Track usage, billing cadence, rotation timing, and maintenance posture for active equipment plans.",
  },
  {
    prefix: "/portal/rentals",
    eyebrow: "Customer operating room",
    title: "Rental Workspace",
    subtitle: "Book equipment, follow approvals and payment state, manage extensions, and monitor return closeout from one customer-safe rental lane.",
  },
  {
    prefix: "/portal/invoices",
    eyebrow: "Customer operating room",
    title: "Billing Center",
    subtitle: "See balances, payment status, and dealership-recorded reconciliation in one place.",
  },
  {
    prefix: "/portal/quotes",
    eyebrow: "Customer operating room",
    title: "Quote Room",
    subtitle: "Review proposals, understand line items, and accept or decline with signature-ready context.",
  },
  {
    prefix: "/portal/service",
    eyebrow: "Customer operating room",
    title: "Service Workspace",
    subtitle: "Submit requests, add field photos, and follow the live shop timeline without leaving the portal.",
  },
  {
    prefix: "/portal/parts",
    eyebrow: "Customer operating room",
    title: "Parts Workspace",
    subtitle: "Reorder consumables, review PM kit suggestions, and track dealership fulfillment status.",
  },
  {
    prefix: "/portal/deals",
    eyebrow: "Customer operating room",
    title: "Opportunity Room",
    subtitle: "Follow the active commercial path with clear status, next action, and quote linkage.",
  },
  {
    prefix: "/portal/documents",
    eyebrow: "Customer operating room",
    title: "Document Library",
    subtitle: "Access manuals, portal-released documents, and equipment paperwork from one customer-safe library.",
  },
  {
    prefix: "/portal",
    eyebrow: "Customer operating room",
    title: "Fleet Command",
    subtitle: "See live machine status, warranty posture, service readiness, and next actions across your fleet.",
  },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const meta = ROUTE_META.find((item) =>
    item.prefix === "/portal"
      ? location.pathname === "/portal"
      : location.pathname.startsWith(item.prefix),
  ) ?? ROUTE_META[ROUTE_META.length - 1];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(243,129,34,0.12),_transparent_30%),linear-gradient(180deg,_#0f1729_0%,_#10192d_52%,_#0f1729_100%)]">
      <header className="border-b border-white/10 bg-[#10192d]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-qep-orange shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                  <span className="text-sm font-bold text-white">QEP</span>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">{meta.eyebrow}</p>
                  <p className="text-sm font-semibold text-white/90">Customer Portal</p>
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{meta.title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">{meta.subtitle}</p>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="flex items-center gap-2">
                <AskIronAdvisorButton
                  contextType="portal"
                  contextTitle={meta.title}
                  draftPrompt={`I’m in the portal ${meta.title} view. Tell me what matters here, what to check, and what action to take next.`}
                  preferredSurface="sheet"
                  variant="inline"
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                  label="Ask Iron"
                />
                <Link
                  to="/portal/settings"
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55">
                Customer-safe operating context stays pinned to this portal lane.
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="border-b border-white/10 bg-[#10192d]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to || (to !== "/portal" && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition ${
                  isActive
                    ? "border-qep-orange/60 bg-qep-orange/15 text-qep-orange"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
