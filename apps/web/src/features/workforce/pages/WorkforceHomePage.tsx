import { Link } from "react-router-dom";
import { Award, ClipboardCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WorkforceSubNav } from "../components/WorkforceSubNav";

const cards = [
  {
    title: "Performance appraisals",
    href: "/workforce/appraisals",
    icon: ClipboardCheck,
    body: "Conduct Service Advisor and Technician reviews with seven equal-weight categories, live banding, raise math, signatures, and acknowledgements.",
  },
  {
    title: "Technician pay ladder",
    href: "/workforce/pay-ladder",
    icon: Award,
    body: "Track Road, Shop, and Grapple progression against efficiency, comeback, tenure, tooling, OEM certification, and in-house readiness gates.",
  },
] as const;

export function WorkforceHomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Workforce command center</h1>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            HR-sensitive operator surfaces for performance appraisals and technician progression. Visibility is database-enforced; empty states mean no assignment or no access.
          </p>
        </div>
        <WorkforceSubNav />
      </div>

      <div className="rounded-3xl border border-qep-orange/20 bg-gradient-to-br from-qep-orange/10 via-background to-background p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-qep-orange/15 p-3 text-qep-orange">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-foreground">People intelligence for equipment operations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              QEP managers can pressure-test readiness before pay movement; technicians and advisors can see the records assigned to them without exposing anyone else’s HR data.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} to={card.href} className="group block">
              <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-foreground group-hover:text-primary">{card.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-primary">Open surface →</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
