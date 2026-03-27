import type { UserRole } from "@/lib/database.types";

interface DashboardPageProps {
  userRole: UserRole;
  userEmail: string | null;
}

export function DashboardPage({ userRole, userEmail }: DashboardPageProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
      <p className="text-muted-foreground mt-1">
        Welcome back{userEmail ? `, ${userEmail}` : ""}. Role: {userRole}.
      </p>
    </div>
  );
}
