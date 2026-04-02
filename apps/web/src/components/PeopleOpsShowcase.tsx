import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Users,
  UserPlus,
  BookOpen,
  CheckSquare,
  GraduationCap,
  CalendarCheck,
  MessageCircle,
  BarChart3,
  TrendingUp,
  Eye,
  Target,
  Layers,
  AlertTriangle,
  Clock,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Zap,
  ChevronDown,
  Brain,
  Activity,
  Shield,
  Heart,
  ClipboardList,
  FileText,
  UserCheck,
  Bell,
  Lightbulb,
  Handshake,
  Award,
  LineChart,
  PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ───── Hooks ────────────────────────────────────── */
function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.unobserve(el); } },
      { threshold: 0.15, ...options },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [options]);
  return { ref, visible };
}

/* ───── Nav ──────────────────────────────────────── */
const NAV_SECTIONS = [
  { id: "lifecycle", label: "Workflow" },
  { id: "dashboard", label: "Dashboard" },
  { id: "value", label: "Value" },
  { id: "scale", label: "Scale" },
  { id: "future", label: "Future" },
] as const;

function StickyNav() {
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      const sections = NAV_SECTIONS.map((s) => {
        const el = document.getElementById(s.id);
        return { id: s.id, top: el ? el.getBoundingClientRect().top : Infinity };
      });
      const current = sections.filter((s) => s.top < window.innerHeight * 0.4).sort((a, b) => b.top - a.top)[0];
      setActive(current?.id ?? "");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const scrollTo = useCallback((id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);
  return (
    <nav className={cn("sticky top-0 z-50 transition-all duration-300", scrolled ? "bg-[#1C1C1C]/85 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl shadow-black/40" : "bg-transparent border-b border-transparent")}>
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-3.5 sm:px-6">
        <div className="text-lg font-extrabold tracking-tight">People<span className="text-[#B87333]">Operations</span></div>
        <div className="hidden sm:flex items-center gap-1">
          {NAV_SECTIONS.map((s) => (
            <button key={s.id} onClick={() => scrollTo(s.id)} className={cn("relative px-3.5 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200", active === s.id ? "text-[#B87333] bg-[#B87333]/[0.08]" : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]")}>
              {s.label}
              {active === s.id && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full bg-[#B87333]" />}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

/* ───── Primitives ───────────────────────────────── */
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (<div ref={ref} className={cn("transition-all duration-700 ease-out", visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8", className)} style={{ transitionDelay: `${delay}ms` }}>{children}</div>);
}

function GlassCard({ children, className, copper }: { children: React.ReactNode; className?: string; copper?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 bg-gradient-to-b from-white/[0.05] to-white/[0.02] hover:shadow-xl hover:shadow-black/30 hover:border-white/[0.15] group", copper ? "border-[#B87333]/20 hover:border-[#B87333]/35" : "border-white/[0.08]", className)}>
      {copper && <div className="absolute inset-0 bg-gradient-to-br from-[#B87333]/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
      <div className="relative">{children}</div>
    </div>
  );
}

function LifecycleStep({ number, title, description, icon: Icon, delay }: { number: number; title: string; description: string; icon: React.ElementType; delay: number }) {
  return (
    <Reveal delay={delay}>
      <GlassCard copper className="h-full">
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B87333]/20 to-[#B87333]/5 border border-[#B87333]/25"><span className="text-lg font-black text-[#B87333]">{number}</span></div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2"><Icon className="h-4 w-4 text-[#B87333]/70" /><h3 className="text-lg font-bold text-white">{title}</h3></div>
            <p className="text-sm leading-relaxed text-white/60">{description}</p>
          </div>
        </div>
      </GlassCard>
    </Reveal>
  );
}

function ValueCard({ icon: Icon, title, description, delay }: { icon: React.ElementType; title: string; description: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="group relative h-full">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#B87333]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />
        <div className="relative h-full overflow-hidden rounded-2xl border border-[#B87333]/15 bg-gradient-to-b from-[#B87333]/[0.07] to-white/[0.02] p-6 transition-all duration-300 hover:border-[#B87333]/30 hover:shadow-lg hover:shadow-[#B87333]/[0.05]">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/25 to-transparent" />
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20"><Icon className="h-5 w-5 text-[#B87333]" /></div>
          <h4 className="text-base font-bold text-white mb-2">{title}</h4>
          <p className="text-sm leading-relaxed text-white/55">{description}</p>
        </div>
      </div>
    </Reveal>
  );
}

function FutureItem({ icon: Icon, label, delay }: { icon: React.ElementType; label: string; delay: number }) {
  return (
    <Reveal delay={delay}>
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]"><Icon className="h-4 w-4 text-white/50" /></div>
        <span className="text-sm font-medium text-white/70">{label}</span>
      </div>
    </Reveal>
  );
}

/* ───── KPI Card ─────────────────────────────────── */
function KPICard({ icon: Icon, label, value, trend, trendDirection, color, delay }: { icon: React.ElementType; label: string; value: string; trend: string; trendDirection: "up" | "down" | "neutral"; color: string; delay: number }) {
  const TrendIcon = trendDirection === "up" ? ArrowUpRight : trendDirection === "down" ? ArrowDownRight : Activity;
  const trendColor = trendDirection === "up" ? "text-emerald-400" : trendDirection === "down" ? "text-red-400" : "text-white/40";
  return (
    <Reveal delay={delay}>
      <div className="group relative h-full">
        <div className="relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 transition-all duration-300 hover:border-white/[0.14] hover:shadow-lg hover:shadow-black/30">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.10] to-transparent" />
          <div className="flex items-center justify-between mb-3">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border", color === "copper" ? "bg-[#B87333]/10 border-[#B87333]/20" : color === "emerald" ? "bg-emerald-500/10 border-emerald-500/20" : color === "sky" ? "bg-sky-500/10 border-sky-500/20" : color === "amber" ? "bg-amber-500/10 border-amber-500/20" : color === "violet" ? "bg-violet-500/10 border-violet-500/20" : "bg-pink-500/10 border-pink-500/20")}>
              <Icon className={cn("h-4 w-4", color === "copper" ? "text-[#B87333]" : color === "emerald" ? "text-emerald-400" : color === "sky" ? "text-sky-400" : color === "amber" ? "text-amber-400" : color === "violet" ? "text-violet-400" : "text-pink-400")} />
            </div>
            <div className={cn("flex items-center gap-1 text-[12px] font-medium", trendColor)}><TrendIcon className="h-3 w-3" />{trend}</div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight mb-1">{value}</div>
          <div className="text-[12px] font-medium text-white/40 uppercase tracking-wider">{label}</div>
        </div>
      </div>
    </Reveal>
  );
}

/* ───── Bar Chart ─────────────────────────────────── */
function BarChart({ bars }: { bars: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...bars.map((b) => b.value));
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-3">
          <div className="w-[100px] text-[12px] text-white/50 truncate text-right">{bar.label}</div>
          <div className="flex-1 h-6 rounded-md bg-white/[0.04] overflow-hidden">
            <div className="h-full rounded-md transition-all duration-1000 ease-out" style={{ width: `${(bar.value / max) * 100}%`, background: `linear-gradient(90deg, ${bar.color}40, ${bar.color})` }} />
          </div>
          <div className="w-8 text-[12px] font-bold text-white/60 text-right">{bar.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ───── Line Chart ────────────────────────────────── */
function LineChartViz({ series, labels }: { series: { label: string; data: number[]; color: string }[]; labels: string[] }) {
  const allVals = series.flatMap((s) => s.data);
  const max = Math.max(...allVals);
  const min = Math.min(...allVals);
  const range = max - min || 1;
  const W = 400;
  const H = 120;
  const pad = 2;
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => { const y = H - pad - t * (H - 2 * pad); return <line key={t} x1={0} x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" />; })}
          {series.map((s) => {
            const points = s.data.map((v, i) => `${pad + (i / (s.data.length - 1)) * (W - 2 * pad)},${H - pad - ((v - min) / range) * (H - 2 * pad)}`).join(" ");
            return <polyline key={s.label} points={points} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </svg>
        <div className="flex justify-between mt-2 px-1">{labels.filter((_, i) => i % 3 === 0 || i === labels.length - 1).map((l) => <span key={l} className="text-[9px] text-white/25">{l}</span>)}</div>
      </div>
      <div className="flex flex-wrap gap-4 mt-3">{series.map((s) => (<div key={s.label} className="flex items-center gap-2"><div className="h-2 w-4 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-[11px] text-white/50">{s.label}</span></div>))}</div>
    </div>
  );
}

/* ───── Donut Chart ───────────────────────────────── */
function DonutChart({ segments, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerLabel: string }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = 55;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-shrink-0">
        <svg width="140" height="140" viewBox="0 0 140 140">
          {segments.map((seg) => {
            const dashLength = (seg.value / total) * circumference;
            const dashOffset = -offset;
            offset += dashLength;
            return <circle key={seg.label} cx="70" cy="70" r={radius} fill="none" stroke={seg.color} strokeWidth="16" strokeDasharray={`${dashLength} ${circumference - dashLength}`} strokeDashoffset={dashOffset} strokeLinecap="round" transform="rotate(-90 70 70)" />;
          })}
          <circle cx="70" cy="70" r="44" fill="#1C1C1C" />
          <text x="70" y="66" textAnchor="middle" className="fill-white text-[13px] font-black">{centerLabel}</text>
          <text x="70" y="80" textAnchor="middle" className="fill-white/40 text-[10px]">by dept</text>
        </svg>
      </div>
      <div className="space-y-2 flex-1 min-w-0">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[12px] text-white/60 flex-1 truncate">{seg.label}</span>
            <span className="text-[12px] font-bold text-white/80">{seg.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════ */
export function PeopleOpsShowcase(): React.ReactElement {
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHeroLoaded(true), 100); return () => clearTimeout(t); }, []);
  const scrollTo = useCallback((id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);

  const onboardingTrend = useMemo(() => [72, 75, 78, 80, 82, 85, 83, 87, 89, 91, 88, 92], []);
  const weekLabels = useMemo(() => ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12"], []);

  return (
    <div className="min-h-screen text-[#EDEDED]" style={{ background: "radial-gradient(ellipse 80% 50% at 75% 0%, rgba(184,115,51,0.09), transparent 50%), radial-gradient(ellipse 50% 40% at 15% 100%, rgba(184,115,51,0.05), transparent 50%), radial-gradient(ellipse 40% 30% at 50% 50%, rgba(184,115,51,0.03), transparent 50%), linear-gradient(180deg, #1b1b1b 0%, #131313 100%)" }}>
      <StickyNav />

      {/* ── HERO ─────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-[#B87333]/[0.06] blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-[10%] h-[350px] w-[350px] rounded-full bg-[#B87333]/[0.04] blur-[100px]" />
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 pb-16 pt-16 sm:pt-24">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <div className={cn("transition-all duration-700 delay-100", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#B87333]/25 bg-[#B87333]/[0.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B87333]">
                  <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#B87333]" /></span>
                  QEP OS &middot; People Operations
                </span>
              </div>
              <h1 className={cn("mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <span className="block text-white">From onboarding to policy</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">to people support,</span>
                <span className="block text-white">in one connected flow.</span>
              </h1>
              <p className={cn("mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                People Operations Lab is QEP OS's future people-operations layer — built to unify onboarding, policy access, acknowledgments, training, manager support, employee questions, and compliance oversight into one connected operational flow that scales with the company.
              </p>
              <div className={cn("mt-8 overflow-hidden rounded-2xl border border-[#B87333]/20 transition-all duration-700 delay-[400ms]", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <div className="bg-gradient-to-b from-[#B87333]/[0.10] to-[#B87333]/[0.03] px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#B87333]" /></div>
                    <span className="text-sm font-bold text-white">Future people-operations layer for QEP.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">Designed to be built in phases — starting with handbook intelligence and policy Q&A, expanding into role-based onboarding, compliance tracking, manager support workflows, and a culture-scaling engine.</p>
                </div>
              </div>
              <div className={cn("mt-8 flex flex-wrap gap-3 transition-all duration-700 delay-500", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <button onClick={() => scrollTo("lifecycle")} className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]">
                  See the workflow <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button onClick={() => scrollTo("value")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">What it unlocks</button>
              </div>
            </div>
            <div className={cn("transition-all duration-700 delay-[350ms]", heroLoaded ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-[0.97]")}>
              <div className="relative">
                <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-[#B87333]/10 to-transparent blur-2xl" />
                <GlassCard className="relative rounded-[1.75rem] p-7 sm:p-8 border-white/[0.08] shadow-2xl shadow-black/40">
                  <h3 className="text-xl font-bold text-white mb-2">What owners should know</h3>
                  <p className="text-sm leading-relaxed text-white/50 mb-6">QEP does not need a traditional HR department before it is ready for one. It needs a structured people-operations system that makes onboarding, policy access, employee support, and manager workflow easier to execute every day.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { icon: Users, title: "What it is", desc: "A connected people-operations module for onboarding, policy, training, and manager support.", color: "text-[#B87333]", bg: "bg-[#B87333]/10 border-[#B87333]/15" },
                      { icon: AlertTriangle, title: "Current opportunity", desc: "People operations today depend on memory, interruptions, scattered documents, and informal follow-through.", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/15" },
                      { icon: TrendingUp, title: "Strategic upside", desc: "Faster onboarding, stronger consistency, less admin overhead, better manager support.", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/15" },
                      { icon: Target, title: "What changes next", desc: "The company gains structure without needing a traditional HR department before it is ready.", color: "text-sky-400", bg: "bg-sky-400/10 border-sky-400/15" },
                    ].map((card) => (
                      <div key={card.title} className={cn("rounded-xl border p-4 transition-all duration-200 hover:scale-[1.02]", card.bg)}>
                        <card.icon className={cn("h-4 w-4 mb-2", card.color)} />
                        <h4 className="text-[13px] font-bold text-white mb-1">{card.title}</h4>
                        <p className="text-[12px] leading-relaxed text-white/45">{card.desc}</p>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT IT IS ─────────────────────────────── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it is</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">People Operations Lab is not an HR portal, a handbook viewer, or an employee file cabinet. It is the front door to better onboarding, policy execution, manager support, and employee consistency — operational infrastructure for the people side of the business.</p></div></Reveal>
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20"><UserPlus className="h-5 w-5 text-[#B87333]" /></div>
                <h3 className="text-lg font-bold text-white mb-3">Built for team execution</h3>
                <p className="text-sm leading-relaxed text-white/55">Onboarding flows, training paths, policy acknowledgments, and employee support — structured so every new hire, every manager action, and every policy question follows a clear path instead of depending on who happens to be available.</p>
              </GlassCard>
            </Reveal>
            <Reveal delay={200}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20"><BarChart3 className="h-5 w-5 text-[#B87333]" /></div>
                <h3 className="text-lg font-bold text-white mb-3">Built for leadership consistency</h3>
                <p className="text-sm leading-relaxed text-white/55">Process visibility, compliance tracking, manager follow-through, and culture reinforcement — so the company scales without losing the standards, expectations, and values that define how QEP operates.</p>
              </GlassCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────── */}
      <section id="lifecycle" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">How it works</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Six connected stages that take people operations from ad hoc to structured — covering the full lifecycle from new hire launch through ongoing support and oversight.</p></div></Reveal>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LifecycleStep number={1} title="New Hire Launch" icon={UserPlus} description="Role, department, manager, location, start date, and onboarding path. Every new hire enters a structured launch sequence that drives the right tasks, training, and check-ins from day one." delay={0} />
            <LifecycleStep number={2} title="Policy & Acknowledgments" icon={BookOpen} description="Handbook access, required acknowledgments, and role-specific policy tasks. Employees see what they need to read and confirm — digitally tracked, not assumed." delay={80} />
            <LifecycleStep number={3} title="Training & Role Readiness" icon={GraduationCap} description="Department-specific learning paths, certifications, and process checklists. Training becomes structured, trackable, and tied to role expectations — not informal tribal knowledge." delay={160} />
            <LifecycleStep number={4} title="Manager Check-Ins" icon={CalendarCheck} description="7-day, 30-day, 60-day, and 90-day review flows with probation support. Managers are prompted with the right milestone at the right time, with documentation guidance built in." delay={240} />
            <LifecycleStep number={5} title="Employee Support & Questions" icon={MessageCircle} description="Conversational policy answers, routed concerns, leave and benefits guidance, and self-service access. Employees get answers without interrupting three different people to find the right one." delay={320} />
            <LifecycleStep number={6} title="People Intelligence & Oversight" icon={BarChart3} description="Completion tracking, missing step alerts, risk signals, and manager support visibility. Leadership sees people-operations health without manual reporting or status meetings." delay={400} />
          </div>
        </div>
      </section>

      {/* ── DASHBOARD / KPI SECTION ──────────────── */}
      <section id="dashboard" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">People operations dashboard</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Real-time visibility into onboarding, compliance, training, and manager follow-through. These are showcase placeholders — in production, each metric would be drawn from live platform data.</p></div></Reveal>

          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            <KPICard icon={UserPlus} label="New Hires in Launch" value="5" trend="+2" trendDirection="up" color="copper" delay={0} />
            <KPICard icon={BookOpen} label="Pending Acknowledgments" value="12" trend="-3" trendDirection="down" color="amber" delay={60} />
            <KPICard icon={CalendarCheck} label="30-Day Check-Ins Due" value="4" trend="0" trendDirection="neutral" color="sky" delay={120} />
            <KPICard icon={ClipboardList} label="Open Manager Actions" value="7" trend="-2" trendDirection="down" color="violet" delay={180} />
            <KPICard icon={GraduationCap} label="Training Completion" value="89%" trend="+4pp" trendDirection="up" color="emerald" delay={240} />
            <KPICard icon={Clock} label="Probation Active" value="9" trend="+1" trendDirection="up" color="pink" delay={300} />
          </div>

          {/* Charts Row */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Reveal delay={0}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <LineChart className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Onboarding Completion Trend</h3>
                </div>
                <LineChartViz
                  series={[{ label: "90-Day Completion Rate (%)", data: onboardingTrend, color: "#B87333" }]}
                  labels={weekLabels}
                />
              </GlassCard>
            </Reveal>

            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <BarChart3 className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Outstanding Tasks by Department</h3>
                </div>
                <BarChart bars={[
                  { label: "Sales", value: 8, color: "#B87333" },
                  { label: "Parts", value: 5, color: "#38bdf8" },
                  { label: "Service", value: 7, color: "#34d399" },
                  { label: "Rental", value: 3, color: "#f59e0b" },
                  { label: "Admin", value: 2, color: "#a78bfa" },
                ]} />
              </GlassCard>
            </Reveal>

            <Reveal delay={200}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <PieChart className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Training Completion by Role</h3>
                </div>
                <DonutChart
                  centerLabel="Training"
                  segments={[
                    { label: "Sales", value: 92, color: "#B87333" },
                    { label: "Parts", value: 88, color: "#38bdf8" },
                    { label: "Service", value: 85, color: "#34d399" },
                    { label: "Rental", value: 91, color: "#f59e0b" },
                    { label: "Admin", value: 95, color: "#a78bfa" },
                  ]}
                />
              </GlassCard>
            </Reveal>

            <Reveal delay={300}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <Bell className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Manager Action Queue</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { icon: Clock, text: "2 probation reviews due this week", severity: "text-red-400 bg-red-500/10 border-red-500/15" },
                    { icon: CalendarCheck, text: "3 milestone check-ins overdue", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                    { icon: BookOpen, text: "4 policy acknowledgments pending manager follow-up", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                    { icon: GraduationCap, text: "2 training modules need verification", severity: "text-sky-400 bg-sky-500/10 border-sky-500/15" },
                    { icon: AlertTriangle, text: "1 attendance pattern flagged for documentation", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                  ].map((alert) => (
                    <div key={alert.text} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 transition-all duration-200 hover:scale-[1.01]", alert.severity)}>
                      <alert.icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", alert.severity.split(" ")[0])} />
                      <span className="text-[13px] leading-relaxed text-white/70">{alert.text}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </Reveal>
          </div>
          <div className="mt-3"><p className="text-[11px] text-white/25 italic">All metrics and charts display illustrative showcase data — not live company information.</p></div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS ───────────────────────── */}
      <section id="scale" className="scroll-mt-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B87333]/[0.06] to-transparent" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <Reveal>
                <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white mb-4">Structure for the team, without unnecessary overhead</h2>
                <p className="text-base leading-relaxed text-white/50 mb-4">As a company grows, people operations either become structured or they become an invisible drag on managers and leadership. Every unanswered policy question, every inconsistent onboarding, every missed probation milestone — these are not just administrative gaps. They are operational risk.</p>
                <p className="text-base leading-relaxed text-white/50">The goal is not more bureaucracy. The goal is better execution, better consistency, and less dependence on memory. The company gets structure without needing to build a traditional HR department before it is ready for one.</p>
              </Reveal>
            </div>
            <Reveal delay={150}>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: UserPlus, label: "Onboarding", color: "text-[#B87333]" },
                  { icon: BookOpen, label: "Policy access", color: "text-sky-400" },
                  { icon: GraduationCap, label: "Training", color: "text-emerald-400" },
                  { icon: CheckSquare, label: "Acknowledgments", color: "text-violet-400" },
                  { icon: Shield, label: "Compliance", color: "text-amber-400" },
                  { icon: Heart, label: "Culture", color: "text-pink-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]">
                    <item.icon className={cn("h-4 w-4 flex-shrink-0", item.color)} /><span className="text-[13px] font-medium text-white/65">{item.label}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── VALUE CARDS ────────────────────────────── */}
      <section id="value" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it unlocks</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Four outcomes that strengthen how the company grows its team.</p></div></Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard icon={Zap} title="Faster Onboarding" description="Every new hire enters a role-based launch path with structured tasks, training, and milestones — not an informal orientation that depends on who is available that day." delay={0} />
            <ValueCard icon={ShieldCheck} title="Fewer Dropped Steps" description="Acknowledgments, check-ins, training modules, and probation milestones are tracked and surfaced automatically — nothing falls between the cracks." delay={100} />
            <ValueCard icon={Handshake} title="Better Manager Support" description="Managers get structured guidance for coaching, corrective action, leave requests, and performance reviews — without needing HR expertise in their heads." delay={200} />
            <ValueCard icon={Award} title="Stronger Consistency" description="The same expectations, the same onboarding quality, the same values, and the same management standards — across every department, every location, every hire." delay={300} />
          </div>
        </div>
      </section>

      {/* ── FUTURE ROADMAP ─────────────────────────── */}
      <section id="future" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it becomes next</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">People Operations Lab is designed to expand in phases — from structured onboarding into a full people-operations intelligence layer that scales with the company.</p></div></Reveal>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><Users className="h-4 w-4" />Operational future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={UserPlus} label="Role-based onboarding paths" delay={0} />
                <FutureItem icon={Brain} label="Policy intelligence and conversational Q&A" delay={60} />
                <FutureItem icon={CheckSquare} label="Acknowledgment tracking and re-certification" delay={120} />
                <FutureItem icon={GraduationCap} label="Training delivery and completion tracking" delay={180} />
                <FutureItem icon={Lightbulb} label="Manager support workflows and copilot" delay={240} />
                <FutureItem icon={MessageCircle} label="Issue routing and documentation" delay={300} />
                <FutureItem icon={CalendarCheck} label="Probation milestone control" delay={360} />
                <FutureItem icon={FileText} label="Employee self-service Q&A and portal" delay={420} />
              </div>
            </div>
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><BarChart3 className="h-4 w-4" />Leadership future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={Eye} label="Onboarding completion visibility" delay={40} />
                <FutureItem icon={Layers} label="Department readiness tracking" delay={100} />
                <FutureItem icon={AlertTriangle} label="Employee issue trend visibility" delay={160} />
                <FutureItem icon={Shield} label="Policy acknowledgment compliance" delay={220} />
                <FutureItem icon={UserCheck} label="Manager follow-through visibility" delay={280} />
                <FutureItem icon={Target} label="People-operations bottleneck detection" delay={340} />
                <FutureItem icon={TrendingUp} label="Turnover-risk signals" delay={400} />
                <FutureItem icon={Heart} label="Culture and training consistency across the company" delay={460} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── MOONSHOT LAYER ─────────────────────────── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <GlassCard copper className="p-8 sm:p-10">
              <div className="flex items-center gap-2 mb-6">
                <Brain className="h-5 w-5 text-[#B87333]" />
                <h3 className="text-xl font-bold text-white">The deeper vision</h3>
              </div>
              <div className="grid gap-8 lg:grid-cols-3">
                <div>
                  <h4 className="text-sm font-bold text-[#B87333] uppercase tracking-wider mb-3">Manager Copilot</h4>
                  <p className="text-sm leading-relaxed text-white/55">A manager asks: "Walk me through what I need to do for this new hire." The system generates a step-by-step checklist. "What steps are missing for this employee?" The system checks onboarding, training, acknowledgments, and surfaces gaps. "What policy applies here?" The system retrieves the handbook section and recommends the documented next step.</p>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#B87333] uppercase tracking-wider mb-3">Policy-to-Workflow Engine</h4>
                  <p className="text-sm leading-relaxed text-white/55">Policies stop being PDFs. They become executable workflows. Handbook acknowledgments become tracked tasks. Expense policies become receipt workflows. Conduct policies become issue-routing pathways. Every policy carries a clear path to action, not just information.</p>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#B87333] uppercase tracking-wider mb-3">Culture-Scaling Engine</h4>
                  <p className="text-sm leading-relaxed text-white/55">As QEP grows, the platform ensures the same expectations are communicated, the same onboarding quality happens, the same values are taught, and the same operational standards are reinforced — across every department, every location, every generation of team members.</p>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* ── FINAL CTA ──────────────────────────────── */}
      <section className="pb-20 pt-8">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl">
              <div className="absolute inset-0 bg-gradient-to-br from-[#B87333]/[0.12] via-white/[0.03] to-[#B87333]/[0.06]" />
              <div className="absolute inset-0 border border-[#B87333]/20 rounded-3xl" />
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/30 to-transparent" />
              <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-[#B87333]/[0.15] blur-[80px]" />
              <div className="relative px-6 py-12 sm:px-10 sm:py-14">
                <span className="inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-[#B87333] mb-4">Executive positioning</span>
                <h2 className="text-[clamp(24px,3vw,38px)] font-bold tracking-[-0.03em] text-white max-w-3xl mb-4">People Operations Lab is not another HR tool.</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-4">It is the future foundation for how QEP can onboard, support, guide, and scale its team with greater consistency and less administrative drag — without building unnecessary bureaucracy before the company is ready.</p>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">This platform is not just about revenue. It is about building a company that can actually scale without everything depending on a handful of people carrying process in their heads.</p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => scrollTo("lifecycle")} className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]">View the workflow <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" /></button>
                  <button onClick={() => scrollTo("dashboard")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">See the dashboard</button>
                  <button onClick={() => scrollTo("future")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">See the full vision</button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none"><ScrollHint /></div>
    </div>
  );
}

function ScrollHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => { const onScroll = () => setVisible(window.scrollY < 100); window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll); }, []);
  if (!visible) return null;
  return (<div className="flex flex-col items-center gap-1 animate-bounce text-white/25"><span className="text-[10px] font-medium uppercase tracking-widest">Scroll</span><ChevronDown className="h-4 w-4" /></div>);
}
