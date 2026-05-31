import { Link, useLocation } from "react-router-dom";
import { Award, ClipboardCheck, ChevronLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { canManageWorkforce } from "../lib/workforce-api";

const LINKS = [
  { to: "/workforce/appraisals", label: "Appraisals", icon: ClipboardCheck },
  { to: "/workforce/pay-ladder", label: "Pay Ladder", icon: Award },
] as const;

const pillBase = cn(
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none tracking-wide transition-all",
  "border-border/50 bg-white/60 text-muted-foreground shadow-sm hover:border-border hover:bg-white hover:text-foreground",
  "dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/[0.18] dark:hover:bg-white/[0.09] dark:hover:text-white",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

const pillActive = cn(
  pillBase,
  "border-primary/30 bg-gradient-to-b from-primary/[0.18] to-primary/[0.08] text-primary shadow-[0_2px_8px_rgba(232,119,34,0.15)]",
  "dark:border-primary/[0.35] dark:from-primary/[0.2] dark:to-primary/[0.08] dark:text-primary",
);

export function WorkforceSubNav() {
  const { profile } = useAuth();
  const location = useLocation();
  const isLanding = location.pathname === "/workforce";
  const manager = canManageWorkforce(profile?.role);

  return (
    <nav
      aria-label="Workforce section navigation"
      className={cn(
        "flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto rounded-2xl border border-border/40 bg-white/40 p-1.5 backdrop-blur-md",
        "shadow-[0_1px_3px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] scrollbar-thin scrollbar-thumb-border/50",
        "dark:border-white/[0.07] dark:bg-white/[0.025]",
      )}
    >
      {!isLanding && (
        <Link to="/workforce" className={pillBase} aria-label="Back to Workforce command center">
          <ChevronLeft className="h-3.5 w-3.5" />
          Workforce
        </Link>
      )}
      {LINKS.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
        return (
          <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={active ? pillActive : pillBase}>
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
      {manager && (
        <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="h-3 w-3" />
          Manager scope
        </span>
      )}
    </nav>
  );
}
