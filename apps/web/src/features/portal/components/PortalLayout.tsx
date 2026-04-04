import { Link, useLocation } from "react-router-dom";
import { Boxes, FileText, Package, Receipt, Settings, Wrench } from "lucide-react";

const NAV_ITEMS = [
  { to: "/portal", icon: Boxes, label: "Fleet" },
  { to: "/portal/service", icon: Wrench, label: "Service" },
  { to: "/portal/parts", icon: Package, label: "Parts" },
  { to: "/portal/invoices", icon: Receipt, label: "Invoices" },
  { to: "/portal/quotes", icon: FileText, label: "Quotes" },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-qep-orange flex items-center justify-center">
              <span className="text-sm font-bold text-white">QEP</span>
            </div>
            <span className="text-sm font-semibold text-foreground">Customer Portal</span>
          </div>
          <Link to="/portal/settings" className="text-muted-foreground hover:text-foreground">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </header>

      {/* Nav */}
      <nav className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-5xl flex gap-1 overflow-x-auto px-4 sm:px-6">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to || (to !== "/portal" && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition border-b-2 ${
                  isActive
                    ? "border-qep-orange text-qep-orange"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
