import { useEffect } from "react";
import type { UserRole } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  FileText,
  MessageSquare,
  Mic,
  Sparkles,
  Truck,
} from "lucide-react";

export interface FloorPageProps {
  userId: string;
  userRole: UserRole;
  userFullName: string | null;
  ironRoleFromProfile?: string | null;
}

type FlowStage = "entry" | "customer" | "equipment" | "trade" | "financing" | "review";

type FlowScreen = {
  number: number;
  stage: FlowStage;
  label: string;
  brief: string;
  title: string;
};

const FLOW_SCREENS: FlowScreen[] = [
  {
    number: 1,
    stage: "entry",
    label: "Entry",
    brief: "Choose how to start the quote.",
    title: "Quote Builder",
  },
  {
    number: 2,
    stage: "customer",
    label: "Customer",
    brief: "Identify the customer and pull in commercial context.",
    title: "Quote Builder",
  },
  {
    number: 3,
    stage: "equipment",
    label: "Equipment",
    brief: "Find the right machine and build the package.",
    title: "Quote Builder",
  },
  {
    number: 4,
    stage: "trade",
    label: "Trade-In",
    brief: "Capture trade value without breaking flow.",
    title: "Point, Shoot, Trade",
  },
  {
    number: 5,
    stage: "financing",
    label: "Financing",
    brief: "Structure the deal and determine what gets financed.",
    title: "Financing",
  },
  {
    number: 6,
    stage: "review",
    label: "Review",
    brief: "Confirm the quote is ready to send.",
    title: "Quote Summary",
  },
];

const STEPS = ["Entry", "Customer", "Equipment", "4 Trade-In", "Financing", "Review"];

const CUSTOMER_STATS = [
  ["Open deals", "1"],
  ["Past quotes", "3"],
  ["Last touch", "2 days ago"],
  ["Fleet size", "12"],
  ["Credit tier", "A"],
];

const PIPELINE_ROWS = [
  { name: "Sales Teams", value: "$209K", idle: "15.1d", pre: 14, close: 0, post: 100 },
  { name: "QA Tenant B", value: "$123K", idle: "18.7d", pre: 13, close: 0, post: 61 },
  { name: "Cole Bryant", value: "$827K", idle: "17d", pre: 0, close: 0, post: 44 },
];

export function FloorPage(_props: FloorPageProps) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#03070a] text-slate-100 antialiased">
      <main className="mx-auto max-w-[1920px] px-2 py-2">
        <div className="mb-2">
          <div>
            <h1 className="text-lg font-bold text-white sm:text-2xl">
              <span className="text-[#f28a07]">THE FLOOR</span> — Sales Quote Flow Redesign · Phase 1
            </h1>
          </div>
        </div>

        <section className="grid gap-3 xl:grid-cols-3">
          {FLOW_SCREENS.map((screen) => (
            <FlowPanel key={screen.stage} screen={screen} />
          ))}
        </section>
      </main>
    </div>
  );
}

function FlowPanel({ screen }: { screen: FlowScreen }) {
  return (
    <article className="min-h-[560px] border border-[#243650] bg-[#08131f] shadow-[0_20px_80px_-55px_rgba(242,138,7,0.6)]">
      <div className="border-b border-[#20324a] bg-[#0c1928] px-3 py-2">
        <p className="text-sm font-bold text-white">
          {screen.number}. {screen.label}
          <span className="ml-2 font-normal text-slate-400">— {screen.brief}</span>
        </p>
      </div>

      <div className="h-[calc(100%-37px)] p-3">
        <div className="flex h-full min-h-[505px] flex-col border border-[#1f3148] bg-[#07111d]">
          <MiniTopBar />
          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_150px] gap-2 p-3 2xl:grid-cols-[minmax(0,1fr)_170px]">
            <div className="min-w-0">
              <MiniTitle screen={screen} />
              <Stepper active={screen.number} />
              <ScreenBody stage={screen.stage} />
            </div>
            <RecommendationRail stage={screen.stage} />
          </div>
        </div>
      </div>
    </article>
  );
}

