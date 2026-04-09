import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Boxes,
  BriefcaseBusiness,
  Building2,
  FileText,
  Gauge,
  GitBranch,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { AskIronAdvisorButton } from "@/components/primitives";
import type { UserRole } from "@/lib/database.types";

interface OperatingSystemHubPageProps {
  userRole: UserRole;
}

interface ModuleCard {
  title: string;
  description: string;
  href: string;
  roles: UserRole[];
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  badge?: string;
}

const MODULES: ModuleCard[] = [
  {
    title: "QRM Hub",
    description: "Companies, contacts, deals, activity, Account 360, and operational customer context.",
    href: "/qrm",
    roles: ["rep", "admin", "manager", "owner"],
    icon: Building2,
    tone: "border-blue-500/30 bg-blue-500/5 text-blue-400",
  },
  {
    title: "Quote Builder",
    description: "Live quote workflow with tax, incentives, trade-in, and AI-assisted commercial drafting.",
    href: "/quote-v2",
    roles: ["rep", "admin", "manager", "owner"],
    icon: FileText,
    tone: "border-qep-orange/30 bg-qep-orange/5 text-qep-orange",
  },
  {
    title: "Field Note / Voice QRM",
    description: "Voice capture, structured extraction, and routing into QRM and follow-up workflows.",
    href: "/voice",
    roles: ["rep", "admin", "manager", "owner"],
    icon: MessageSquare,
    tone: "border-violet-500/30 bg-violet-500/5 text-violet-400",
  },
  {
    title: "Nervous System",
    description: "Health scoring, deltas, AR blocks, attribution, and cross-department signals.",
    href: "/nervous-system",
    roles: ["admin", "manager", "owner"],
    icon: Activity,
    tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
  },
  {
    title: "Price Intelligence",
    description: "Price-file imports, impact ranking, re-quote generation, and yard-first sourcing signals.",
    href: "/price-intelligence",
    roles: ["admin", "manager", "owner"],
    icon: Sparkles,
    tone: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  },
  {
    title: "Service Dashboard",
    description: "Operational service load, branch visibility, and cross-functional execution state.",
    href: "/service/dashboard",
    roles: ["rep", "admin", "manager", "owner"],
    icon: Wrench,
    tone: "border-cyan-500/30 bg-cyan-500/5 text-cyan-400",
  },
  {
    title: "SOP Compliance",
    description: "Execution compliance, suppression review, skip bottlenecks, and process discipline.",
    href: "/ops/sop-compliance",
    roles: ["rep", "admin", "manager", "owner"],
    icon: GitBranch,
    tone: "border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-400",
  },
  {
    title: "Data Quality",
    description: "Nightly audit issues with direct record and playbook links.",
    href: "/admin/data-quality",
    roles: ["admin", "manager", "owner"],
    icon: ShieldAlert,
    tone: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  },
  {
    title: "Exception Inbox",
    description: "Human work queue for unresolved business and integration exceptions.",
    href: "/exceptions",
    roles: ["admin", "manager", "owner"],
    icon: AlertTriangle,
    tone: "border-red-500/30 bg-red-500/5 text-red-400",
  },
  {
    title: "Executive Intelligence Center",
    description: "The live leadership control room for CEO, CFO, and COO posture, alerts, drill paths, and packet generation.",
    href: "/executive",
    roles: ["manager", "owner"],
    icon: Gauge,
    tone: "border-white/20 bg-white/5 text-white",
    badge: "Owner / Manager",
  },
  {
    title: "Parts Command Center",
    description: "Orders, fulfillment, inventory, forecast, and parts network operations.",
    href: "/parts",
    roles: ["rep", "admin", "manager", "owner"],
    icon: Boxes,
    tone: "border-slate-500/30 bg-slate-500/5 text-slate-300",
  },
  {
    title: "Fleet Radar",
    description: "Trade-up, attachment, utilization, and maintenance opportunity scanning.",
    href: "/qrm/companies",
    roles: ["admin", "manager", "owner"],
    icon: BriefcaseBusiness,
    tone: "border-lime-500/30 bg-lime-500/5 text-lime-400",
    badge: "Open a company → Fleet Radar",
  },
];

export function OperatingSystemHubPage({ userRole }: OperatingSystemHubPageProps) {
  const visibleModules = MODULES.filter((item) => item.roles.includes(userRole));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-qep-orange shadow-[0_0_10px_rgba(249,115,22,0.8)]" />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">Quality Equipment & Parts</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-medium tracking-tight text-white mb-2">Operating System</h1>
          <p className="text-lg font-light text-slate-400">
            The real live modules inside QEP OS. This is the front door to the system that has been built.
          </p>
        </div>
        <AskIronAdvisorButton contextType="os_hub" variant="inline" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {visibleModules.map((module) => {
          const Icon = module.icon;
          return (
            <Link key={module.href} to={module.href} className="block group">
              <GlassPanel className={`h-full p-6 transition-all duration-300 hover:shadow-2xl hover:border-qep-orange/50 hover:-translate-y-1 ${module.tone}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <Icon className="h-5 w-5" />
                      <h2 className="text-lg font-medium text-white">{module.title}</h2>
                    </div>
                    <p className="text-sm text-slate-400 font-light leading-relaxed">{module.description}</p>
                  </div>
                  {module.badge && (
                    <span className="shrink-0 text-[9px] font-bold tracking-[0.1em] uppercase text-slate-500 bg-white/5 px-2 py-1 rounded-md">
                      {module.badge}
                    </span>
                  )}
                </div>
              </GlassPanel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
