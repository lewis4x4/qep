import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Wrench, Calendar, Shield } from "lucide-react";

export function PortalFleetPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "fleet"],
    queryFn: portalApi.getFleet,
    staleTime: 30_000,
  });

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">My Equipment Fleet</h1>

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>}
      {isError && <Card className="p-6 text-center"><p className="text-sm text-red-400">Failed to load fleet.</p></Card>}

      <div className="space-y-3">
        {(data?.fleet ?? []).map((item: any) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{item.make} {item.model} {item.year && `(${item.year})`}</p>
                {item.serial_number && <p className="text-xs text-muted-foreground">S/N: {item.serial_number}</p>}
                {item.current_hours && <p className="text-xs text-muted-foreground">{item.current_hours.toLocaleString()} hours</p>}
              </div>
              <div className="text-right space-y-1">
                {item.warranty_expiry && (
                  <div className="flex items-center gap-1 text-xs">
                    <Shield className={`h-3 w-3 ${new Date(item.warranty_expiry) > new Date() ? "text-emerald-400" : "text-red-400"}`} />
                    <span className="text-muted-foreground">Warranty: {item.warranty_expiry}</span>
                  </div>
                )}
                {item.next_service_due && (
                  <div className="flex items-center gap-1 text-xs">
                    <Wrench className="h-3 w-3 text-amber-400" />
                    <span className="text-muted-foreground">Service: {item.next_service_due}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        {!isLoading && (data?.fleet ?? []).length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No equipment in your fleet yet.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
