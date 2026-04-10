import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, Loader2 } from "lucide-react";

export function PortalAuthGate({ children }: { children: React.ReactNode }) {
  const gateQuery = useQuery({
    queryKey: ["portal", "auth-gate"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id ?? null;
      if (!userId) {
        return { allowed: false, reason: "You need to sign in to access the customer portal." };
      }

      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => {
              maybeSingle: () => Promise<{ data: { id: string } | null; error: { message?: string } | null }>;
            };
          };
        };
      })
        .from("portal_customers")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message ?? "Portal access check failed.");
      }

      return {
        allowed: Boolean(data?.id),
        reason: data?.id ? null : "This account is not registered as a portal customer.",
      };
    },
    staleTime: 60_000,
  });

  if (gateQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-qep-orange" />
          <p className="mt-3 text-sm text-muted-foreground">Checking portal access…</p>
        </div>
      </div>
    );
  }

  if (gateQuery.isError || !gateQuery.data?.allowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <Card className="max-w-md border-amber-500/20 bg-amber-500/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
            <div>
              <p className="text-sm font-semibold text-foreground">Portal access unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {gateQuery.error instanceof Error
                  ? gateQuery.error.message
                  : gateQuery.data?.reason ?? "Portal access is restricted to registered customers."}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => {
                  void supabase.auth.signOut();
                }}
              >
                Sign in with a different account
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
