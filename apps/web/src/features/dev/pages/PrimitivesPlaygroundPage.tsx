/**
 * Primitives Playground — in-app visual test coverage for the Wave 6.1
 * shared primitives. Reuses the existing app shell instead of pulling in
 * Storybook as a dev dependency.
 *
 * Each primitive gets a section with every prop variant rendered
 * side-by-side. This is the "Storybook polish pass" deliverable from
 * the v2-next punch list, executed as an in-app page so the full app
 * context (routing, theming, react-query) is available without tooling.
 *
 * Route: /dev/primitives (admin+ only)
 */
import { Card } from "@/components/ui/card";
import {
  StatusChipStack,
  CountdownBar,
  ForwardForecastBar,
  DashboardPivotToggle,
  AskIronAdvisorButton,
  type ChipTone,
  type CountdownTone,
} from "@/components/primitives";
import { useState } from "react";
import {
  AlertTriangle, Clock, FileText, TrendingUp, Wrench, DollarSign,
} from "lucide-react";

export function PrimitivesPlaygroundPage() {
  const [pivot, setPivot] = useState("service");

  const allChipTones: ChipTone[] = ["pink", "orange", "yellow", "blue", "green", "red", "purple", "neutral"];
  const allCountdownTones: CountdownTone[] = ["blue", "green", "yellow", "orange", "red", "neutral"];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Primitives Playground</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          In-app visual coverage for every Wave 6.1 shared primitive. Use this
          page during development to verify prop variants without spinning up
          Storybook. Admin+ only.
        </p>
      </div>

      {/* StatusChipStack */}
      <Section title="StatusChipStack" description="8 tones + max-with-overflow behavior">
        <VariantRow label="All tones">
          <StatusChipStack chips={allChipTones.map((tone) => ({ label: tone, tone }))} />
        </VariantRow>
        <VariantRow label="With icon">
          <StatusChipStack chips={[
            { label: "overdue", tone: "red", icon: <AlertTriangle className="h-2.5 w-2.5" /> },
            { label: "in progress", tone: "orange", icon: <Clock className="h-2.5 w-2.5" /> },
          ]} />
        </VariantRow>
        <VariantRow label="Max=2 overflow">
          <StatusChipStack
            max={2}
            chips={[
              { label: "a", tone: "blue" },
              { label: "b", tone: "green" },
              { label: "c", tone: "red" },
              { label: "d", tone: "violet" as ChipTone },
            ]}
          />
        </VariantRow>
        <VariantRow label="Empty"><StatusChipStack chips={[]} /></VariantRow>
      </Section>

      {/* CountdownBar */}
      <Section title="CountdownBar" description="6 tones + inverse semantics">
        {allCountdownTones.map((tone) => (
          <VariantRow key={tone} label={`tone=${tone}`}>
            <CountdownBar label="250hr service" current={180} target={250} unit="hours" tone={tone} />
          </VariantRow>
        ))}
        <VariantRow label="Inverse (consumed view)">
          <CountdownBar label="Warranty" current={90} target={365} unit="days" tone="green" inverse />
        </VariantRow>
        <VariantRow label="Expired (current > target)">
          <CountdownBar label="Overdue" current={300} target={250} unit="hours" tone="red" />
        </VariantRow>
      </Section>

      {/* ForwardForecastBar */}
      <Section title="ForwardForecastBar" description="Click-through counter strip">
        <VariantRow label="5 counters">
          <ForwardForecastBar
            counters={[
              { label: "Service intervals",    value: 92, tone: "orange", icon: <Wrench className="h-4 w-4" /> },
              { label: "Budget cycle",         value: 14, tone: "blue",   icon: <Clock className="h-4 w-4" /> },
              { label: "SLA risk",             value: 7,  tone: "red",    icon: <AlertTriangle className="h-4 w-4" /> },
              { label: "Quotes expiring",      value: "$340K", tone: "violet", icon: <FileText className="h-4 w-4" /> },
              { label: "Trade-up windows",     value: 23, tone: "green",  icon: <TrendingUp className="h-4 w-4" /> },
            ]}
          />
        </VariantRow>
        <VariantRow label="With click-throughs">
          <ForwardForecastBar
            counters={[
              { label: "Open quotes", value: 12, tone: "blue", href: "/quotes" },
              { label: "Revenue", value: "$1.2M", tone: "green", icon: <DollarSign className="h-4 w-4" />, href: "/exec" },
            ]}
          />
        </VariantRow>
      </Section>

      {/* DashboardPivotToggle */}
      <Section title="DashboardPivotToggle" description="Tab pivot for dashboards">
        <VariantRow label={`Current: ${pivot}`}>
          <DashboardPivotToggle
            value={pivot}
            onChange={setPivot}
            pivots={[
              { key: "service", label: "Service", icon: <Wrench className="h-3 w-3" /> },
              { key: "parts",   label: "Parts",   icon: <DollarSign className="h-3 w-3" /> },
              { key: "sales",   label: "Sales",   icon: <TrendingUp className="h-3 w-3" /> },
            ]}
          />
        </VariantRow>
      </Section>

      {/* AskIronAdvisorButton */}
      <Section title="AskIronAdvisorButton" description="Contextual AI entry point">
        <VariantRow label="Inline">
          <AskIronAdvisorButton contextType="company" contextId="example" variant="inline" />
        </VariantRow>
        <VariantRow label="Floating (not shown — check bottom-right of page)">
          <p className="text-[10px] text-muted-foreground italic">
            Floating variant uses fixed positioning; not previewed inline to avoid layout churn.
          </p>
        </VariantRow>
      </Section>

      {/* Data-backed primitives note */}
      <Section title="Data-backed primitives" description="Skip in playground — they hit live RPCs">
        <p className="text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">AssetCountdownStack</code>,{" "}
          <code className="rounded bg-muted px-1">AssetBadgeRow</code>,{" "}
          <code className="rounded bg-muted px-1">Last24hStrip</code>, and{" "}
          <code className="rounded bg-muted px-1">MapLibreCanvas</code>/
          <code className="rounded bg-muted px-1">MapWithSidebar</code> read from
          live data and are covered on their production surfaces (Asset 360,
          Fleet Map, Portal Fleet Mirror). <code className="rounded bg-muted px-1">FilterBar</code>{" "}
          reads from URL search params and is covered by the Exception Inbox +
          Service Dashboard surfaces.
        </p>
      </Section>
    </div>
  );
}

/* ── Layout helpers ──────────────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

function VariantRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-2 rounded-md border border-border/50 bg-muted/10 p-2 sm:grid-cols-[140px_1fr]">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
