import { useLocation, Link } from "react-router-dom";
import { ArrowLeft, Wrench } from "lucide-react";
import { OmniCommand } from "@/components/OmniCommand";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import { TopBar } from "@/components/TopBar";
import { AmbientMatrix } from "@/components/primitives/AmbientMatrix";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  iron_role: string | null;
  iron_role_display: string | null;
  is_support: boolean;
  /** Nullable to match useAuth.Profile — Slice 08 M4 fix. */
  active_workspace_id: string | null;
  /** Slice: The Floor — when true, the user opted into the /floor
   *  simplified surface. AppLayout renders a persistent "Back to Floor"
   *  chip so the user can always return home from any admin route. */
  floor_mode?: boolean;
}

export interface AppLayoutProps {
  profile: Profile;
  onLogout: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
  children: React.ReactNode;
}

export function AppLayout({
  profile,
  onLogout,
  quoteBuilderEnabled,
  quoteBuilderLoading,
  children,
}: AppLayoutProps) {
  const location = useLocation();
  const embeddedMode = new URLSearchParams(location.search).get("embedded") === "1";
  const quoteWorkspaceRoute = location.pathname === "/quote-v2" || location.pathname.startsWith("/quote-v2/");
  const floorRoute = location.pathname === "/floor" || location.pathname.startsWith("/floor/");
  const showBackToFloorChip = Boolean(profile.floor_mode && !floorRoute && !quoteWorkspaceRoute);

  if (embeddedMode) {
    return (
      <div className="min-h-screen bg-transparent">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-transparent relative z-0">
      <AmbientMatrix />

      {/* Slice: The Floor — Back-to-Floor chip for users who opted in.
          Renders on admin surfaces (anything that isn't /floor/*),
          except the quote workspace where the page header owns the
          return link to avoid duplicate Back-to-Floor chrome. The chip
          is visually compact and styled to feel like Floor chrome —
          orange gear mark + uppercase Bebas Neue — so the user's eye
          tracks it instantly. The chip stays off /floor itself because
          the QEP wordmark is the home affordance there. */}
      {showBackToFloorChip && <BackToFloorChip />}

      <TopBar
        profile={profile}
        onLogout={onLogout}
        quoteBuilderEnabled={quoteBuilderEnabled}
        quoteBuilderLoading={quoteBuilderLoading}
        floorMode={showBackToFloorChip}
      />

      {/* Main content */}
      {/* pt clears the shared fixed TopBar; no separate mobile header or bottom tabs. */}
      {/* When floor_mode is on, a 36px chip is pinned above TopBar; add clearance. */}
      <main
        className={cn(
          "flex-1 min-h-screen pb-8",
          showBackToFloorChip
            ? "pt-[132px] xl:pt-[140px]"
            : "pt-[96px] xl:pt-[104px]",
        )}
      >
        {children}
      </main>

      {/* Global Cmd-K command palette */}
      <OmniCommand role={profile.role} />
    </div>
  );
}

export default AppLayout;

/**
 * BackToFloorChip — persistent one-line chip that keeps a Floor-mode
 * user tethered to their home surface.
 *
 * Sits as a full-width strip at the very top of the app (above TopBar
 * across compact and desktop layouts). Styled to
 * feel like Floor chrome — charcoal base, orange gear mark, Bebas
 * Neue caps — so the user's eye tracks it instantly when they land
 * on an admin detail surface.
 */
function BackToFloorChip() {
  return (
    <div className="fixed left-0 right-0 top-0 z-50 h-9 bg-[hsl(217,28%,10%)] border-b border-[hsl(var(--qep-orange))]/30">
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between gap-2 px-4">
        <Link
          to="/floor"
          className="group inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--qep-orange))] transition-colors hover:text-[hsl(var(--qep-orange-hover))]"
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex h-4 w-4 items-center justify-center rounded-sm bg-[hsl(var(--qep-orange))] text-[hsl(217,28%,10%)]"
            >
              <Wrench className="h-2.5 w-2.5" />
            </span>
            Back to The Floor
          </span>
        </Link>
        <span className="hidden text-[10px] uppercase tracking-[0.18em] text-white/40 sm:inline">
          Office view
        </span>
      </div>
    </div>
  );
}
