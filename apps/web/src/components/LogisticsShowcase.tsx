import { useEffect, useRef, useState, useCallback } from "react";
import {
  Truck,
  ClipboardList,
  CalendarCheck,
  CheckSquare,
  MapPin,
  Receipt,
  Zap,
  ArrowRight,
  ShieldCheck,
  BarChart3,
  TrendingUp,
  Eye,
  Layers,
  Target,
  AlertTriangle,
  Clock,
  PackageCheck,
  Camera,
  Route,
  Timer,
  ChevronDown,
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
  { id: "lifecycle", label: "Workflow" },
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
        <div className="text-lg font-extrabold tracking-tight">Logistics<span className="text-[#B87333]">Command</span></div>
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

function LifecycleStep({ number, title, description, icon: Icon, delay }: { number: number; title: string; description: string; icon: React.ElementType; delay: number }) {
  return (
    <Reveal delay={delay}>
      <GlassCard copper className="h-full">
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B87333]/20 to-[#B87333]/5 border border-[#B87333]/25"><span className="text-lg font-black text-[#B87333]">{number}</span></div>
            <div className="absolute -inset-1 rounded-2xl bg-[#B87333]/10 blur-md -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
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

export function LogisticsShowcase(): React.ReactElement {
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHeroLoaded(true), 100); return () => clearTimeout(t); }, []);
  const scrollTo = useCallback((id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);

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
                  QEP OS &middot; Logistics Workflow
                </span>
              </div>
              <h1 className={cn("mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <span className="block text-white">From movement request</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">to confirmed delivery</span>
                <span className="block text-white">flow.</span>
              </h1>
              <p className={cn("mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                Logistics Command Center is QEP OS's future movement operations layer — built to unify dispatch requests, scheduling, readiness checks, in-transit visibility, delivery confirmation, and billing closeout into one connected operational flow.
              </p>
              <div className={cn("mt-8 overflow-hidden rounded-2xl border border-[#B87333]/20 transition-all duration-700 delay-[400ms]", heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}>
                <div className="bg-gradient-to-b from-[#B87333]/[0.10] to-[#B87333]/[0.03] px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#B87333]" /></div>
                    <span className="text-sm font-bold text-white">Future control center for equipment movement.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">Designed to be built in phases — starting with movement requests and scheduling, expanding into dispatch coordination, delivery confirmation, and billing handoff.</p>
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
                  <p className="text-sm leading-relaxed text-white/50 mb-6">Logistics Command Center is how QEP can tighten one of the most error-prone parts of the business — equipment movement — inside the same platform that manages sales, rental, and operations.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { icon: Layers, title: "What it is", desc: "A connected logistics and movement operations module.", color: "text-[#B87333]", bg: "bg-[#B87333]/10 border-[#B87333]/15" },
                      { icon: AlertTriangle, title: "Current opportunity", desc: "Movement coordination depends on tickets, people, handoffs, and follow-through.", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/15" },
                      { icon: TrendingUp, title: "Strategic upside", desc: "Faster scheduling, cleaner accountability, stronger operational control.", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/15" },
                      { icon: Target, title: "What changes next", desc: "Logistics becomes visible, structured, and easier to manage at scale.", color: "text-sky-400", bg: "bg-sky-400/10 border-sky-400/15" },
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
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it is</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Logistics Command Center is not just a dispatch screen. It is the front door to better operational control over everything that moves — deliveries, pickups, transfers, and every handoff in between.</p></div></Reveal>
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}><GlassCard className="h-full"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20"><Truck className="h-5 w-5 text-[#B87333]" /></div><h3 className="text-lg font-bold text-white mb-3">Built for logistics execution</h3><p className="text-sm leading-relaxed text-white/55">Request, assign, track, confirm, and close — every equipment movement follows a structured path from request to billing closeout. No more lost tickets, unclear status, or unconfirmed deliveries.</p></GlassCard></Reveal>
            <Reveal delay={200}><GlassCard className="h-full"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20"><BarChart3 className="h-5 w-5 text-[#B87333]" /></div><h3 className="text-lg font-bold text-white mb-3">Built for leadership visibility</h3><p className="text-sm leading-relaxed text-white/55">Movement activity becomes reportable, accountable, and easier to oversee. What's scheduled, what's in transit, what's confirmed, what's stalled — leadership sees it without chasing updates.</p></GlassCard></Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────── */}
      <section id="lifecycle" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">How it works</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Six connected stages that take an equipment movement from initial request through billing closeout — with every handoff, status change, and confirmation structured inside one system.</p></div></Reveal>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LifecycleStep number={1} title="Movement Request" icon={ClipboardList} description="Stock number, from/to locations, customer contact, shipping date, and billing responsibility. Every movement starts with a structured request so nothing is assumed or missed." delay={0} />
            <LifecycleStep number={2} title="Scheduling & Assignment" icon={CalendarCheck} description="Route planning, driver or trucker assignment, and capacity balancing. The right resource gets assigned with the right context at the right time." delay={80} />
            <LifecycleStep number={3} title="Readiness Check" icon={CheckSquare} description="Unit readiness, attachments, keys, on-site contacts, and special instructions. Equipment is confirmed ready before it leaves — not discovered missing on arrival." delay={160} />
            <LifecycleStep number={4} title="In Transit Visibility" icon={MapPin} description="Status changes, active move tracking, and issue escalation. The movement stays visible from departure through arrival, not silent between dispatch and delivery." delay={240} />
            <LifecycleStep number={5} title="Delivery Confirmation" icon={Camera} description="Photos, timestamp, signature, notes, and problem logging. Every delivery produces a structured confirmation record for accountability and billing." delay={320} />
            <LifecycleStep number={6} title="Billing & Closeout" icon={Receipt} description="Charges applied, work order handoff completed, ticket closed, and movement archived into reporting history. The lifecycle ends with a clean closeout, not an open ticket." delay={400} />
          </div>
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
                <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white mb-4">Logistics is not just support work</h2>
                <p className="text-base leading-relaxed text-white/50 mb-4">It is a core operating layer that affects delivery quality, customer confidence, billing accuracy, and internal coordination. When movement is unstructured, the business absorbs the cost in delays, errors, and follow-up overhead.</p>
                <p className="text-base leading-relaxed text-white/50">When logistics is connected, every delivery starts cleaner, every handoff is documented, and every completion is confirmed — not assumed.</p>
              </Reveal>
            </div>
            <Reveal delay={150}>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Truck, label: "Deliveries", color: "text-[#B87333]" },
                  { icon: PackageCheck, label: "Pickups", color: "text-sky-400" },
                  { icon: Route, label: "Transfers", color: "text-emerald-400" },
                  { icon: CalendarCheck, label: "Scheduling", color: "text-violet-400" },
                  { icon: Camera, label: "Proof of completion", color: "text-amber-400" },
                  { icon: Receipt, label: "Billing handoff", color: "text-pink-400" },
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
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it unlocks</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Four outcomes that tighten how equipment moves across the business.</p></div></Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard icon={Zap} title="Faster Dispatch Coordination" description="From request to assignment with fewer calls, fewer delays, and clearer context. Every movement starts with what the coordinator needs to act." delay={0} />
            <ValueCard icon={ShieldCheck} title="Fewer Missed Handoffs" description="Readiness checks, status changes, and delivery confirmations create structured checkpoints. Nothing falls between the cracks from dispatch to closeout." delay={100} />
            <ValueCard icon={Eye} title="Better Completion Accountability" description="Every delivery produces a confirmation record — photos, timestamps, notes. Proof of completion becomes a system capability, not a verbal promise." delay={200} />
            <ValueCard icon={BarChart3} title="Stronger Movement Visibility" description="Leadership sees what's scheduled, what's in transit, what's confirmed, and what's stalled. Movement becomes visible without asking for a status update." delay={300} />
          </div>
        </div>
      </section>

      {/* ── FUTURE ROADMAP ─────────────────────────── */}
      <section id="future" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal><div className="mb-10"><h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">What it becomes next</h2><p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">Logistics Command Center is designed to expand in phases. Here's the full vision once the foundation is in place.</p></div></Reveal>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><Truck className="h-4 w-4" />Operational future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={MapPin} label="Live dispatch board" delay={0} />
                <FutureItem icon={Route} label="Route coordination and optimization" delay={60} />
                <FutureItem icon={AlertTriangle} label="Delivery issue escalation" delay={120} />
                <FutureItem icon={CheckSquare} label="Unit readiness checks" delay={180} />
                <FutureItem icon={Camera} label="Proof-of-delivery workflow" delay={240} />
                <FutureItem icon={Receipt} label="Billing handoff automation" delay={300} />
              </div>
            </div>
            <div>
              <Reveal><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5"><BarChart3 className="h-4 w-4" />Leadership future</h3></Reveal>
              <div className="space-y-3">
                <FutureItem icon={Timer} label="On-time completion rate visibility" delay={40} />
                <FutureItem icon={TrendingUp} label="Haul volume trends" delay={100} />
                <FutureItem icon={AlertTriangle} label="Recurring issue pattern detection" delay={160} />
                <FutureItem icon={Clock} label="Incomplete ticket reduction" delay={220} />
                <FutureItem icon={BarChart3} label="Cost visibility by movement type" delay={280} />
                <FutureItem icon={Layers} label="Branch-to-branch movement intelligence" delay={340} />
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
                <h2 className="text-[clamp(24px,3vw,38px)] font-bold tracking-[-0.03em] text-white max-w-3xl mb-4">Logistics Command Center is not another scheduling screen.</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-4">It is the future foundation for how QEP can move equipment with greater discipline, visibility, and follow-through — from request through billing closeout.</p>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">Every unconfirmed delivery, every unclear status, every billing question that requires a phone call — these are the problems that disappear when logistics operations move into a connected system.</p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => scrollTo("lifecycle")} className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]">View the workflow <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" /></button>
                  <button onClick={() => scrollTo("value")} className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]">What it unlocks</button>
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
