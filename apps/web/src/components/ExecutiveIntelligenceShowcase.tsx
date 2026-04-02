import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  Eye,
  Target,
  Layers,
  AlertTriangle,
  Clock,
  DollarSign,
  Users,
  Truck,
  Wrench,
  Package,
  Activity,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Zap,
  ChevronDown,
  Brain,
  Bell,
  Gauge,
  PieChart,
  LineChart,
  CalendarCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const NAV_SECTIONS = [
  { id: "kpis", label: "KPIs" },
  { id: "intelligence", label: "Intelligence" },
  { id: "alerts", label: "Alerts" },
  { id: "value", label: "Value" },
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
        <div className="text-lg font-extrabold tracking-tight">Executive<span className="text-[#B87333]">Intelligence</span></div>
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

/* ───── KPI Card ────────────────────────────────── */
function KPICard({ icon: Icon, label, value, trend, trendDirection, color, delay }: { icon: React.ElementType; label: string; value: string; trend: string; trendDirection: "up" | "down" | "neutral"; color: string; delay: number }) {
  const TrendIcon = trendDirection === "up" ? ArrowUpRight : trendDirection === "down" ? ArrowDownRight : Activity;
  const trendColor = trendDirection === "up" ? "text-emerald-400" : trendDirection === "down" ? "text-red-400" : "text-white/40";
  return (
    <Reveal delay={delay}>
      <div className="group relative h-full">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
        <div className="relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 transition-all duration-300 hover:border-white/[0.14] hover:shadow-lg hover:shadow-black/30">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.10] to-transparent" />
          <div className="flex items-center justify-between mb-3">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border", color === "copper" ? "bg-[#B87333]/10 border-[#B87333]/20" : color === "emerald" ? "bg-emerald-500/10 border-emerald-500/20" : color === "sky" ? "bg-sky-500/10 border-sky-500/20" : color === "amber" ? "bg-amber-500/10 border-amber-500/20" : color === "violet" ? "bg-violet-500/10 border-violet-500/20" : color === "pink" ? "bg-pink-500/10 border-pink-500/20" : "bg-white/10 border-white/10")}>
              <Icon className={cn("h-4 w-4", color === "copper" ? "text-[#B87333]" : color === "emerald" ? "text-emerald-400" : color === "sky" ? "text-sky-400" : color === "amber" ? "text-amber-400" : color === "violet" ? "text-violet-400" : color === "pink" ? "text-pink-400" : "text-white/60")} />
            </div>
            <div className={cn("flex items-center gap-1 text-[12px] font-medium", trendColor)}>
              <TrendIcon className="h-3 w-3" />{trend}
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight mb-1">{value}</div>
          <div className="text-[12px] font-medium text-white/40 uppercase tracking-wider">{label}</div>
        </div>
      </div>
    </Reveal>
  );
}

/* ───── Mini Spark Line (SVG) ────────────────────── */
function SparkLine({ data, color = "#B87333", width = 100, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs><linearGradient id={`spark-${color.replace("#", "")}`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,${height} ${points} ${width},${height}`} fill={`url(#spark-${color.replace("#", "")})`} stroke="none" />
    </svg>
  );
}

/* ───── Bar Chart ────────────────────────────────── */
function BarChart({ bars }: { bars: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...bars.map((b) => b.value));
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-3">
          <div className="w-[110px] text-[12px] text-white/50 truncate text-right">{bar.label}</div>
          <div className="flex-1 h-6 rounded-md bg-white/[0.04] overflow-hidden relative">
            <div className="h-full rounded-md transition-all duration-1000 ease-out" style={{ width: `${(bar.value / max) * 100}%`, background: `linear-gradient(90deg, ${bar.color}40, ${bar.color})` }} />
          </div>
          <div className="w-8 text-[12px] font-bold text-white/60 text-right">{bar.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ───── Donut Chart ──────────────────────────────── */
function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-8">
      <div className="relative flex-shrink-0">
        <svg width="150" height="150" viewBox="0 0 150 150">
          {segments.map((seg) => {
            const dashLength = (seg.value / total) * circumference;
            const dashOffset = -offset;
            offset += dashLength;
            return <circle key={seg.label} cx="75" cy="75" r={radius} fill="none" stroke={seg.color} strokeWidth="18" strokeDasharray={`${dashLength} ${circumference - dashLength}`} strokeDashoffset={dashOffset} strokeLinecap="round" transform="rotate(-90 75 75)" className="transition-all duration-1000" />;
          })}
          <circle cx="75" cy="75" r="48" fill="#1C1C1C" />
          <text x="75" y="70" textAnchor="middle" className="fill-white text-[18px] font-black">Revenue</text>
          <text x="75" y="88" textAnchor="middle" className="fill-white/40 text-[11px]">by segment</text>
        </svg>
      </div>
      <div className="space-y-2.5 flex-1 min-w-0">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2.5">
            <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[13px] text-white/60 flex-1 truncate">{seg.label}</span>
            <span className="text-[13px] font-bold text-white/80">{seg.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───── Heatmap ──────────────────────────────────── */
function Heatmap({ rows, cols, data }: { rows: string[]; cols: string[]; data: number[][] }) {
  const maxVal = Math.max(...data.flat());
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full border-separate border-spacing-1">
        <thead><tr><th />{cols.map((c) => <th key={c} className="text-[10px] font-medium text-white/30 pb-1 text-center">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row}>
              <td className="text-[11px] text-white/40 pr-2 text-right whitespace-nowrap">{row}</td>
              {data[ri].map((val, ci) => {
                const intensity = maxVal > 0 ? val / maxVal : 0;
                return <td key={ci} className="p-0"><div className="w-full h-7 rounded-md transition-colors duration-500" style={{ backgroundColor: `rgba(184,115,51,${intensity * 0.7 + 0.05})` }} title={`${row} — ${cols[ci]}: ${val}`} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───── Line Chart ───────────────────────────────── */
function LineChartViz({ series, labels }: { series: { label: string; data: number[]; color: string }[]; labels: string[] }) {
  const allVals = series.flatMap((s) => s.data);
  const max = Math.max(...allVals);
  const min = Math.min(...allVals);
  const range = max - min || 1;
  const W = 400;
  const H = 140;
  const pad = 2;

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = H - pad - t * (H - 2 * pad);
            return <line key={t} x1={0} x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" />;
          })}
          {series.map((s) => {
            const points = s.data.map((v, i) => `${pad + (i / (s.data.length - 1)) * (W - 2 * pad)},${H - pad - ((v - min) / range) * (H - 2 * pad)}`).join(" ");
            return <polyline key={s.label} points={points} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </svg>
        <div className="flex justify-between mt-2 px-1">
          {labels.filter((_, i) => i % 5 === 0 || i === labels.length - 1).map((l) => <span key={l} className="text-[9px] text-white/25">{l}</span>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 mt-3">
        {series.map((s) => (
          <div key={s.label} className="flex items-center gap-2"><div className="h-2 w-4 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-[11px] text-white/50">{s.label}</span></div>
        ))}
      </div>
    </div>
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

/* ═══════════════════════════════════════════════════ */
export function ExecutiveIntelligenceShowcase(): React.ReactElement {
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHeroLoaded(true), 100); return () => clearTimeout(t); }, []);
  const scrollTo = useCallback((id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);

  const pipelineData = useMemo(() => [8.2, 8.0, 7.8, 8.1, 8.4, 8.3, 8.7, 8.5, 8.6, 8.9, 8.4, 8.1, 8.3, 8.5, 8.7, 8.4, 8.2, 8.5, 8.8, 8.6, 8.3, 8.7, 9.0, 8.8, 8.5, 8.6, 8.9, 8.7, 8.4, 8.4], []);
  const quotesData = useMemo(() => [3, 5, 2, 6, 4, 7, 3, 5, 8, 4, 6, 5, 7, 3, 6, 4, 8, 5, 7, 6, 4, 5, 9, 6, 5, 7, 4, 6, 8, 5], []);
  const dealsData = useMemo(() => [1, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 2, 1, 2, 4, 1, 3, 2, 1, 3, 2, 4, 2, 1, 3, 2, 3, 1, 2, 3], []);
  const dayLabels = useMemo(() => Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`), []);

  const riskData = useMemo(() => [
    [6, 5, 7, 4, 6, 5, 7, 5, 4, 6, 5, 6, 4, 5, 6, 5, 7, 6, 5, 4, 6, 5, 7, 4, 5, 6, 5, 6, 5, 4],
    [3, 4, 2, 3, 4, 5, 3, 4, 3, 2, 4, 3, 5, 4, 3, 2, 4, 3, 5, 4, 3, 2, 3, 4, 3, 5, 4, 3, 2, 3],
    [2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 2, 1, 2, 3, 1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 1, 2, 3, 2, 1],
  ], []);

  const heatmapData = useMemo(() => [
    [8, 9, 7, 6, 8, 5, 2],
    [6, 7, 8, 7, 5, 4, 1],
    [5, 6, 4, 7, 6, 3, 1],
    [4, 5, 6, 5, 7, 4, 2],
    [3, 4, 3, 4, 3, 2, 1],
  ], []);

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
                  QEP OS &middot; Leadership Intelligence
                </span>
              </div>
              <h1 className={cn("mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <span className="block text-white">A clearer picture</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">of the business,</span>
                <span className="block text-white">every day.</span>
              </h1>
              <p className={cn("mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                Executive Intelligence Center is QEP OS's future leadership command view — built to unify pipeline health, operational performance, team activity, risk signals, and business trends into one connected intelligence layer for ownership.
              </p>
              <div className={cn("mt-8 overflow-hidden rounded-2xl border border-[#B87333]/20 transition-all duration-700 delay-[400ms]", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <div className="bg-gradient-to-b from-[#B87333]/[0.10] to-[#B87333]/[0.03] px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#B87333]" /></div>
                    <span className="text-sm font-bold text-white">Future operating view for QEP leadership.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">Designed to expand in phases — from pipeline visibility and operational metrics to predictive alerts, branch-level scorecards, and strategic forecasting.</p>
                </div>
              </div>
              <div className={cn("mt-8 flex flex-wrap gap-3 transition-all duration-700 delay-500", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <button onClick={() => scrollTo("kpis")} className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]">
                  See the dashboard <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button onClick={() => scrollTo("value")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">What it unlocks</button>
              </div>
            </div>
            <div className={cn("transition-all duration-700 delay-[350ms]", heroLoaded ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-[0.97]")}>
              <div className="relative">
                <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-[#B87333]/10 to-transparent blur-2xl" />
                <GlassCard className="relative rounded-[1.75rem] p-7 sm:p-8 border-white/[0.08] shadow-2xl shadow-black/40">
                  <h3 className="text-xl font-bold text-white mb-2">What owners should know</h3>
                  <p className="text-sm leading-relaxed text-white/50 mb-6">Executive Intelligence Center replaces fragmented updates with a single connected view of the business — across sales, rental, parts, logistics, and operations.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { icon: Brain, title: "What it is", desc: "A live executive intelligence layer for QEP leadership.", color: "text-[#B87333]", bg: "bg-[#B87333]/10 border-[#B87333]/15" },
                      { icon: AlertTriangle, title: "Current opportunity", desc: "Ownership visibility today is fragmented across systems, reports, and handoffs.", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/15" },
                      { icon: TrendingUp, title: "Strategic upside", desc: "Faster decisions, fewer blind spots, better operational control.", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/15" },
                      { icon: Target, title: "What changes next", desc: "Leadership gets a connected operating view of the entire business.", color: "text-sky-400", bg: "bg-sky-400/10 border-sky-400/15" },
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

      {/* ── KPI OVERVIEW ──────────────────────────── */}
      <section id="kpis" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">Executive KPI overview</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Real-time operational pulse. These are showcase placeholders — in production, each metric would be drawn from live platform data.</p></div></Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard icon={DollarSign} label="Open Pipeline" value="$8.4M" trend="+6.2%" trendDirection="up" color="copper" delay={0} />
            <KPICard icon={Gauge} label="Quotes in Progress" value="37" trend="+4" trendDirection="up" color="emerald" delay={60} />
            <KPICard icon={Truck} label="Rental Utilization" value="72%" trend="+3pp" trendDirection="up" color="sky" delay={120} />
            <KPICard icon={Package} label="Parts Revenue MTD" value="$486K" trend="+8.1%" trendDirection="up" color="amber" delay={180} />
            <KPICard icon={CalendarCheck} label="On-Time Delivery" value="91%" trend="+2pp" trendDirection="up" color="emerald" delay={240} />
            <KPICard icon={Clock} label="Overdue Follow-Ups" value="14" trend="-3" trendDirection="down" color="pink" delay={300} />
            <KPICard icon={Wrench} label="Service Bottlenecks" value="9" trend="-1" trendDirection="down" color="violet" delay={360} />
            <KPICard icon={Users} label="Active Customer Risks" value="6" trend="+2" trendDirection="up" color="amber" delay={420} />
          </div>
          <div className="mt-3"><p className="text-[11px] text-white/25 italic">Values shown are illustrative showcase placeholders — not live company data.</p></div>
        </div>
      </section>

      {/* ── INTELLIGENCE GRAPHS ───────────────────── */}
      <section id="intelligence" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">Business intelligence</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Charts that help leadership see patterns, not just numbers. Each visualization represents a future module surface inside the Executive Intelligence Center.</p></div></Reveal>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Pipeline Momentum */}
            <Reveal delay={0}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <LineChart className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">30-Day Pipeline Momentum</h3>
                </div>
                <LineChartViz
                  series={[
                    { label: "Pipeline Value ($M)", data: pipelineData, color: "#B87333" },
                    { label: "Quotes Created", data: quotesData, color: "#38bdf8" },
                    { label: "Deals Advanced", data: dealsData, color: "#34d399" },
                  ]}
                  labels={dayLabels}
                />
              </GlassCard>
            </Reveal>

            {/* Operational Exceptions */}
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <BarChart3 className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Operational Exceptions by Area</h3>
                </div>
                <BarChart bars={[
                  { label: "Sales follow-up", value: 14, color: "#B87333" },
                  { label: "Rental closeout", value: 9, color: "#38bdf8" },
                  { label: "Logistics", value: 6, color: "#34d399" },
                  { label: "Parts fulfillment", value: 8, color: "#f59e0b" },
                  { label: "Service approvals", value: 5, color: "#a78bfa" },
                ]} />
              </GlassCard>
            </Reveal>

            {/* Revenue Mix */}
            <Reveal delay={200}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <PieChart className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Revenue Mix</h3>
                </div>
                <DonutChart segments={[
                  { label: "Equipment", value: 42, color: "#B87333" },
                  { label: "Parts", value: 31, color: "#38bdf8" },
                  { label: "Rental", value: 18, color: "#34d399" },
                  { label: "Service", value: 9, color: "#a78bfa" },
                ]} />
              </GlassCard>
            </Reveal>

            {/* Activity Heatmap */}
            <Reveal delay={300}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <Activity className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Team Activity Heatmap</h3>
                </div>
                <Heatmap
                  rows={["Sales", "Parts", "Rental", "Service", "Admin"]}
                  cols={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                  data={heatmapData}
                />
              </GlassCard>
            </Reveal>
          </div>

          {/* At-Risk Trend — Full Width */}
          <div className="mt-5">
            <Reveal delay={400}>
              <GlassCard>
                <div className="flex items-center gap-2 mb-5">
                  <TrendingUp className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">At-Risk Items Trend (30 Days)</h3>
                </div>
                <LineChartViz
                  series={[
                    { label: "Stalled Deals", data: riskData[0], color: "#ef4444" },
                    { label: "Overdue Rentals", data: riskData[1], color: "#f59e0b" },
                    { label: "Unresolved Movement Tickets", data: riskData[2], color: "#a78bfa" },
                  ]}
                  labels={dayLabels}
                />
              </GlassCard>
            </Reveal>
          </div>

          <div className="mt-3"><p className="text-[11px] text-white/25 italic">All charts display illustrative showcase data — not live company metrics.</p></div>
        </div>
      </section>

      {/* ── ALERTS & BRIEFING ────────────────────── */}
      <section id="alerts" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">Leadership alerts & briefing</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">The information that needs to find leadership — without leadership needing to ask.</p></div></Reveal>

          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            {/* Alerts Panel */}
            <Reveal delay={0}>
              <GlassCard copper className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <Bell className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Active Alerts</h3>
                  <span className="ml-auto inline-flex items-center rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-bold text-red-400">5 items</span>
                </div>
                <div className="space-y-3">
                  {[
                    { icon: AlertTriangle, text: "4 deals at risk — pipeline value $1.2M exposure", severity: "text-red-400 bg-red-500/10 border-red-500/15" },
                    { icon: Clock, text: "3 rentals awaiting closeout — overdue by 5+ days", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                    { icon: Truck, text: "6 incomplete logistics tickets — delivery confirmation needed", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                    { icon: Package, text: "Parts fulfillment delays up 12% week-over-week", severity: "text-amber-400 bg-amber-500/10 border-amber-500/15" },
                    { icon: Layers, text: "2 branch bottlenecks flagged for review", severity: "text-sky-400 bg-sky-500/10 border-sky-500/15" },
                  ].map((alert) => (
                    <div key={alert.text} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 transition-all duration-200 hover:scale-[1.01]", alert.severity)}>
                      <alert.icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", alert.severity.split(" ")[0])} />
                      <span className="text-[13px] leading-relaxed text-white/70">{alert.text}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </Reveal>

            {/* Executive Briefing */}
            <Reveal delay={150}>
              <GlassCard className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <Brain className="h-4 w-4 text-[#B87333]" />
                  <h3 className="text-base font-bold text-white">Executive Briefing</h3>
                  <span className="ml-auto text-[11px] text-white/30">Sample — AI-generated daily</span>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
                  <p className="text-sm leading-[1.7] text-white/65">
                    <span className="font-semibold text-white/90">Today's picture:</span> Pipeline remains strong at $8.4M with 37 active quotes in motion. Rental closeout is lagging — 3 returns are overdue by more than 5 days and need attention. Parts activity is rising with MTD revenue up 8.1% over last month's pace.
                  </p>
                  <p className="text-sm leading-[1.7] text-white/65 mt-3">
                    Logistics completion improved week-over-week, but follow-up discipline needs attention in two areas. Four deals show risk signals — combined exposure of $1.2M. The delivery team's on-time rate is at 91%, up from 89% last week.
                  </p>
                  <p className="text-sm leading-[1.7] text-white/65 mt-3">
                    <span className="font-semibold text-[#B87333]/80">Priority action:</span> Rental closeout queue and the 4 at-risk deals should be leadership's first focus today.
                  </p>
                </div>
                <p className="mt-3 text-[11px] text-white/25 italic">This briefing is a showcase example of the AI-generated daily summary that would be available to ownership.</p>
              </GlassCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── VALUE CARDS ────────────────────────────── */}
      <section id="value" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it unlocks</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Four outcomes that change how leadership sees the business.</p></div></Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard icon={Zap} title="Faster Leadership Decisions" description="When key metrics, alerts, and trends are visible in real time, leadership acts on information instead of waiting for reports." delay={0} />
            <ValueCard icon={Eye} title="Fewer Blind Spots" description="Pipeline stalls, logistics delays, rental exposure, and parts exceptions surface automatically — before they become problems." delay={100} />
            <ValueCard icon={Layers} title="Better Cross-Department Visibility" description="Sales, rental, parts, service, and logistics performance in one view. No more assembling the picture from five different sources." delay={200} />
            <ValueCard icon={ShieldCheck} title="Stronger Operational Control" description="Exception management, trend monitoring, and priority routing give leadership the ability to intervene earlier and more precisely." delay={300} />
          </div>
        </div>
      </section>

      {/* ── FUTURE ROADMAP ─────────────────────────── */}
      <section id="future" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it becomes next</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Executive Intelligence Center is designed to deepen over time — from visibility into prediction, from awareness into action.</p></div></Reveal>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><Gauge className="h-4 w-4" />Operational future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={Eye} label="Live exception visibility" delay={0} />
                <FutureItem icon={Layers} label="Branch-level health scores" delay={60} />
                <FutureItem icon={Bell} label="Watchlists and escalations" delay={120} />
                <FutureItem icon={TrendingUp} label="Trend monitoring across departments" delay={180} />
                <FutureItem icon={Activity} label="Activity and follow-through intelligence" delay={240} />
                <FutureItem icon={BarChart3} label="Connected operational scorecards" delay={300} />
              </div>
            </div>
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><Brain className="h-4 w-4" />Leadership future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={AlertTriangle} label="Predictive alerts" delay={40} />
                <FutureItem icon={Target} label="Strategic forecasting" delay={100} />
                <FutureItem icon={DollarSign} label="Margin and mix visibility" delay={160} />
                <FutureItem icon={Zap} label="Management-level recommendations" delay={220} />
                <FutureItem icon={ShieldCheck} label="Risk concentration visibility" delay={280} />
                <FutureItem icon={Gauge} label="A true ownership operating view" delay={340} />
              </div>
            </div>
          </div>
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
                <h2 className="text-[clamp(24px,3vw,38px)] font-bold tracking-[-0.03em] text-white max-w-3xl mb-4">Executive Intelligence Center is not just a dashboard.</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-4">It is the future leadership operating layer for how QEP sees the business, manages risk, and makes better decisions with greater clarity — across sales, rental, parts, logistics, and service.</p>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">When ownership can see the full picture in real time, the business stops managing by exception and starts managing with precision.</p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => scrollTo("kpis")} className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]">View the dashboard <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" /></button>
                  <button onClick={() => scrollTo("intelligence")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">Business intelligence</button>
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