function MiniTopBar() {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[#18283d] px-3 text-[10px]">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 font-bold uppercase text-[#f28a07]">
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to the Floor
        </span>
        <span className="text-slate-400">QRM</span>
        <span className="text-[#f28a07]">Sales</span>
        <span className="text-slate-400">Parts</span>
        <span className="text-slate-400">Service</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden rounded border border-[#243650] bg-[#0b1624] px-8 py-1 text-slate-500 2xl:block">
          Search...
        </span>
        <span className="rounded bg-[#f28a07] px-2 py-1 font-bold text-[#160d03]">New Quote</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f6c38b] text-[9px] font-bold text-[#371b05]">
          BL
        </span>
      </div>
    </div>
  );
}

function MiniTitle({ screen }: { screen: FlowScreen }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-white">{screen.title}</h2>
        <p className="mt-0.5 text-[10px] text-slate-400">
          {screen.stage === "entry"
            ? "Create faster with AI, voice, or manual entry."
            : screen.stage === "review"
              ? "Confirm readiness before sending."
              : "Build the quote with live deal context."}
        </p>
      </div>
      {screen.stage === "trade" ? (
        <span className="rounded-full border border-[#334762] px-2 py-1 text-[10px] text-slate-300">
          Moonshot
        </span>
      ) : null}
    </div>
  );
}

function Stepper({ active }: { active: number }) {
  return (
    <div className="my-4 grid grid-cols-6 items-center gap-1">
      {STEPS.map((step, index) => {
        const stepNumber = index + 1;
        const isDone = stepNumber < active;
        const isActive = stepNumber === active;
        return (
          <div key={step} className="min-w-0">
            <div className="flex items-center">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                  isActive
                    ? "border-[#f28a07] bg-[#f28a07] text-[#160d03]"
                    : isDone
                      ? "border-[#38536f] bg-[#142236] text-slate-300"
                      : "border-[#273951] text-slate-500",
                )}
              >
                {isDone ? <Check className="h-3 w-3" aria-hidden="true" /> : stepNumber}
              </span>
              {stepNumber < STEPS.length ? <span className="h-px flex-1 bg-[#25374f]" /> : null}
            </div>
            <p className={cn("mt-1 truncate text-[9px]", isActive ? "text-[#f28a07]" : "text-slate-500")}>
              {step}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ScreenBody({ stage }: { stage: FlowStage }) {
  if (stage === "entry") return <EntryBody />;
  if (stage === "customer") return <CustomerBody />;
  if (stage === "equipment") return <EquipmentBody />;
  if (stage === "trade") return <TradeBody />;
  if (stage === "financing") return <FinancingBody />;
  return <ReviewBody />;
}

function EntryBody() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Urgency signal", "No voice signal attached yet."],
          ["Next move", "Capture the customer need clearly so QRM can seed the workspace correctly."],
          ["Pipeline carry-through", "Deal linkage should happen before this opportunity goes cold."],
        ].map(([label, body]) => (
          <InfoBox key={label} label={label} body={body} />
        ))}
      </div>
      <p className="text-xs text-slate-300">How would you like to start?</p>
      <div className="grid grid-cols-3 gap-2">
        <StartMode icon={Mic} title="Voice" body="Record a deal description. AI populates the quote workspace." action="Start Voice" />
        <StartMode icon={MessageSquare} title="AI Chat" body="Type the opportunity. AI recommends the best setup." action="Start Chat" />
        <StartMode icon={FileText} title="Manual" body="Build the quote directly from the commercial workspace." action="Start Manually" active />
      </div>
      <button className="rounded border border-[#263a55] bg-[#101d2d] px-4 py-2 text-[11px] text-slate-300">
        Open Drafts
      </button>
    </div>
  );
}

