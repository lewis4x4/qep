import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortalLayout } from "../components/PortalLayout";
import { supabase } from "@/lib/supabase";

export function PortalSettingsPage() {
  const { data: email } = useQuery({
    queryKey: ["portal", "session-email"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.email ?? null;
    },
    staleTime: 60_000,
  });

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Account</h1>
      <Card className="p-4 space-y-3 max-w-md">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Signed in as</p>
          <p className="text-sm font-medium text-foreground break-all">{email ?? "—"}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage notification preferences and profile details with your dealership contact for now.
        </p>
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
