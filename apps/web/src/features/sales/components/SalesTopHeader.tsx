import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, User, LogOut, Moon, Sun, Monitor, Bug, Plus, BellOff, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { SalesGlobalSearch } from "./SalesGlobalSearch";
import { QbNotificationBell } from "@/components/QbNotificationBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "@/hooks/use-toast";

type AvailabilityMutedChannel = "sms" | "eight_by_eight" | null;

interface AvailabilityAlertPreference {
  mutedChannel: AvailabilityMutedChannel;
  mutedUntil: string | null;
}

function normalizeAvailabilityAlertPreference(
  value: unknown,
  fallbackChannel: AvailabilityMutedChannel = null,
): AvailabilityAlertPreference {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") {
    return { mutedChannel: fallbackChannel, mutedUntil: null };
  }

  const row = candidate as { muted_channel?: unknown; muted_until?: unknown };
  const mutedChannel = row.muted_channel === "sms" || row.muted_channel === "eight_by_eight"
    ? row.muted_channel
    : null;

  return {
    mutedChannel,
    mutedUntil: typeof row.muted_until === "string" ? row.muted_until : null,
  };
}

export function SalesTopHeader() {
  const { profile } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [availabilityAlertPreference, setAvailabilityAlertPreference] = useState<
    AvailabilityAlertPreference | undefined
  >(undefined);
  const [availabilityAlertLoadError, setAvailabilityAlertLoadError] = useState<string | null>(null);
  const [availabilityAlertSaving, setAvailabilityAlertSaving] = useState(false);
  const availabilityAlertLoadGenerationRef = useRef(0);
  const availabilityAlertLoadInFlightRef = useRef(false);
  const availabilityAlertSaveInFlightRef = useRef(false);
  const { setPreference, preference: theme } = useTheme();

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  const loadAvailabilityAlertPreference = useCallback(async () => {
    if (!profile?.id || availabilityAlertSaveInFlightRef.current) return;
    if (availabilityAlertLoadInFlightRef.current) return;

    const generation = ++availabilityAlertLoadGenerationRef.current;
    availabilityAlertLoadInFlightRef.current = true;
    setAvailabilityAlertPreference(undefined);
    setAvailabilityAlertLoadError(null);

    try {
      const { data, error } = await supabase
        .from("sales_availability_alert_preferences")
        .select("muted_channel, muted_until")
        .eq("user_id", profile.id)
        .maybeSingle();

      if (generation !== availabilityAlertLoadGenerationRef.current) return;

      if (error) {
        setAvailabilityAlertLoadError(error.message);
        return;
      }

      let preference = normalizeAvailabilityAlertPreference(data);

      if (preference.mutedChannel !== null && preference.mutedUntil !== null) {
        const { data: reconciledData, error: reconcileError } = await supabase.rpc(
          "reconcile_my_sales_availability_alert_mute_expiry" as never,
        );

        if (generation !== availabilityAlertLoadGenerationRef.current) return;

        if (reconcileError) {
          setAvailabilityAlertLoadError(reconcileError.message);
          return;
        }

        preference = normalizeAvailabilityAlertPreference(reconciledData);
      }

      setAvailabilityAlertPreference(preference);
    } catch (error) {
      if (generation !== availabilityAlertLoadGenerationRef.current) return;
      setAvailabilityAlertLoadError(error instanceof Error ? error.message : "Unable to load alert settings");
    } finally {
      if (generation === availabilityAlertLoadGenerationRef.current) {
        availabilityAlertLoadInFlightRef.current = false;
      }
    }
  }, [profile?.id]);

  useEffect(() => {
    void loadAvailabilityAlertPreference();
    return () => {
      availabilityAlertLoadGenerationRef.current += 1;
      availabilityAlertLoadInFlightRef.current = false;
    };
  }, [loadAvailabilityAlertPreference]);

  useEffect(() => {
    if (
      availabilityAlertPreference?.mutedChannel === null
      || !availabilityAlertPreference?.mutedUntil
    ) {
      return;
    }

    const mutedUntilMs = Date.parse(availabilityAlertPreference.mutedUntil);
    const clientDelay = Number.isFinite(mutedUntilMs)
      ? mutedUntilMs - Date.now()
      : 30_000;
    const pollDelay = Math.min(Math.max(clientDelay, 30_000), 60_000);
    const timer = window.setTimeout(() => {
      void loadAvailabilityAlertPreference();
    }, pollDelay);

    return () => window.clearTimeout(timer);
  }, [
    availabilityAlertPreference?.mutedChannel,
    availabilityAlertPreference?.mutedUntil,
    loadAvailabilityAlertPreference,
  ]);

  async function setAvailabilityAlertMute(channel: AvailabilityMutedChannel) {
    if (
      !availabilityAlertPreference
      || availabilityAlertSaveInFlightRef.current
    ) {
      return;
    }

    availabilityAlertSaveInFlightRef.current = true;
    availabilityAlertLoadGenerationRef.current += 1;
    availabilityAlertLoadInFlightRef.current = false;
    setAvailabilityAlertSaving(true);

    try {
      const { data, error } = await supabase.rpc(
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

      setAvailabilityAlertPreference(normalizeAvailabilityAlertPreference(data, channel));
      setAvailabilityAlertLoadError(null);

      toast({
        title: channel === null ? "Both alert channels enabled" : `${channel === "sms" ? "SMS" : "8x8"} muted`,
        description: channel === null
          ? "Availability alerts will queue for SMS and 8x8."
          : "The other availability alert channel remains enabled.",
      });
    } catch (error) {
      toast({
        title: "Alert preference not saved",
        description: error instanceof Error ? error.message : "Unexpected alert preference error",
        variant: "destructive",
      });
    } finally {
      availabilityAlertSaveInFlightRef.current = false;
      setAvailabilityAlertSaving(false);
    }
  }

  const availabilityAlertChoice = availabilityAlertPreference?.mutedChannel === null
    ? "all"
    : availabilityAlertPreference?.mutedChannel;
  const temporaryMuteEndsAt = availabilityAlertPreference?.mutedUntil
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(availabilityAlertPreference.mutedUntil))
    : null;

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

          <DropdownMenu
            onOpenChange={(open) => {
              if (open) void loadAvailabilityAlertPreference();
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`${initials ? `${initials} user menu` : "User menu"}${
                  availabilityAlertSaving ? ", saving alert preference" : ""
                }`}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
              >
                {availabilityAlertSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden="true" />
                ) : initials ? (
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
                <DropdownMenuSubTrigger className="min-h-[44px]">
                  <BellOff className="w-4 h-4 mr-2" />
                  Availability alerts
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-56">
                  {availabilityAlertPreference ? (
                    <>
                      {availabilityAlertSaving && (
                        <DropdownMenuItem disabled className="min-h-[44px]">
                          Saving alert preference…
                        </DropdownMenuItem>
                      )}
                      {temporaryMuteEndsAt && (
                        <div className="px-2 py-2 text-xs text-muted-foreground" role="note">
                          Temporary mute ends {temporaryMuteEndsAt}
                        </div>
                      )}
                      <DropdownMenuRadioGroup
                        value={availabilityAlertChoice}
                        onValueChange={(choice) => {
                          const channel = choice === "all"
                            ? null
                            : choice as Exclude<AvailabilityMutedChannel, null>;
                          void setAvailabilityAlertMute(channel);
                        }}
                      >
                        <DropdownMenuRadioItem
                          value="all"
                          disabled={availabilityAlertSaving}
                          className="min-h-[44px]"
                        >
                          Use SMS + 8x8
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="sms"
                          disabled={availabilityAlertSaving}
                          className="min-h-[44px]"
                        >
                          Mute SMS
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="eight_by_eight"
                          disabled={availabilityAlertSaving}
                          className="min-h-[44px]"
                        >
                          Mute 8x8
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </>
                  ) : (
                    availabilityAlertLoadError ? (
                      <DropdownMenuItem
                        className="min-h-[44px]"
                        onClick={() => void loadAvailabilityAlertPreference()}
                      >
                        Retry alert settings
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled className="min-h-[44px]">
                        Loading alert settings…
                      </DropdownMenuItem>
                    )
                  )}
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
          <span className="sr-only" role="status" aria-live="polite">
            {availabilityAlertSaving ? "Saving availability alert preference" : ""}
          </span>
        </div>
      </header>

      {searchOpen && (
        <SalesGlobalSearch onClose={() => setSearchOpen(false)} />
      )}
    </>
  );
}
