import { LoginPage } from "@/components/LoginPage";

export function PortalLoginPage({ authError }: { authError?: string | null }) {
  return <LoginPage mode="portal" authError={authError ?? null} />;
}