function CustomerBody() {
  return (
    <div className="space-y-3">
      <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#24344d] text-xs">RR</span>
            <div>
              <p className="text-sm font-semibold text-white">Red River Demolition</p>
              <p className="text-[10px] text-slate-400">Amanda Chen · 905-555-0505</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-bold text-emerald-300">
            CRM match
          </span>
        </div>
      </div>
      <div className="rounded border border-[#263a55] bg-[#0e1827] p-3">
        <p className="text-[11px] font-semibold text-white">Customer Digital Twin</p>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {CUSTOMER_STATS.map(([label, value]) => (
            <div key={label}>
              <p className="text-[9px] uppercase text-slate-500">{label}</p>
              <p className="text-sm font-semibold text-slate-100">{value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <InfoBox label="Top open deal" body="Land clearing expansion · Est. close May 28, 2025 · $72,000" />
        <InfoBox label="Last touch" body="Phone call with Amanda. Looking to clear additional land for new development phase." />
      </div>
      <div className="flex items-center justify-between rounded border border-[#8a520f] bg-[#171411] p-3">
        <span>
          <span className="block text-xs font-semibold text-white">Recommended Next CTA</span>
          <span className="text-[10px] text-slate-400">Follow up on expansion timeline and confirm machine needs.</span>
        </span>
        <button className="rounded bg-[#1d2d45] px-3 py-1.5 text-[10px] text-[#f28a07]">Log Next Step</button>
      </div>
    </div>
  );
}

function EquipmentBody() {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 border-b border-[#233650] text-xs">
        <span className="border-b-2 border-transparent px-2 pb-2 text-slate-400">Catalog Search</span>
        <span className="border-b-2 border-[#f28a07] px-2 pb-2 text-[#f28a07]">AI Recommended</span>
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded border border-[#263a55] bg-[#101a29] p-3">
        <div className="flex h-24 items-center justify-center rounded bg-gradient-to-br from-slate-200 to-slate-500 text-slate-950">
          <Truck className="h-12 w-12" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Bobcat T76 (2026)</p>
          <p className="text-[10px] text-slate-400">Compact Track Loader</p>
          <p className="mt-2 text-[10px] text-slate-400">Attachments: Mowing, Grading Blade</p>
          <p className="text-[10px] text-slate-400">74.3 HP · 8,700 lb Operating Weight</p>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded border border-[#314965] px-3 py-1.5 text-[10px] text-slate-300">View Details</button>
            <button className="rounded bg-[#f28a07] px-3 py-1.5 text-[10px] font-bold text-[#160d03]">Select Machine</button>
          </div>
        </div>
      </div>
      <SelectedEquipment />
      <div className="grid grid-cols-4 gap-2">
        {["Price check", "Availability", "Fleet fit", "Maint. plan"].map((item) => (
          <div key={item} className="rounded border border-[#263a55] bg-[#101a29] p-2">
            <p className="text-[9px] uppercase text-slate-500">{item}</p>
            <p className="text-[10px] text-emerald-300">Good match</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeBody() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[145px_minmax(0,1fr)] gap-3 rounded border border-[#263a55] bg-[#101a29] p-3">
        <div className="flex min-h-44 flex-col items-center justify-center rounded border border-dashed border-[#516780] text-center text-slate-400">
          <Camera className="h-8 w-8" aria-hidden="true" />
          <p className="mt-2 text-xs">Snap a photo of the trade equipment</p>
          <button className="mt-4 rounded bg-[#f28a07] px-4 py-2 text-[10px] font-bold text-[#160d03]">Take Photo</button>
        </div>
        <div className="space-y-2">
          <MiniField label="Equipment Description" value="2019 CAT 320 Excavator" />
          <div className="grid grid-cols-2 gap-2">
            <MiniField label="Hours" value="3,850" />
            <MiniField label="Condition" value="Good" />
          </div>
          <MiniField label="Serial / VIN" value="CAT0320XK3F01234" />
          <p className="pt-2 text-[10px] text-slate-400">Estimated Trade Value</p>
          <p className="text-2xl font-bold text-emerald-300">$38,000</p>
        </div>
      </div>
      <div className="rounded border border-[#263a55] bg-[#0e1827] p-3">
        <p className="text-xs font-semibold text-white">Trade Summary</p>
        <div className="mt-2 flex items-center justify-between rounded border border-[#263a55] bg-[#111c2d] p-2">
          <span className="text-xs text-slate-300">2019 CAT 320 Excavator · 3,850 hrs · Good</span>
          <span className="text-sm font-bold text-emerald-300">$38,000</span>
        </div>
      </div>
      <div className="flex justify-between pt-12">
        <button className="rounded border border-[#263a55] px-4 py-2 text-xs text-slate-300">Back</button>
        <button className="rounded bg-[#f28a07] px-5 py-2 text-xs font-bold text-[#160d03]">Next: Financing</button>
      </div>
    </div>
  );
}

function FinancingBody() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded border border-[#263a55] bg-[#101a29] p-3">
        <span className="text-xs text-slate-300">Quoting Branch</span>
        <span className="rounded border border-[#314965] px-10 py-1.5 text-xs text-slate-300">Dallas, TX</span>
        <span className="text-[10px] text-emerald-300">Tax and readiness up to date</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
          <p className="text-xs font-semibold text-white">Pricing Summary</p>
          <MoneyLine label="Package Subtotal" value="$53,000" />
          <MoneyLine label="Trade-In Credit" value="-$38,000" good />
          <MoneyLine label="Net Before Discount" value="$15,000" />
          <MoneyLine label="Commercial Discount" value="-$1,500" good />
          <MoneyLine label="Tax Profile" value="$1,113" />
          <MoneyLine label="Total" value="$14,613" strong />
        </div>
        <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
          <p className="text-xs font-semibold text-white">Cash Down</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded border border-[#314965] px-3 py-1.5 text-xs">Percent</span>
            <span className="rounded border border-[#314965] px-6 py-1.5 text-xs">10%</span>
          </div>
          <p className="mt-5 text-[10px] text-slate-400">Amount Financed</p>
          <p className="text-2xl font-bold text-white">$13,152</p>
        </div>
      </div>
      <div className="rounded border border-[#174b82] bg-[#081a30] p-3">
        <div className="flex justify-between">
          <span className="text-xs text-slate-300">Financing Preview</span>
          <span className="text-lg font-bold text-emerald-300">$263/mo.</span>
        </div>
      </div>
      <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
        <p className="text-xs font-semibold text-white">What Gets Financed</p>
        {["Finance equipment and attachments", "Include taxes", "Include extended warranty", "Include maintenance plan"].map((item, index) => (
          <p key={item} className="mt-2 flex items-center gap-2 text-xs text-slate-300">
            <span className={cn("flex h-3 w-3 items-center justify-center border", index < 2 ? "border-[#f28a07] bg-[#f28a07]" : "border-[#435a74]")}>
              {index < 2 ? <Check className="h-2.5 w-2.5 text-[#160d03]" aria-hidden="true" /> : null}
            </span>
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function ReviewBody() {
  return (
    <div className="space-y-3">
      <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#24344d] text-xs">RR</span>
            <div>
              <p className="text-sm font-semibold text-white">Red River Demolition</p>
              <p className="text-[10px] text-slate-400">Amanda Chen · 905-555-0505</p>
            </div>
          </div>
          <span className="text-[10px] text-slate-400">Quote # Q-2025-0516-001</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SummaryBox title="Equipment" lines={["Bobcat T76 (2026)", "$47,000", "Attachments $6,000"]} />
        <SummaryBox title="Trade-In" lines={["2019 CAT 320 Excavator", "-$38,000"]} />
        <SummaryBox title="Financing" lines={["Net Before Discount $15,000", "Total $14,613", "Est. Payment $263/mo"]} />
      </div>
      <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
        <p className="text-xs font-semibold text-white">Readiness Checklist</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {["Customer and deal context confirmed", "AI recommended machine selected", "Trade-in value captured", "Pricing and tax profile set", "Financing and cash down set", "Quote details complete"].map((item) => (
            <p key={item} className="flex items-center gap-2 text-[10px] text-slate-300">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              {item}
            </p>
          ))}
        </div>
      </div>
      <div className="flex justify-between pt-4">
        <div className="flex gap-2">
          <button className="rounded border border-[#263a55] px-4 py-2 text-xs text-slate-300">Save Draft</button>
          <button className="rounded border border-[#263a55] px-4 py-2 text-xs text-slate-300">Open Proposal</button>
        </div>
        <button className="rounded bg-[#f28a07] px-5 py-2 text-xs font-bold text-[#160d03]">Send Quote</button>
      </div>
    </div>
  );
}

function RecommendationRail({ stage }: { stage: FlowStage }) {
  const payment = stage === "financing" || stage === "review" ? "$263/mo" : "$47,000";
  return (
    <aside className="flex min-w-0 flex-col gap-2">
      <RailBox title="AI Recommendation" hot>
        <p className="text-xs font-semibold text-white">Bobcat T76 (2026) — Compact Track Loader</p>
        <p className="mt-1 text-[10px] leading-4 text-slate-400">
          Attachments: Mowing Attachment, Grading Blade. Excellent choice for land clearing with strong versatility and performance.
        </p>
        <button className="mt-2 w-full rounded bg-[#f28a07] py-1.5 text-[10px] font-bold text-[#160d03]">
          Select Recommended
        </button>
      </RailBox>
      <RailBox title="Alternative">
        <p className="text-xs font-semibold text-white">Bobcat T66 (2026) — Compact Track Loader</p>
        <p className="mt-1 text-[10px] text-slate-400">Slightly lower price point with similar capabilities.</p>
        <button className="mt-2 w-full rounded border border-[#344b66] py-1.5 text-[10px] text-slate-300">
          Select Alternative
        </button>
      </RailBox>
      <RailBox title="Job Considerations">
        <ul className="space-y-1 text-[10px] text-slate-400">
          <li>Operator training provided for optimal use.</li>
          <li>Check seasonal conditions in the job site area.</li>
          <li>Verify permits if required for land clearing.</li>
        </ul>
      </RailBox>
      <RailBox title="Financing Preview">
        <p className="text-[10px] text-slate-400">Cash</p>
        <p className="text-xs font-semibold text-white">{payment}</p>
      </RailBox>
    </aside>
  );
}

function InfoBox({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded border border-[#263a55] bg-[#101a29] p-2">
      <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-300">{body}</p>
    </div>
  );
}

function StartMode({
  icon: Icon,
  title,
  body,
  action,
  active = false,
}: {
  icon: typeof Mic;
  title: string;
  body: string;
  action: string;
  active?: boolean;
}) {
  return (
    <div className={cn("rounded border p-3", active ? "border-[#f28a07] bg-[#1a1410]" : "border-[#263a55] bg-[#101a29]")}>
      <Icon className="h-6 w-6 text-[#f28a07]" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 min-h-12 text-[10px] leading-4 text-slate-400">{body}</p>
      <button className={cn("mt-3 w-full rounded border py-1.5 text-[10px]", active ? "border-[#f28a07] text-[#f28a07]" : "border-[#334b66] text-slate-300")}>
        {action}
      </button>
    </div>
  );
}

function SelectedEquipment() {
  return (
    <div className="rounded border border-[#263a55] bg-[#101a29] p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Selected Equipment</p>
        <span className="text-xs font-semibold text-white">$47,000</span>
      </div>
      {["Mowing Attachment", "Grading Blade"].map((line, index) => (
        <div key={line} className="mt-2 flex justify-between border-b border-[#1e3047] pb-1 text-[10px] text-slate-400 last:border-0">
          <span>{line}</span>
          <span>{index === 0 ? "$4,200" : "$1,800"}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between text-xs font-semibold text-white">
        <span>Package Subtotal</span>
        <span>$53,000</span>
      </div>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-400">{label}</span>
      <span className="mt-1 block rounded border border-[#263a55] bg-[#07111d] px-3 py-2 text-xs text-slate-200">
        {value}
      </span>
    </label>
  );
}

function MoneyLine({
  label,
  value,
  good = false,
  strong = false,
}: {
  label: string;
  value: string;
  good?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="mt-2 flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={cn(strong ? "text-base font-bold text-white" : good ? "text-emerald-300" : "text-slate-200")}>
        {value}
      </span>
    </div>
  );
}

function SummaryBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="min-h-32 rounded border border-[#263a55] bg-[#101a29] p-3">
      <p className="text-xs font-semibold text-white">{title}</p>
      <div className="mt-3 space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-[10px] text-slate-400">{line}</p>
        ))}
      </div>
    </div>
  );
}

function RailBox({
  title,
  hot = false,
  children,
}: {
  title: string;
  hot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded border bg-[#0a1421] p-2", hot ? "border-[#8a520f]" : "border-[#263a55]")}>
      <p className={cn("text-[9px] font-bold uppercase", hot ? "text-[#f28a07]" : "text-slate-500")}>
        <Sparkles className="mr-1 inline h-3 w-3" aria-hidden="true" />
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
