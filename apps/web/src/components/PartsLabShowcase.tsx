import { useEffect, useRef, useState, useCallback } from "react";
import {
  Cog,
  Users,
  Search,
  DollarSign,
  PackageCheck,
  MessageSquare,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  BarChart3,
  Zap,
  Eye,
  Layers,
  Target,
  Repeat,
  BrainCircuit,
  Truck,
  ClipboardList,
  ShoppingCart,
  Store,
  Phone,
  Wrench,
  Globe,
  AlertTriangle,
  ChevronDown,
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
          Parts<span className="text-[#B87333]">Lab</span>
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

export function PartsLabShowcase(): React.ReactElement {
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
          "radial-gradient(ellipse 80% 50% at 80% 0%, rgba(184,115,51,0.09), transparent 50%), " +
          "radial-gradient(ellipse 50% 40% at 10% 100%, rgba(184,115,51,0.05), transparent 50%), " +
          "radial-gradient(ellipse 35% 25% at 55% 45%, rgba(184,115,51,0.03), transparent 50%), " +
          "linear-gradient(180deg, #1b1b1b 0%, #131313 100%)",
      }}
    >
      <StickyNav />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-[#B87333]/[0.06] blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-[15%] h-[350px] w-[350px] rounded-full bg-[#B87333]/[0.04] blur-[100px]" />

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
                  QEP OS &middot; Parts Operations
                </span>
              </div>

              <h1
                className={cn(
                  "mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <span className="block text-white">From parts request</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">
                  to fulfilled order
                </span>
                <span className="block text-white">flow.</span>
              </h1>

              <p
                className={cn(
                  "mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                Parts Operations Lab is QEP OS's future parts command center — built to
                unify customer context, equipment history, parts lookup, quoting, order
                handling, fulfillment, and future online parts commerce into one connected
                operational flow.
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
                    <span className="text-sm font-bold text-white">Future operating layer for QEP parts.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">
                    Designed to be built in phases — starting with parts lookup and customer
                    context, expanding into order handling, fulfillment workflows, and
                    eventually a full parts intelligence and commerce engine.
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
                  See the workflow
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
                    Parts is one of the most daily, repeatable, and relationship-defining
                    parts of the business. Parts Operations Lab is how QEP turns daily parts
                    activity into a connected revenue engine.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        icon: AlertTriangle,
                        title: "Already visible problem",
                        desc: "Parts today lives across calls, memory, counters, and separate systems.",
                        color: "text-amber-400",
                        bg: "bg-amber-400/10 border-amber-400/15",
                      },
                      {
                        icon: Target,
                        title: "Current opportunity",
                        desc: "Connect customer context, equipment history, and parts execution in one place.",
                        color: "text-[#B87333]",
                        bg: "bg-[#B87333]/10 border-[#B87333]/15",
                      },
                      {
                        icon: TrendingUp,
                        title: "Strategic upside",
                        desc: "Faster response, stronger retention, cleaner execution, better visibility.",
                        color: "text-emerald-400",
                        bg: "bg-emerald-400/10 border-emerald-400/15",
                      },
                      {
                        icon: Layers,
                        title: "What changes next",
                        desc: "Parts becomes structured, visible, and scalable across every channel.",
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
                Parts Operations Lab is not a parts counter screen. It is the front door to
                a more connected, more intelligent, more scalable parts business.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
                  <Cog className="h-5 w-5 text-[#B87333]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Built for parts execution</h3>
                <p className="text-sm leading-relaxed text-white/55">
                  Faster lookup. Cleaner handoffs. Linked customer, equipment, and parts
                  context at every step. Whether the request comes from the counter, the
                  phone, the service department, or eventually online — the system knows who
                  the customer is, what they own, and what they've bought before.
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
                  Parts activity stops being invisible. What's moving, what's stalled, what
                  channels are performing, where fulfillment is bottlenecked — leadership
                  gets a structured view instead of chasing updates. Parts revenue becomes
                  visible, accountable, and reportable.
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
                Six connected stages that take a parts interaction from first request
                through fulfillment and future intelligence — with customer context and
                equipment history woven into every step.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LifecycleStep
              number={1}
              title="Customer & Equipment Context"
              icon={Users}
              description="Start with who the customer is and what machine or fleet they own. Equipment history, past purchases, and service records provide the context that makes every parts interaction faster and smarter."
              delay={0}
            />
            <LifecycleStep
              number={2}
              title="Parts Identification"
              icon={Search}
              description="Find the right part with history, compatibility, and supporting context. The system surfaces what fits, what's been ordered before, and what related items are commonly needed alongside it."
              delay={80}
            />
            <LifecycleStep
              number={3}
              title="Quote & Availability"
              icon={DollarSign}
              description="Surface pricing, stock status, substitutes, related items, and timing. Give the customer a clear answer with confidence — what's available, what's on order, and when it arrives."
              delay={160}
            />
            <LifecycleStep
              number={4}
              title="Order & Fulfillment"
              icon={PackageCheck}
              description="Move from request to counter pickup, internal issue, shipment, or service-linked delivery. Every order has a clear path from confirmation to completion, regardless of channel."
              delay={240}
            />
            <LifecycleStep
              number={5}
              title="Follow-Through & Communication"
              icon={MessageSquare}
              description="Order status, customer updates, backorder handling, and next steps. No customer should have to call back to ask where their parts are. No order should go quiet."
              delay={320}
            />
            <LifecycleStep
              number={6}
              title="Parts Intelligence & Growth"
              icon={BrainCircuit}
              description="Capture what was sold, to whom, for what equipment, and what that means next. Every transaction adds to the system's understanding of demand patterns, customer needs, and future opportunities."
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
                  Parts is a revenue engine, not a side workflow
                </h2>
                <p className="text-base leading-relaxed text-white/50 mb-4">
                  When parts is fragmented — across calls, memory, notes, counters, and
                  separate systems — the company loses speed, visibility, and repeat revenue.
                  Opportunities are missed. Customers wait longer than they should. Nobody
                  knows what's working and what's falling through the cracks.
                </p>
                <p className="text-base leading-relaxed text-white/50">
                  When parts is connected, the company gets sharper, faster, and more
                  valuable to the customer. The best parts businesses don't just sell what
                  was asked for. They remember, guide, recommend, and follow through better
                  than everyone else.
                </p>
              </Reveal>
            </div>

            <Reveal delay={150}>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Store, label: "Counter walk-in", color: "text-[#B87333]" },
                  { icon: Phone, label: "Phone orders", color: "text-sky-400" },
                  { icon: Wrench, label: "Service-linked parts", color: "text-emerald-400" },
                  { icon: Globe, label: "Online commerce", color: "text-violet-400" },
                  { icon: ClipboardList, label: "Internal requests", color: "text-amber-400" },
                  { icon: ShoppingCart, label: "Repeat purchases", color: "text-pink-400" },
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
                Four outcomes that change how parts operates at every level.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard
              icon={Zap}
              title="Faster Parts Response"
              description="Customer context and equipment history surface immediately. Every request starts with what the system already knows, not from scratch."
              delay={0}
            />
            <ValueCard
              icon={Eye}
              title="Fewer Missed Opportunities"
              description="Related items, past purchases, and compatible parts surface during the workflow. The system helps the team see what else the customer might need."
              delay={100}
            />
            <ValueCard
              icon={PackageCheck}
              title="Cleaner Fulfillment"
              description="Every order has a structured path from request to completion. Backorders, substitutions, and delivery coordination stay visible and accountable."
              delay={200}
            />
            <ValueCard
              icon={Repeat}
              title="Better Customer Memory"
              description="The system remembers what every customer owns, what they've bought, and what they're likely to need next. Repeat business becomes a system capability, not a personal memory."
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
                Parts Operations Lab is designed to expand in phases. Here's the full vision
                once the foundation is in place.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Operational future */}
            <div>
              <Reveal>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#B87333] mb-5">
                  <Cog className="h-4 w-4" />
                  Operational future
                </h3>
              </Reveal>
              <div className="space-y-3">
                <FutureItem icon={Layers} label="Unified counter / phone / service / online workflow" delay={0} />
                <FutureItem icon={ShoppingCart} label="Live inventory and order context" delay={60} />
                <FutureItem icon={Wrench} label="Linked parts-to-equipment history" delay={120} />
                <FutureItem icon={Truck} label="Fulfillment visibility across channels" delay={180} />
                <FutureItem icon={Search} label="Related-item recommendations" delay={240} />
                <FutureItem icon={ShieldCheck} label="Smarter handoff and exception handling" delay={300} />
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
                <FutureItem icon={Store} label="Channel visibility and performance" delay={40} />
                <FutureItem icon={TrendingUp} label="Demand insight and trend detection" delay={100} />
                <FutureItem icon={Repeat} label="Repeat-purchase intelligence" delay={160} />
                <FutureItem icon={Target} label="Opportunity detection and upsell signals" delay={220} />
                <FutureItem icon={Users} label="Customer retention signals and re-engagement" delay={280} />
                <FutureItem icon={BarChart3} label="Parts performance reporting" delay={340} />
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
                  Where parts sales, customer memory, and execution finally connect.
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-4">
                  Parts Operations Lab is not waiting to become another software screen. It
                  is the future foundation for how QEP can run parts with greater speed,
                  memory, visibility, and scale.
                </p>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">
                  Every missed recommendation, every customer who has to re-explain what they
                  own, every order that goes quiet between request and fulfillment — these
                  are the problems that disappear when parts operations move into a connected
                  system that remembers, guides, and follows through.
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => scrollTo("lifecycle")}
                    className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]"
                  >
                    View the workflow
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
