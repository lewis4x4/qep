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

interface DashboardPageProps {
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
    label: "Knowledge Chat",
    description: "Ask questions about your equipment catalog and company knowledge base.",
    icon: MessageSquare,
    href: "/chat",
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Voice Capture",
    description: "Record field visits and automatically extract deal data.",
    icon: Mic,
    href: "/voice",
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Quote Builder",
    description: "Build and export professional equipment quotes.",
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

export function DashboardPage({ userRole, userEmail, userName }: DashboardPageProps) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<StatCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);

  useEffect(() => {
    async function fetchCounts() {
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
      setCounts({
        documents: docsResult.count ?? 0,
        teamMembers: membersResult.count ?? 0,
        voiceCaptures: voiceResult.count ?? 0,
      });
      setLoadingCounts(false);
    }
    fetchCounts();
  }, []);

  const greeting = useMemo(() => getTimeGreeting(), []);

  // First name only
  const firstName = useMemo(() => {
    if (userName) return userName.split(" ")[0];
    return userEmail?.split("@")[0] ?? "there";
  }, [userName, userEmail]);

  // Admin/manager/owner can navigate to team members
  const canViewTeam = ["admin", "manager", "owner"].includes(userRole);

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
    <div className="p-6 max-w-6xl mx-auto" style={{ background: "hsl(var(--qep-bg))" }}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {greeting}, {firstName}.
        </h1>
        <p className="text-muted-foreground mt-1">Here&apos;s your overview.</p>
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
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
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
