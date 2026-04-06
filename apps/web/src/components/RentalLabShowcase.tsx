import { useEffect, useRef, useState, useCallback } from "react";
import {
  Truck,
  ClipboardList,
  MapPin,
  Wrench,
  ScanSearch,
  Receipt,
  Zap,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  BarChart3,
  TrendingUp,
  Clock,
  Users,
  AlertTriangle,
  CalendarCheck,
  Gauge,
  RotateCcw,
  DollarSign,
  PackageCheck,
  Eye,
  Bell,
  Activity,
  Target,
  ChevronDown,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Intersection Observer hook ────────────────────────────────────────── */

function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, ...options },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [options]);
  return { ref, visible };
}

/* ─── Scroll-aware sticky nav ───────────────────────────────────────────── */

const NAV_SECTIONS = [
  { id: "lifecycle", label: "Lifecycle" },
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
        if (!el) return { id: s.id, top: Infinity };
        return { id: s.id, top: el.getBoundingClientRect().top };
      });
      const current = sections
        .filter((s) => s.top < window.innerHeight * 0.4)
        .sort((a, b) => b.top - a.top)[0];
      setActive(current?.id ?? "");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-[#1C1C1C]/85 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl shadow-black/40"
          : "bg-transparent border-b border-transparent",
      )}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-3.5 sm:px-6">
        <div className="text-lg font-extrabold tracking-tight">
          Rental<span className="text-[#B87333]">Lab</span>
        </div>
        <div className="hidden sm:flex items-center gap-1">
          {NAV_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={cn(
                "relative px-3.5 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200",
                active === s.id
                  ? "text-[#B87333] bg-[#B87333]/[0.08]"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
              )}
            >
              {s.label}
              {active === s.id && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full bg-[#B87333]" />
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

/* ─── Reveal wrapper ────────────────────────────────────────────────────── */

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, visible } = useInView();
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ─── Glowing card wrapper ──────────────────────────────────────────────── */

function GlassCard({
  children,
  className,
  copper,
}: {
  children: React.ReactNode;
  className?: string;
  copper?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-6 transition-all duration-300",
        "bg-gradient-to-b from-white/[0.05] to-white/[0.02]",
        "hover:shadow-xl hover:shadow-black/30 hover:border-white/[0.15]",
        "group",
        copper
          ? "border-[#B87333]/20 hover:border-[#B87333]/35"
          : "border-white/[0.08]",
        className,
      )}
    >
      {copper && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#B87333]/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      )}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
      <div className="relative">{children}</div>
    </div>
  );
}

/* ─── Lifecycle step card ────────────────────────────────────────────────── */

function LifecycleStep({
  number,
  title,
  description,
  icon: Icon,
  delay,
}: {
  number: number;
  title: string;
  description: string;
  icon: React.ElementType;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <GlassCard copper className="h-full">
        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#B87333]/20 to-[#B87333]/5 border border-[#B87333]/25">
              <span className="text-lg font-black text-[#B87333]">{number}</span>
            </div>
            <div className="absolute -inset-1 rounded-2xl bg-[#B87333]/10 blur-md -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-4 w-4 text-[#B87333]/70" />
              <h3 className="text-lg font-bold text-white">{title}</h3>
            </div>
            <p className="text-sm leading-relaxed text-white/60">{description}</p>
          </div>
        </div>
      </GlassCard>
    </Reveal>
  );
}

/* ─── Value card ─────────────────────────────────────────────────────────── */

function ValueCard({
  icon: Icon,
  title,
  description,
  delay,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className="group relative h-full">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#B87333]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />
        <div className="relative h-full overflow-hidden rounded-2xl border border-[#B87333]/15 bg-gradient-to-b from-[#B87333]/[0.07] to-white/[0.02] p-6 transition-all duration-300 hover:border-[#B87333]/30 hover:shadow-lg hover:shadow-[#B87333]/[0.05]">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/25 to-transparent" />
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
            <Icon className="h-5 w-5 text-[#B87333]" />
          </div>
          <h4 className="text-base font-bold text-white mb-2">{title}</h4>
          <p className="text-sm leading-relaxed text-white/55">{description}</p>
        </div>
      </div>
    </Reveal>
  );
}

/* ─── Future roadmap item ────────────────────────────────────────────────── */

function FutureItem({
  icon: Icon,
  label,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
          <Icon className="h-4 w-4 text-white/50" />
        </div>
        <span className="text-sm font-medium text-white/70">{label}</span>
      </div>
    </Reveal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export function RentalLabShowcase(): React.ReactElement {
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHeroLoaded(true), 100);
    return () => clearTimeout(t);
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div
      className="min-h-screen text-[#EDEDED]"
      style={{
        background:
          "radial-gradient(ellipse 80% 50% at 75% 0%, rgba(184,115,51,0.09), transparent 50%), " +
          "radial-gradient(ellipse 50% 40% at 15% 100%, rgba(184,115,51,0.05), transparent 50%), " +
          "radial-gradient(ellipse 40% 30% at 50% 50%, rgba(184,115,51,0.03), transparent 50%), " +
          "linear-gradient(180deg, #1b1b1b 0%, #131313 100%)",
      }}
    >
      <StickyNav />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-[#B87333]/[0.06] blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-[10%] h-[350px] w-[350px] rounded-full bg-[#B87333]/[0.04] blur-[100px]" />

        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 pb-16 pt-16 sm:pt-24">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            {/* Left — copy */}
            <div>
              <div
                className={cn(
                  "transition-all duration-700 delay-100",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-[#B87333]/25 bg-[#B87333]/[0.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B87333]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#B87333]" />
                  </span>
                  QEP OS &middot; Rental Lifecycle
                </span>
              </div>

              <h1
                className={cn(
                  "mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <span className="block text-white">From rental request</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">
                  to return-ready
                </span>
                <span className="block text-white">closeout.</span>
              </h1>

              <p
                className={cn(
                  "mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                Rental Equipment Lab is QEP OS's future rental command center — built to
                unify quoting, agreements, logistics, active rental tracking, inspections,
                deposit handling, and closeout into one guided operational flow.
              </p>

              {/* Status banner */}
              <div
                className={cn(
                  "mt-8 overflow-hidden rounded-2xl border border-[#B87333]/20 transition-all duration-700 delay-[400ms]",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <div className="bg-gradient-to-b from-[#B87333]/[0.10] to-[#B87333]/[0.03] px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B87333] opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#B87333]" />
                    </div>
                    <span className="text-sm font-bold text-white">Future operating layer for QEP rentals.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">
                    This module is designed to be built in phases, starting with rental intake
                    and agreement workflows and expanding into dispatch, inspection, deposit
                    handling, and utilization intelligence.
                  </p>
                </div>
              </div>

              {/* Hero CTA */}
              <div
                className={cn(
                  "mt-8 flex flex-wrap gap-3 transition-all duration-700 delay-500",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <button
                  onClick={() => scrollTo("lifecycle")}
                  className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]"
                >
                  See the lifecycle
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  onClick={() => scrollTo("value")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                >
                  What it unlocks
                </button>
              </div>
            </div>

            {/* Right — executive card */}
            <div
              className={cn(
                "transition-all duration-700 delay-[350ms]",
                heroLoaded ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-[0.97]",
              )}
            >
              <div className="relative">
                <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-[#B87333]/10 to-transparent blur-2xl" />
                <GlassCard className="relative rounded-[1.75rem] p-7 sm:p-8 border-white/[0.08] shadow-2xl shadow-black/40">
                  <h3 className="text-xl font-bold text-white mb-2">What owners should know</h3>
                  <p className="text-sm leading-relaxed text-white/50 mb-6">
                    Rental Equipment Lab is how QEP can professionalize and scale the entire
                    rental business inside the same platform that manages sales, QRM, and
                    intelligence.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        icon: Layers,
                        title: "What it is",
                        desc: "A connected rental operations module spanning the full lifecycle.",
                        color: "text-[#B87333]",
                        bg: "bg-[#B87333]/10 border-[#B87333]/15",
                      },
                      {
                        icon: AlertTriangle,
                        title: "Current opportunity",
                        desc: "Rental today is spread across people, paperwork, and admin handoffs.",
                        color: "text-amber-400",
                        bg: "bg-amber-400/10 border-amber-400/15",
                      },
                      {
                        icon: TrendingUp,
                        title: "Strategic upside",
                        desc: "Faster turns, cleaner accountability, stronger rental control.",
                        color: "text-emerald-400",
                        bg: "bg-emerald-400/10 border-emerald-400/15",
                      },
                      {
                        icon: Target,
                        title: "What changes next",
                        desc: "Rental becomes structured, visible, and scalable inside QEP OS.",
                        color: "text-sky-400",
                        bg: "bg-sky-400/10 border-sky-400/15",
                      },
                    ].map((card) => (
                      <div
                        key={card.title}
                        className={cn(
                          "rounded-xl border p-4 transition-all duration-200 hover:scale-[1.02]",
                          card.bg,
                        )}
                      >
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

      {/* ── WHAT IT IS ────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                What it is
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                Rental Equipment Lab is not just a rental agreement screen. It is the front
                door to a more controlled, visible, and scalable rental business.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
                  <Wrench className="h-5 w-5 text-[#B87333]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Built for rental execution</h3>
                <p className="text-sm leading-relaxed text-white/55">
                  Every rental has a lifecycle — intake, agreement, dispatch, active
                  management, return, and closeout. Today those steps live in different
                  places, with different people, and different levels of documentation. Rental
                  Equipment Lab brings it all into one connected flow so nothing gets dropped.
                </p>
              </GlassCard>
            </Reveal>
            <Reveal delay={200}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
                  <BarChart3 className="h-5 w-5 text-[#B87333]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Built for leadership visibility</h3>
                <p className="text-sm leading-relaxed text-white/55">
                  Rental activity stops being invisible. What's going out, what's late,
                  what's damaged, what needs billing — leadership gets a structured view of
                  the entire rental operation instead of chasing updates across departments
                  and spreadsheets.
                </p>
              </GlassCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — 6-Step Lifecycle ────────────────────────── */}
      <section id="lifecycle" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                How it works
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                Six connected stages that take a rental from first request through final
                billing — with every handoff, inspection, and decision point structured
                inside one system.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LifecycleStep
              number={1}
              title="Rental Intake"
              icon={ClipboardList}
              description="Capture the customer need, rental dates, requested asset, terms, attachments, and delivery requirements. Everything starts with a structured intake so nothing is assumed or forgotten."
              delay={0}
            />
            <LifecycleStep
              number={2}
              title="Agreement & Approval"
              icon={ShieldCheck}
              description="Generate the rental contract, define deposit requirements, confirm pricing and terms, and produce documentation. The agreement becomes a formal record, not a handshake."
              delay={80}
            />
            <LifecycleStep
              number={3}
              title="Delivery & Dispatch"
              icon={Truck}
              description="Coordinate traffic, schedule delivery windows, confirm on-site contacts, and manage logistics. Dispatch becomes visible and accountable, not a side conversation."
              delay={160}
            />
            <LifecycleStep
              number={4}
              title="Active Rental Management"
              icon={Activity}
              description="Track rental status, manage extensions, log field issues, record service events, and maintain communication. The rental stays visible from dispatch through return."
              delay={240}
            />
            <LifecycleStep
              number={5}
              title="Return & Inspection"
              icon={ScanSearch}
              description="Execute return inspection, document consumables usage, assess damage, and review equipment condition. Every return generates a structured record for billing and accountability."
              delay={320}
            />
            <LifecycleStep
              number={6}
              title="Deposit & Closeout"
              icon={Receipt}
              description="Process chargebacks, handle deposit returns, generate final billing, and close the rental into history. The lifecycle ends with a clean closeout, not an open thread."
              delay={400}
            />
          </div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS — Scale band ──────────────────────────── */}
      <section id="scale" className="scroll-mt-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B87333]/[0.06] to-transparent" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />

        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <Reveal>
                <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white mb-4">
                  Rental is a complete business vertical
                </h2>
                <p className="text-base leading-relaxed text-white/50 mb-4">
                  It is not a side process. It is not an afterthought bolted onto sales.
                  Rental has its own customers, its own logistics, its own revenue cycle, its
                  own accountability chain.
                </p>
                <p className="text-base leading-relaxed text-white/50">
                  As QEP grows, rental complexity grows with it. More assets, more customers,
                  more deliveries, more returns, more deposits, more handoffs. Rental
                  Equipment Lab is how QEP can scale the rental business without increasing
                  chaos.
                </p>
              </Reveal>
            </div>

            <Reveal delay={150}>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Truck, label: "Dispatch coordination", color: "text-sky-400" },
                  { icon: ScanSearch, label: "Return inspections", color: "text-emerald-400" },
                  { icon: DollarSign, label: "Deposit handling", color: "text-[#B87333]" },
                  { icon: BarChart3, label: "Utilization reporting", color: "text-violet-400" },
                  { icon: Bell, label: "Overdue alerts", color: "text-amber-400" },
                  { icon: Users, label: "Customer rental memory", color: "text-pink-400" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3.5 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]"
                  >
                    <item.icon className={cn("h-4 w-4 flex-shrink-0", item.color)} />
                    <span className="text-[13px] font-medium text-white/65">{item.label}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── VALUE CARDS ────────────────────────────────────────────── */}
      <section id="value" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                What it unlocks
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                Four outcomes that matter to every level of the rental operation.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard
              icon={Zap}
              title="Faster Rental Turnaround"
              description="From request to dispatch with fewer calls, fewer handoffs, and fewer missed details. Every rental starts faster and ends cleaner."
              delay={0}
            />
            <ValueCard
              icon={PackageCheck}
              title="Cleaner Handoffs"
              description="Delivery, active management, return, and billing each pass structured context to the next stage. Nothing falls through the cracks between departments."
              delay={100}
            />
            <ValueCard
              icon={Eye}
              title="Better Accountability"
              description="Every step produces a record. Every inspection is documented. Every deposit decision has a trail. Accountability stops being a verbal promise."
              delay={200}
            />
            <ValueCard
              icon={Gauge}
              title="Stronger Asset Utilization"
              description="Know what's available, what's out, what's underperforming, and what's due back. Asset intelligence becomes a decision-making tool, not a guessing game."
              delay={300}
            />
          </div>
        </div>
      </section>

      {/* ── FUTURE ROADMAP ─────────────────────────────────────────── */}
      <section id="future" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                What it becomes next
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                Rental Equipment Lab is designed to expand in phases. Here's the full vision
                once the foundation is in place.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Operational future */}
            <div>
              <Reveal>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5">
                  <Wrench className="h-4 w-4" />
                  Operational future
                </h3>
              </Reveal>
              <div className="space-y-3">
                <FutureItem icon={MapPin} label="Live fleet visibility and readiness" delay={0} />
                <FutureItem icon={Truck} label="Dispatch coordination and scheduling" delay={60} />
                <FutureItem icon={CalendarCheck} label="Rental extension management" delay={120} />
                <FutureItem icon={AlertTriangle} label="Field issue tracking and escalation" delay={180} />
                <FutureItem icon={Wrench} label="Service triggers from rental condition" delay={240} />
                <FutureItem icon={RotateCcw} label="Automated return inspection workflows" delay={300} />
              </div>
            </div>

            {/* Leadership future */}
            <div>
              <Reveal>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5">
                  <BarChart3 className="h-4 w-4" />
                  Leadership future
                </h3>
              </Reveal>
              <div className="space-y-3">
                <FutureItem icon={Gauge} label="Utilization insights by asset and category" delay={40} />
                <FutureItem icon={Clock} label="Overdue and at-risk rental alerts" delay={100} />
                <FutureItem icon={DollarSign} label="Profitability visibility per rental" delay={160} />
                <FutureItem icon={RotateCcw} label="Re-rental opportunity identification" delay={220} />
                <FutureItem icon={Users} label="Customer rental history and patterns" delay={280} />
                <FutureItem icon={TrendingUp} label="Operational bottleneck visibility" delay={340} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ──────────────────────────────────────────────── */}
      <section className="pb-20 pt-8">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl">
              <div className="absolute inset-0 bg-gradient-to-br from-[#B87333]/[0.12] via-white/[0.03] to-[#B87333]/[0.06]" />
              <div className="absolute inset-0 border border-[#B87333]/20 rounded-3xl" />
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/30 to-transparent" />
              <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-[#B87333]/[0.15] blur-[80px]" />

              <div className="relative px-6 py-12 sm:px-10 sm:py-14">
                <span className="inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-[#B87333] mb-4">
                  Executive positioning
                </span>
                <h2 className="text-[clamp(24px,3vw,38px)] font-bold tracking-[-0.03em] text-white max-w-3xl mb-4">
                  If Quote Builder modernizes equipment sales, Rental Equipment Lab
                  professionalizes and scales the entire rental business.
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-4">
                  Rental Equipment Lab is not waiting to become another software screen. It
                  is the future foundation for how QEP can run rental with greater discipline,
                  visibility, and scale — from first request through final closeout.
                </p>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">
                  Every missed handoff, every undocumented return, every deposit question that
                  requires a phone call — these are the problems that disappear when rental
                  operations move into a structured system.
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => scrollTo("lifecycle")}
                    className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]"
                  >
                    View the lifecycle
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                  <button
                    onClick={() => scrollTo("value")}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                  >
                    What it unlocks
                  </button>
                  <button
                    onClick={() => scrollTo("future")}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                  >
                    See the full vision
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Scroll hint ───────────────────────────────────────────── */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
        <ScrollHint />
      </div>
    </div>
  );
}

function ScrollHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY < 100);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-col items-center gap-1 animate-bounce text-white/25">
      <span className="text-[10px] font-medium uppercase tracking-widest">Scroll</span>
      <ChevronDown className="h-4 w-4" />
    </div>
  );
}
