import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import { supabase } from "@/lib/supabase";
import { Bell, Mail, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";

export function PortalSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "settings"],
    queryFn: portalApi.getSettings,
    staleTime: 60_000,
  });

  const customer = data?.customer;
  const notifications = data?.notifications ?? [];
  const [emailEnabled, setEmailEnabled] = useState<boolean>(customer?.notification_preferences.email ?? true);
  const [smsEnabled, setSmsEnabled] = useState<boolean>(customer?.notification_preferences.sms ?? false);

  useEffect(() => {
    if (!customer) return;
    setEmailEnabled(customer.notification_preferences.email);
    setSmsEnabled(customer.notification_preferences.sms);
  }, [customer?.id, customer?.notification_preferences.email, customer?.notification_preferences.sms]);

  const updateMutation = useMutation({
    mutationFn: (notification_preferences: { email: boolean; sms: boolean }) =>
      portalApi.updateSettings({ notification_preferences }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "settings"] });
    },
  });

  const prefsDirty =
    emailEnabled !== (customer?.notification_preferences.email ?? true) ||
    smsEnabled !== (customer?.notification_preferences.sms ?? false);

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Account</h1>
      <Card className="p-4 space-y-4 max-w-2xl">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Signed in as</p>
          <p className="text-sm font-medium text-foreground break-all">
            {customer ? `${customer.first_name} ${customer.last_name}` : "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{customer?.email ?? "—"}</p>
          {customer?.phone ? <p className="text-xs text-muted-foreground">{customer.phone}</p> : null}
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-qep-orange" />
            <p className="text-sm font-medium text-foreground">Notification preferences</p>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-400" />
              <div>
                <p className="text-sm text-foreground">Email updates</p>
                <p className="text-xs text-muted-foreground">Service status, quote-ready, invoice-ready, and parts-shipped alerts.</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--qep-orange,#f97316)]"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-400" />
              <div>
                <p className="text-sm text-foreground">SMS updates</p>
                <p className="text-xs text-muted-foreground">Reserved for future portal dispatch. Save now to opt in ahead of rollout.</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--qep-orange,#f97316)]"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!prefsDirty || updateMutation.isPending}
              onClick={() => updateMutation.mutate({ email: emailEnabled, sms: smsEnabled })}
            >
              {updateMutation.isPending ? "Saving…" : "Save preferences"}
            </Button>
            {updateMutation.isError && (
              <p className="text-xs text-destructive">Could not save preferences.</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Recent notifications</p>
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-md bg-muted/30" />
              <div className="h-12 animate-pulse rounded-md bg-muted/30" />
            </div>
          ) : notifications.length > 0 ? (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div key={notification.id} className="rounded-md border border-border/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{notification.label}</p>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{notification.channel}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{notification.detail}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(notification.occurred_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent customer notifications yet.</p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void supabase.auth.signOut();
          }}
        >
          Sign out
        </Button>
      </Card>
    </PortalLayout>
  );
}
