import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Users,
  Mic,
  MessageSquare,
  Settings,
  BarChart2,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/lib/database.types";
import { RecentActivityFeed } from "./RecentActivityFeed";
import { SalesCommandCenter } from "./SalesCommandCenter";

interface DashboardPageProps {
  userId: string;
  userRole: UserRole;
  userEmail: string | null;
  userName: string | null;
}

interface StatCounts {
  documents: number;
  teamMembers: number;
  voiceCaptures: number;
}

interface QuickAction {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  roles: UserRole[];
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "QRM Chat",
    description: "Ask QRM questions about accounts, deals, field signals, and operating context.",
    icon: MessageSquare,
    href: "/chat",
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Voice Capture",
    description: "Record field visits and turn the signal into usable QRM follow-through.",
    icon: Mic,
    href: "/voice",
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Quote Builder",
    description: "Build quote-ready proposals with QRM context and next-move clarity.",
    icon: FileText,
    href: "/quote",
    roles: ["rep", "manager", "owner"],
  },
  {
    label: "Admin",
    description: "Manage documents, users, and system settings.",
    icon: Settings,
    href: "/admin",
    roles: ["admin", "manager", "owner"],
  },
];

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const STAT_ZERO_MESSAGES: Record<string, string> = {
  Documents: "No documents uploaded yet",
  "Team Members": "No team members yet",
  "Voice Captures": "No recordings yet",
  Quotes: "No quotes generated yet",
};

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  navigable: boolean;
}

function StatCard({ label, value, icon: Icon, href, navigable }: StatCardProps) {
  const navigate = useNavigate();
  const zeroMsg = STAT_ZERO_MESSAGES[label];

  return (
    <Card
      onClick={navigable ? () => navigate(href) : undefined}
      className={
        navigable
          ? "cursor-pointer transition-shadow duration-150 hover:shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
          : undefined
      }
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-[hsl(var(--qep-orange))]" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value === 0 && zeroMsg ? (
          <p className="text-xs text-muted-foreground italic">{zeroMsg}</p>
        ) : (
          <p className="text-3xl font-bold text-foreground">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage({ userId, userRole, userEmail, userName }: DashboardPageProps) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<StatCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);

  const showCommandCenter = ["rep", "manager", "owner"].includes(userRole);

  useEffect(() => {
    if (showCommandCenter) return;
    let cancelled = false;
    async function fetchCounts() {
      try {
        const [docsResult, membersResult, voiceResult] = await Promise.all([
          supabase
            .from("documents")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase.from("voice_captures").select("id", { count: "exact", head: true }),
        ]);
        if (cancelled) return;
        setCounts({
          documents: docsResult.count ?? 0,
          teamMembers: membersResult.count ?? 0,
          voiceCaptures: voiceResult.count ?? 0,
        });
      } catch {
        // Counts are best-effort; silently degrade
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    }
    void fetchCounts();
    return () => { cancelled = true; };
  }, [showCommandCenter]);

  const greeting = useMemo(() => getTimeGreeting(), []);

  const firstName = useMemo(() => {
    if (userName) return userName.split(" ")[0];
    return userEmail?.split("@")[0] ?? "there";
  }, [userName, userEmail]);

  const canViewTeam = ["admin", "manager", "owner"].includes(userRole);

  if (showCommandCenter) {
    return (
      <SalesCommandCenter
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        userRole={userRole}
      />
    );
  }

  const statCards = [
    {
      label: "Documents",
      value: counts?.documents ?? 0,
      icon: FileText,
      href: "/admin",
      navigable: canViewTeam,
    },
    {
      label: "Team Members",
      value: counts?.teamMembers ?? 0,
      icon: Users,
      href: "/admin",
      navigable: canViewTeam,
    },
    {
      label: "Voice Captures",
      value: counts?.voiceCaptures ?? 0,
      icon: Mic,
      href: "/voice",
      navigable: true,
    },
    {
      label: "Quotes",
      value: 0,
      icon: BarChart2,
      href: "/quote",
      navigable: ["rep", "manager", "owner"].includes(userRole),
    },
  ];

  const visibleActions = QUICK_ACTIONS.filter((a) => a.roles.includes(userRole));

  return (
    <div className="p-6 max-w-6xl mx-auto bg-qep-bg min-h-full">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting}, {firstName}.
        </h1>
        <p className="text-muted-foreground mt-1">QRM home for attention, signal, and the next move.</p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card className="border-border bg-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What matters now</p>
            <p className="mt-2 text-sm text-foreground">
              {showCommandCenter
                ? "Use the command surface to spot pressured deals, fresh field notes, and stalled follow-up."
                : "Check fresh uploads, team activity, and voice capture volume before diving deeper."}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next move</p>
            <p className="mt-2 text-sm text-foreground">
              Start with the surface that reduces uncertainty fastest, then move the deal or task forward immediately.
            </p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk if ignored</p>
            <p className="mt-2 text-sm text-foreground">
              If home becomes a list of surfaces instead of an operating brief, field signal and quote pressure drift apart again.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {loadingCounts
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-6 animate-pulse space-y-4"
              >
                <div className="h-3 bg-muted rounded w-1/2" />
                <div className="h-8 bg-muted rounded w-1/3" />
              </div>
            ))
          : statCards.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
      </div>

      {/* Quick Actions */}
      <div className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">Command Surfaces</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {visibleActions.map((action) => (
            <Card key={action.href} className="flex flex-col">
              <CardHeader className="pb-3">
                <action.icon className="w-8 h-8 text-[hsl(var(--qep-orange))] mb-2" />
                <CardTitle className="text-base">{action.label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col justify-between flex-1">
                <p className="text-sm text-muted-foreground mb-4">
                  {action.description}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate(action.href)}
                  className="w-full"
                >
                  Open
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <RecentActivityFeed />
    </div>
  );
}

export default DashboardPage;
