import { Link, useLocation } from "react-router-dom";
import {
  Package,
  ShoppingCart,
  Truck,
  BarChart3,
  GitBranch,
  Boxes,
  Lightbulb,
  ExternalLink,
  Wrench,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const SUB_NAV_LINKS = [
  { to: "/service/parts", label: "Parts Queue", icon: Package },
  { to: "/service/portal-parts", label: "Portal Orders", icon: ShoppingCart },
  { to: "/service/vendors", label: "Vendors", icon: Truck },
  { to: "/service/efficiency", label: "Efficiency", icon: BarChart3 },
] as const;

const ADMIN_LINKS = [
  { to: "/service/branches", label: "Branches", icon: GitBranch },
  { to: "/service/inventory", label: "Inventory", icon: Boxes },
  { to: "/service/job-code-suggestions", label: "Job Codes", icon: Lightbulb },
] as const;

export function ServiceSubNav() {
  const { profile } = useAuth();
  const location = useLocation();
  const isAdmin = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const isCommandCenter = location.pathname === "/service";

  return (
    <nav
      aria-label="Service section navigation"
      className="flex flex-wrap items-center gap-2"
    >
      {/* Back to command center (shown on sub-pages only) */}
      {!isCommandCenter && (
        <Link
          to="/service"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            "dark:bg-white/[0.06] dark:hover:bg-white/[0.1]",
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Command Center
        </Link>
      )}

      {!isCommandCenter && (
        <div className="mx-0.5 h-4 w-px bg-border/60 dark:bg-white/10" />
      )}

      {SUB_NAV_LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            location.pathname === link.to
              ? "bg-primary/10 text-primary ring-1 ring-primary/20"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          )}
        >
          <link.icon className="h-3.5 w-3.5" />
          {link.label}
        </Link>
      ))}

      {isAdmin && (
        <>
          <div className="mx-0.5 h-4 w-px bg-border/60 dark:bg-white/10" />
          {ADMIN_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                location.pathname === link.to
                  ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
              )}
            >
              <link.icon className="h-3.5 w-3.5" />
              {link.label}
            </Link>
          ))}
        </>
      )}

      <Link
        to="/service/track"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
          location.pathname === "/service/track"
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
        )}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Track Job
      </Link>
    </nav>
  );
}
