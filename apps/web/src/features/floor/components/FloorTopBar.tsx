/**
 * FloorTopBar — the identity row at the top of The Floor.
 *
 * 56px fixed height. Left: QEP gear mark + "The Floor". Right: user
 * name + role label + sign-out. No navigation links in v1 — the Floor
 * is a landing surface, not a navigation chrome.
 */
import { Link } from "react-router-dom";
import { LogOut, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { FloorJumpMenu } from "./FloorJumpMenu";

export interface FloorTopBarProps {
  userDisplayName: string;
  roleDisplayName: string;
  /** Admin-only — shows the "Compose" link into the composer. */
  isAdmin: boolean;
}

export function FloorTopBar({
  userDisplayName,
  roleDisplayName,
  isAdmin,
}: FloorTopBarProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.assign("/login");
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 backdrop-blur-sm">
      {/* Left — wordmark */}
      <Link to="/floor" className="flex items-center gap-2 transition-opacity hover:opacity-90">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-sm bg-[hsl(var(--qep-orange))] text-[hsl(var(--qep-dark))] shadow-sm"
        >
          <Wrench className="h-3.5 w-3.5" />
        </span>
        <span className="font-display text-lg leading-none tracking-[0.06em] text-foreground">
          THE FLOOR
        </span>
      </Link>

      {/* Right — jump menu + user identity + admin link + sign-out */}
      <div className="flex items-center gap-3">
        {/* Jump-to dropdown — minimal escape to the 5 operator domains */}
        <div className="hidden sm:block">
          <FloorJumpMenu />
        </div>
        {isAdmin && (
          <Link
            to="/floor/compose"
            className="hidden rounded-md border border-[hsl(var(--qep-deck-rule))] px-2.5 py-1.5 font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))] transition-colors hover:border-[hsl(var(--qep-orange))] hover:text-[hsl(var(--qep-orange))] sm:inline-flex"
          >
            Compose
          </Link>
        )}
        <div className="hidden flex-col items-end leading-tight sm:flex">
          <span className="truncate text-sm font-semibold text-foreground" title={userDisplayName}>
            {userDisplayName}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {roleDisplayName}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSignOut}
          aria-label="Sign out"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
