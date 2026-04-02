import { useEffect, useRef, useState, useCallback } from "react";
import {
  Zap,
  ShieldCheck,
  BarChart3,
  FileText,
  Users,
  Package,
  ClipboardCheck,
  Rocket,
  ArrowRight,
  CheckCircle2,
  Lock,
  Cpu,
  TrendingUp,
  Calculator,
  PenTool,
  Globe,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Intersection Observer hook for scroll-triggered animations ────────── */

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

/* ─── Animated counter ──────────────────────────────────────────────────── */

function AnimatedCounter({ target, suffix = "", duration = 1800 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const { ref, visible } = useInView();

  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = Math.max(1, Math.ceil(target / (duration / 16)));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [visible, target, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {count.toLocaleString()}{suffix}
    </span>
  );
}

/* ─── Scroll-aware sticky nav ───────────────────────────────────────────── */

const NAV_SECTIONS = [
  { id: "workflow", label: "Workflow" },
  { id: "proof", label: "Proof" },
  { id: "value", label: "Value" },
  { id: "future", label: "Next" },
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
          Quote<span className="text-[#B87333]">Builder</span>
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

/* ─── Step card for the workflow ─────────────────────────────────────────── */

function StepCard({
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

/* ─── Proof pill ─────────────────────────────────────────────────────────── */

function ProofPill({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <Reveal delay={delay}>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[13px] font-medium text-white/65 transition-all duration-200 hover:border-[#B87333]/25 hover:text-white/80 hover:bg-[#B87333]/[0.05]">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/70 flex-shrink-0" />
        {children}
      </span>
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

export function QuoteBuilderGate(): React.ReactElement {
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
          "radial-gradient(ellipse 80% 50% at 80% 0%, rgba(184,115,51,0.10), transparent 50%), " +
          "radial-gradient(ellipse 60% 40% at 20% 100%, rgba(184,115,51,0.06), transparent 50%), " +
          "linear-gradient(180deg, #1b1b1b 0%, #141414 100%)",
      }}
    >
      <StickyNav />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-[#B87333]/[0.07] blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-[#B87333]/[0.04] blur-[100px]" />

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
                  QEP OS &middot; Dealer Workflow
                </span>
              </div>

              <h1
                className={cn(
                  "mt-6 text-[clamp(36px,6vw,72px)] font-black leading-[0.95] tracking-[-0.04em] transition-all duration-700 delay-200",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <span className="block text-white">From quote request</span>
                <span className="block bg-gradient-to-r from-[#B87333] via-[#D4944A] to-[#B87333] bg-clip-text text-transparent">
                  to proposal-ready
                </span>
                <span className="block text-white">deal flow.</span>
              </h1>

              <p
                className={cn(
                  "mt-6 max-w-xl text-lg leading-relaxed text-white/55 transition-all duration-700 delay-300",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                Quote Builder is QEP OS's dealership-grade quoting engine — built to turn
                customer demand, equipment selection, pricing context, and proposal creation
                into one guided workflow.
              </p>

              {/* Status banner */}
              <div
                className={cn(
                  "mt-8 overflow-hidden rounded-2xl border border-emerald-500/20 transition-all duration-700 delay-[400ms]",
                  heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
                )}
              >
                <div className="bg-gradient-to-b from-emerald-500/[0.12] to-emerald-500/[0.04] px-5 py-4">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-sm font-bold text-white">Built and ready for activation.</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-white/50 pl-[18px]">
                    The workflow, CRM persistence, and AI insight layers are already in place.
                    Live dealer inventory and pricing unlock when IntelliDealer or Telapath
                    credentials are connected.
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
                  onClick={() => scrollTo("workflow")}
                  className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]"
                >
                  See the workflow
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  onClick={() => scrollTo("proof")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                >
                  What's already built
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
                    This is not a concept screen. The UI is already built. The missing step is
                    the live inventory connection that turns this into a production quoting
                    workflow.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        icon: CheckCircle2,
                        title: "Already built",
                        desc: "Three-step guided flow, CRM save, AI insight surfaces.",
                        color: "text-emerald-400",
                        bg: "bg-emerald-400/10 border-emerald-400/15",
                      },
                      {
                        icon: Lock,
                        title: "Current blocker",
                        desc: "No live IntelliDealer / Telapath credentials configured.",
                        color: "text-amber-400",
                        bg: "bg-amber-400/10 border-amber-400/15",
                      },
                      {
                        icon: TrendingUp,
                        title: "Strategic upside",
                        desc: "Faster quotes, stronger pricing, cleaner proposals.",
                        color: "text-[#B87333]",
                        bg: "bg-[#B87333]/10 border-[#B87333]/15",
                      },
                      {
                        icon: Rocket,
                        title: "What changes next",
                        desc: "Gate → live quoting engine the moment catalog data connects.",
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
                Quote Builder is not just a quote screen. It is the front door to faster
                quoting, cleaner proposals, stronger pricing discipline, and better sales
                execution.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
                  <Zap className="h-5 w-5 text-[#B87333]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Built for dealership speed</h3>
                <p className="text-sm leading-relaxed text-white/55">
                  It gives reps a guided path from customer information to equipment
                  configuration to proposal review — while surfacing AI-powered customer and
                  market context inside the flow.
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
                  Instead of quote activity living in disconnected notes, texts, and
                  spreadsheets, it becomes part of the CRM system of record and future
                  commercial reporting layer.
                </p>
              </GlassCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — 3-Step Workflow ──────────────────────────── */}
      <section id="workflow" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                How it works
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                A three-step quoting flow designed to be simple for reps and credible for
                leadership.
              </p>
            </div>
          </Reveal>

          {/* Connecting line */}
          <div className="relative">
            <div className="absolute left-[23px] top-6 bottom-6 w-px bg-gradient-to-b from-[#B87333]/30 via-[#B87333]/15 to-transparent hidden md:block lg:hidden" />
            <div className="grid gap-5 md:grid-cols-3">
              <StepCard
                number={1}
                title="Customer Info"
                icon={Users}
                description="Capture who the quote is for, the company, the buyer context, and deal details so the proposal starts with the right commercial frame."
                delay={0}
              />
              <StepCard
                number={2}
                title="Equipment Selection"
                icon={Package}
                description="Browse machines, attachments, and categories from the catalog source and build the package around the customer's real need."
                delay={150}
              />
              <StepCard
                number={3}
                title="Proposal / Review"
                icon={ClipboardCheck}
                description="Review line items, pricing, and proposal-ready structure before saving the quote into CRM for follow-through and future reporting."
                delay={300}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── PROOF BAND — What exists today ─────────────────────────── */}
      <section id="proof" className="scroll-mt-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#B87333]/[0.06] to-transparent" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#B87333]/20 to-transparent" />

        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>
              <Reveal>
                <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white mb-3">
                  What already exists today
                </h2>
                <p className="text-base leading-relaxed text-white/50 mb-8">
                  The foundation is already there. The product is farther along than the
                  current lock screen makes it appear.
                </p>
              </Reveal>

              {/* Animated proof counters */}
              <Reveal delay={150}>
                <div className="grid grid-cols-3 gap-4 mb-8">
                  {[
                    { value: 1500, suffix: "+", label: "Lines of code" },
                    { value: 3, suffix: "", label: "Workflow steps" },
                    { value: 6, suffix: "", label: "AI integrations" },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <div className="text-2xl sm:text-3xl font-black text-[#B87333]">
                        <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                      </div>
                      <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-white/40">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {[
                "Full QuoteBuilderPage already built",
                "3-step wizard already implemented",
                "Mock equipment catalog already functioning",
                "CRM quote save / update already working",
                "AI customer insight already integrated",
                "AI market valuation already integrated",
                "Print-ready PDF proposal layout",
                "CRM deal + contact linking",
              ].map((text, i) => (
                <ProofPill key={text} delay={i * 60}>
                  {text}
                </ProofPill>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── BLOCKER SECTION ────────────────────────────────────────── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Reveal>
            <div className="mb-10">
              <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white">
                What is blocking go-live
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                This is a connection problem, not a product-invention problem.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <GlassCard className="h-full">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 border border-amber-400/15">
                    <Lock className="h-4 w-4 text-amber-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Current blocker</h3>
                </div>
                <ul className="space-y-3 text-sm leading-relaxed text-white/55">
                  <li className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400/50" />
                    Live IntelliDealer or Telapath catalog connection is not configured in production.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400/50" />
                    The app shows a gate instead of exposing the workflow.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400/50" />
                    Once credentials and integration mapping are in place, the gate becomes the
                    real quoting engine.
                  </li>
                </ul>
              </GlassCard>
            </Reveal>

            <Reveal delay={200}>
              <GlassCard copper className="h-full">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 border border-emerald-400/15">
                    <Rocket className="h-4 w-4 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white">What activation unlocks</h3>
                </div>
                <ul className="space-y-3 text-sm leading-relaxed text-white/55">
                  {[
                    "Live inventory and availability",
                    "Higher quoting confidence",
                    "Cleaner internal pilot rollout",
                    "A direct path to proposal automation and finance workflows",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              </GlassCard>
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
                Why it matters
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/50">
                Quote Builder becomes a revenue workflow, not just another screen in the CRM.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ValueCard
              icon={Zap}
              title="Speed to Quote"
              description="Reduce rep friction and quote turnaround time. Get from customer request to printable proposal in under 5 minutes."
              delay={0}
            />
            <ValueCard
              icon={ShieldCheck}
              title="Pricing Confidence"
              description="Pull quoting closer to real inventory and pricing truth. AI surfaces market valuations and customer pricing history."
              delay={100}
            />
            <ValueCard
              icon={FileText}
              title="Proposal Quality"
              description="Standardize how equipment packages are presented. Every quote exits the system with the same professional structure."
              delay={200}
            />
            <ValueCard
              icon={BarChart3}
              title="Executive Visibility"
              description="Capture quote activity inside CRM for downstream control, reporting, and commercial pattern analysis."
              delay={300}
            />
          </div>
        </div>
      </section>

      {/* ── FUTURE ROADMAP ─────────────────────────────────────────── */}
      <section id="future" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <Reveal>
                <h2 className="text-[clamp(28px,3.5vw,42px)] font-bold tracking-[-0.03em] text-white mb-3">
                  What it becomes next
                </h2>
                <p className="text-base leading-relaxed text-white/50 mb-8">
                  Once the catalog connection is on, the path forward is straightforward.
                </p>
              </Reveal>

              <div className="space-y-3">
                <FutureItem icon={Globe} label="Live inventory and availability" delay={0} />
                <FutureItem icon={Cpu} label="Real-time pricing engine" delay={80} />
                <FutureItem icon={Calculator} label="Financing calculator integration" delay={160} />
                <FutureItem icon={FileText} label="PDF proposal generation" delay={240} />
                <FutureItem icon={PenTool} label="E-signature workflow" delay={320} />
              </div>
            </div>

            <Reveal delay={200}>
              <GlassCard copper className="h-fit lg:mt-16">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#B87333]/10 border border-[#B87333]/20">
                  <TrendingUp className="h-5 w-5 text-[#B87333]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Executive takeaway</h3>
                <p className="text-sm leading-relaxed text-white/55 mb-4">
                  This is already more built than it appears. Quote Builder is not waiting to
                  be invented. It is waiting to be connected.
                </p>
                <p className="text-sm leading-relaxed text-white/55">
                  Once the dealer-system integration is turned on, QEP OS gains a quoting
                  experience positioned to become a core revenue workflow — with AI insights,
                  CRM persistence, and proposal generation already wired in.
                </p>
              </GlassCard>
            </Reveal>
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
                  Final positioning
                </span>
                <h2 className="text-[clamp(24px,3vw,38px)] font-bold tracking-[-0.03em] text-white max-w-2xl mb-4">
                  This is already more built than it appears.
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-white/50 mb-8">
                  Quote Builder is not waiting to be invented. It is waiting to be connected.
                  Once the dealer-system integration is turned on, QEP OS gains a quoting
                  experience positioned to become a core revenue workflow.
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => scrollTo("workflow")}
                    className="group inline-flex items-center gap-2 rounded-full bg-[#B87333] px-6 py-3 text-sm font-bold text-[#111] shadow-lg shadow-[#B87333]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#B87333]/30 hover:brightness-110 active:scale-[0.98]"
                  >
                    View workflow
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                  <button
                    onClick={() => scrollTo("proof")}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                  >
                    See activation path
                  </button>
                  <button
                    onClick={() => scrollTo("future")}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition-all duration-200 hover:border-white/[0.2] hover:bg-white/[0.07] active:scale-[0.98]"
                  >
                    Read what comes next
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Scroll hint (visible only at top) ──────────────────────── */}
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
