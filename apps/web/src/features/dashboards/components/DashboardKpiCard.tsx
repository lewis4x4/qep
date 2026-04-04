import { Card } from "@/components/ui/card";

interface DashboardKpiCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: string;
  icon?: React.ReactNode;
}

export function DashboardKpiCard({ label, value, sublabel, accent = "text-foreground", icon }: DashboardKpiCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
      {sublabel && <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
    </Card>
  );
}
