import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, User, LogOut, Moon, Sun, Monitor, Bug, Plus, BellOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { SalesGlobalSearch } from "./SalesGlobalSearch";
import { QbNotificationBell } from "@/components/QbNotificationBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "@/hooks/use-toast";

type AvailabilityMutedChannel = "sms" | "eight_by_eight" | null;

export function SalesTopHeader() {
  const { profile } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const { setPreference, preference: theme } = useTheme();

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  async function setAvailabilityAlertMute(channel: AvailabilityMutedChannel) {
    const { error } = await supabase.rpc(
      "set_sales_availability_alert_mute" as never,
      { p_channel: channel, p_muted_until: null } as never,
    );

    if (error) {
      toast({
        title: "Alert preference not saved",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: channel === null ? "Both alert channels enabled" : `${channel === "sms" ? "SMS" : "8x8"} muted`,
      description: channel === null
        ? "Availability alerts will queue for SMS and 8x8."
        : "The other availability alert channel remains enabled.",
    });
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-[hsl(var(--qep-dark))] border-b border-white/10">
        {/* Left: brand */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-qep-orange flex items-center justify-center">
            <span className="text-slate-950 font-bold text-sm">QEP</span>
          </div>
          <span className="text-white font-semibold text-sm">
            Sales Companion
          </span>
        </div>

        {/* Right: search + avatar */}
        <div className="flex items-center gap-3">
          <Link
            to="/sales/capture"
            aria-label="Quick log activity"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-qep-orange/40 bg-qep-orange/10 px-3 text-xs font-bold text-qep-orange-accessible transition-colors hover:bg-qep-orange/20"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Quick log</span>
          </Link>
          <button
            onClick={() => setSearchOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </button>

          <QbNotificationBell tone="dark" iconClassName="w-5 h-5" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={initials ? `${initials} user menu` : "User menu"}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
              >
                {initials ? (
                  <span className="text-white text-xs font-semibold">
                    {initials}
                  </span>
                ) : (
                  <User className="w-4 h-4 text-white/70" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {profile?.full_name && (
                <>
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-semibold text-foreground">
                      {profile.full_name}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {theme === "dark" ? (
                    <Moon className="w-4 h-4 mr-2" />
                  ) : theme === "light" ? (
                    <Sun className="w-4 h-4 mr-2" />
                  ) : (
                    <Monitor className="w-4 h-4 mr-2" />
                  )}
                  Appearance
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setPreference("light")}>
                    <Sun className="w-4 h-4 mr-2" />
                    Light
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPreference("dark")}>
                    <Moon className="w-4 h-4 mr-2" />
                    Dark
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPreference("system")}>
                    <Monitor className="w-4 h-4 mr-2" />
                    System
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <BellOff className="w-4 h-4 mr-2" />
                  Availability alerts
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => void setAvailabilityAlertMute(null)}>
                    Use SMS + 8x8
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void setAvailabilityAlertMute("sms")}>
                    Mute SMS
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void setAvailabilityAlertMute("eight_by_eight")}>
                    Mute 8x8
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                onClick={() => {
                  // Trigger the Flare bug reporter (same as Ctrl+Shift+B)
                  const w = window as Window & { flare?: (sev?: string) => void };
                  if (typeof w.flare === "function") {
                    w.flare("bug");
                  }
                }}
              >
                <Bug className="w-4 h-4 mr-2" />
                Report a Bug
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => supabase.auth.signOut()}
                className="text-red-400 focus:text-red-400"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {searchOpen && (
        <SalesGlobalSearch onClose={() => setSearchOpen(false)} />
      )}
    </>
  );
}
