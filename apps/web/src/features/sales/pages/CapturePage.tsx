import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapPin,
  Mic,
  Calendar,
  FileText,
  X,
  Flame,
  Wrench,
  AlertCircle,
  Truck,
  Search,
  Check,
  UserRound,
  Sparkles,
  Clock,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { LogVisitFlow } from "../components/LogVisitFlow";
import { VoiceNoteCapture } from "../components/VoiceNoteCapture";
import { ScheduleFollowUp } from "../components/ScheduleFollowUp";
import { QuickNote, type QuickNoteTag } from "../components/QuickNote";
import { fetchRepCustomers } from "../lib/sales-api";
import { cn } from "@/lib/utils";

type CaptureMode =
  | null
  | "log_visit"
  | "voice_note"
  | "schedule"
  | "quick_note";

const TYPE_ACTIONS: Array<{
  key: string;
  label: string;
  actionLabel: string;
  icon: typeof Flame;
  iconBg: string;
  iconColor: string;
  chipClass: string;
}> = [
  {
    key: "hot",
    label: "Hot Lead",
    actionLabel: "Log a Hot Lead",
    icon: Flame,
    iconBg: "bg-red-500/10",
    iconColor: "text-red-400",
    chipClass: "border-red-400/40 text-red-400 bg-red-500/10",
  },
  {
    key: "quote",
    label: "Quote Request",
    actionLabel: "Log a Quote Request",
    icon: FileText,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
    chipClass: "border-blue-400/40 text-blue-400 bg-blue-500/10",
  },
  {
    key: "service",
    label: "Service Issue",
    actionLabel: "Log a Service Issue",
    icon: Wrench,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    chipClass: "border-amber-400/40 text-amber-400 bg-amber-500/10",
  },
  {
    key: "competitor",
    label: "Competitor Intel",
    actionLabel: "Log Competitor Intel",
    icon: AlertCircle,
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-400",
    chipClass: "border-purple-400/40 text-purple-400 bg-purple-500/10",
  },
  {
    key: "trade",
    label: "Trade-In",
    actionLabel: "Log a Trade-In",
    icon: Truck,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    chipClass: "border-emerald-400/40 text-emerald-400 bg-emerald-500/10",
  },
  {
    key: "meeting",
    label: "Meeting Note",
    actionLabel: "Log a Meeting Note",
    icon: Calendar,
    iconBg: "bg-foreground/[0.06]",
    iconColor: "text-muted-foreground",
    chipClass: "border-muted-foreground/40 text-muted-foreground bg-foreground/5",
  },
];

const QUICK_DESTINATIONS = [
  {
    key: "field_note",
    icon: Mic,
    label: "Field Note",
    desc: "Record a voice note",
    href: "/sales/field-note",
    iconBg: "bg-red-500/10",
    iconColor: "text-red-400",
  },
  {
    key: "voice_quote",
    icon: Sparkles,
    label: "Voice Quote",
    desc: "Speak a quote into existence",
    href: "/sales/voice-quote",
    iconBg: "bg-qep-orange/10",
    iconColor: "text-qep-orange",
  },
  {
    key: "my_mirror",
    icon: UserRound,
    label: "My Mirror",
    desc: "Your reflection and trends",
    href: "/sales/my-mirror",
    iconBg: "bg-cyan-500/10",
    iconColor: "text-cyan-400",
  },
  {
    key: "field_note_history",
    icon: Clock,
    label: "Field Note History",
    desc: "Past voice captures",
    href: "/sales/field-note/history",
    iconBg: "bg-slate-500/10",
    iconColor: "text-slate-300",
  },
] as const;

const IN_PAGE_ACTIONS = [
  {
    key: "log_visit" as const,
    icon: MapPin,
    label: "Log Visit",
    desc: "GPS + notes",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
  },
  {
    key: "schedule" as const,
    icon: Calendar,
    label: "Schedule",
    desc: "Follow-up",
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
  },
  {
    key: "quick_note" as const,
    icon: FileText,
    label: "Quick Note",
    desc: "Text capture",
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
  },
] as const;

function MiniAvatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className="rounded-full bg-gradient-to-br from-qep-orange/80 to-qep-orange flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="text-white font-bold" style={{ fontSize: size * 0.38 }}>
        {initials}
      </span>
    </div>
  );
}

export function CapturePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CaptureMode>(null);
  const [recording, setRecording] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [noteTag, setNoteTag] = useState<QuickNoteTag | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["sales", "customers"],
    queryFn: fetchRepCustomers,
    staleTime: 5 * 60 * 1000,
  });
  const quickCustomers = (customers ?? []).slice(0, 5);

  function resetAll() {
    setMode(null);
    setRecording(false);
    setNoteTag(null);
  }

  function openTypedNote(type: (typeof TYPE_ACTIONS)[number]) {
    setNoteTag({ key: type.key, label: type.label, colorClass: type.chipClass });
    setMode("quick_note");
  }

  if (mode !== null) {
    return (
      <div className="px-5 pt-4 pb-24">
        <button
          onClick={resetAll}
          className="flex items-center gap-1 text-sm text-qep-orange font-semibold mb-4"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
        {mode === "log_visit" && <LogVisitFlow onComplete={resetAll} />}
        {mode === "voice_note" && <VoiceNoteCapture onComplete={resetAll} />}
        {mode === "schedule" && <ScheduleFollowUp onComplete={resetAll} />}
        {mode === "quick_note" && (
          <QuickNote onComplete={resetAll} tag={noteTag ?? undefined} />
        )}
      </div>
    );
  }

  return (
    <div className="pt-4 pb-24">
      <div className="px-5 pb-4">
        <h1 className="text-[22px] font-extrabold text-foreground tracking-[-0.02em] leading-tight">
          Capture
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tap to record. Iron handles the rest.
        </p>
      </div>

      <div className="px-5 pb-5">
        <button
          onClick={() => {
            if (recording) {
              setRecording(false);
              setMode("voice_note");
            } else {
              setRecording(true);
            }
          }}
          className="w-full rounded-[18px] border-none cursor-pointer flex items-center gap-4 text-left transition-all duration-200 active:scale-[0.99]"
          style={{
            padding: "20px 18px",
            background: recording
              ? "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)"
              : "linear-gradient(135deg, #E87722 0%, #FF8A3D 100%)",
            boxShadow: recording
              ? "0 12px 30px rgba(239,68,68,0.4)"
              : "0 12px 30px rgba(232,119,34,0.25)",
          }}
        >
          <div className="relative w-[60px] h-[60px] rounded-full bg-white/20 flex items-center justify-center shrink-0">
            {recording && (
              <div className="absolute -inset-1 rounded-full border-2 border-white/50 animate-ping" />
            )}
            <Mic className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-extrabold text-white tracking-[-0.01em]">
              {recording ? "Recording..." : "Hold to record"}
            </p>
            <p className="text-xs text-white/85 mt-0.5 font-medium">
              {recording
                ? "Release to transcribe"
                : "Iron auto-extracts deals, contacts, follow-ups"}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-[20px] bg-white/20 text-[10px] font-extrabold text-white uppercase tracking-[0.06em]">
            {recording ? "LIVE" : "AI"}
          </span>
        </button>
      </div>

      {quickCustomers.length > 0 && (
        <div className="px-5 pb-5">
          <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
            Attach to Customer
          </p>
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
            {quickCustomers.map((c) => {
              const active = selectedCustomer === c.customer_id;
              return (
                <button
                  key={c.customer_id}
                  onClick={() =>
                    setSelectedCustomer(active ? null : c.customer_id)
                  }
                  className={cn(
                    "shrink-0 flex items-center gap-2 py-2 pl-2 pr-3 rounded-full border transition-all duration-150",
                    active
                      ? "border-qep-orange bg-qep-orange/10"
                      : "border-white/[0.06] bg-[hsl(var(--card))]",
                  )}
                >
                  <MiniAvatar name={c.company_name} />
                  <span
                    className={cn(
                      "text-xs font-bold whitespace-nowrap",
                      active ? "text-qep-orange" : "text-foreground",
                    )}
                  >
                    {c.company_name.split(" ").slice(0, 2).join(" ")}
                  </span>
                  {active && (
                    <Check className="w-[13px] h-[13px] text-qep-orange" />
                  )}
                </button>
              );
            })}
            <button className="shrink-0 flex items-center gap-1.5 py-2 px-3 rounded-full border border-dashed border-white/[0.12] text-muted-foreground text-xs font-semibold">
              <Search className="w-3 h-3" />
              Find customer
            </button>
          </div>
        </div>
      )}

      <div className="px-5 pb-5">
        <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
          On This Page
        </p>
        <div className="grid grid-cols-3 gap-2">
          {IN_PAGE_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                onClick={() => setMode(a.key)}
                data-capture-action={a.key}
                className="flex flex-col items-center gap-1.5 py-3.5 px-1.5 rounded-[14px] border border-white/[0.06] bg-[hsl(var(--card))] hover:border-white/20 transition-all active:scale-[0.98]"
              >
                <div
                  className={`w-9 h-9 rounded-[10px] ${a.iconBg} flex items-center justify-center`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] ${a.iconColor}`}
                    strokeWidth={2.2}
                  />
                </div>
                <span className="text-[12px] font-bold text-foreground text-center leading-tight">
                  {a.label}
                </span>
                <span className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
                  {a.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-5">
        <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
          Log a Specific Type
        </p>
        <div className="grid grid-cols-3 gap-2">
          {TYPE_ACTIONS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => openTypedNote(t)}
                data-type-action={t.key}
                className="flex flex-col items-center gap-1.5 py-3.5 px-1.5 rounded-[14px] border border-white/[0.06] bg-[hsl(var(--card))] hover:border-white/20 transition-all active:scale-[0.98]"
              >
                <div
                  className={`w-9 h-9 rounded-[10px] ${t.iconBg} flex items-center justify-center`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] ${t.iconColor}`}
                    strokeWidth={2.2}
                  />
                </div>
                <span className="text-[12px] font-bold text-foreground text-center leading-tight">
                  {t.label}
                </span>
                <span className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
                  Log this
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-5">
        <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">
          Quick Destinations
        </p>
        <div className="rounded-[14px] border border-white/[0.06] bg-[hsl(var(--card))] overflow-hidden">
          {QUICK_DESTINATIONS.map((d, i) => {
            const Icon = d.icon;
            return (
              <button
                key={d.key}
                onClick={() => navigate(d.href)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.03] transition-colors active:bg-white/[0.05]",
                  i !== QUICK_DESTINATIONS.length - 1 &&
                    "border-b border-white/[0.06]",
                )}
              >
                <div
                  className={`w-9 h-9 rounded-[10px] ${d.iconBg} flex items-center justify-center shrink-0`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] ${d.iconColor}`}
                    strokeWidth={2.2}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-foreground leading-tight">
                    {d.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {d.desc}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-5 pt-3 mt-1 border-t border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em]">
            Recent Captures
          </p>
          <button className="text-[11px] text-qep-orange font-bold">
            View all
          </button>
        </div>

        {quickCustomers.length > 0 && (
          <div className="space-y-0">
            {quickCustomers.slice(0, 2).map((c, i) => (
              <div
                key={c.customer_id}
                className={`flex items-center gap-2.5 py-2.5 ${
                  i === 0 ? "border-b border-white/[0.06]" : ""
                }`}
              >
                <div className="w-8 h-8 rounded-[9px] bg-qep-orange/10 flex items-center justify-center shrink-0">
                  {i === 0 ? (
                    <Mic className="w-3.5 h-3.5 text-qep-orange" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-foreground">
                    {c.company_name}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {i === 0 ? "Voice note" : "Visit logged"}
                    {c.last_interaction ? ` · ${c.last_interaction}` : ""}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground/60 shrink-0">
                  {c.days_since_contact != null
                    ? `${c.days_since_contact}d ago`
                    : "Recently"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
