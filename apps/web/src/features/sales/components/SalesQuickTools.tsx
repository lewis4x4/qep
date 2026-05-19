import { Link } from "react-router-dom";
import {
  ArrowRight,
  Radio,
  MapPinned,
  Wrench,
  PlusCircle,
  type LucideIcon,
} from "lucide-react";

interface Tool {
  to: string;
  label: string;
  subLabel: string;
  icon: LucideIcon;
}

const TOOLS: Tool[] = [
  {
    to: "/sales/capture",
    label: "Voice note",
    subLabel: "Capture field context fast",
    icon: Radio,
  },
  {
    to: "/qrm/opportunity-map",
    label: "Prospecting map",
    subLabel: "Upload UCC CSV, route next stop",
    icon: MapPinned,
  },
  {
    to: "/service/intake",
    label: "Service request",
    subLabel: "Open intake without leaving",
    icon: Wrench,
  },
  {
    to: "/sales/customers?new=1",
    label: "Add customer",
    subLabel: "Create or find an account",
    icon: PlusCircle,
  },
];

export function SalesQuickTools() {
  return (
    <section
      data-testid="sales-quick-tools"
      className="rounded-2xl border border-white/[0.06] bg-[hsl(var(--card))] p-4"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Advisor Quick Tools
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOOLS.map((tool) => (
          <QuickToolLink key={tool.to} tool={tool} />
        ))}
      </div>
    </section>
  );
}

function QuickToolLink({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  return (
    <Link
      to={tool.to}
      aria-label={tool.label}
      className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 transition-all hover:border-qep-orange/40 hover:bg-qep-orange/[0.08] active:scale-[0.98]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-qep-orange/15 text-qep-orange">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-foreground">
            {tool.label}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {tool.subLabel}
          </span>
        </span>
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
    </Link>
  );
}
