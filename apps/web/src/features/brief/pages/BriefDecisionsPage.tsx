/**
 * /brief/decisions — Decision log with NotebookLM provenance.
 *
 * Every hub_decisions row is the receipt for a build choice. Stakeholders
 * can click a decision to open the right-side drawer with the NotebookLM
 * source preview (iframe when NOTEBOOKLM_NOTEBOOK_ID is configured at build
 * time, link-only fallback otherwise).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listHubDecisions, type HubDecisionRow } from "../lib/brief-api";

const NOTEBOOKLM_BASE_URL = "https://notebooklm.google.com/notebook";
// Locked in the plan: the QEP project brain lives here.
const NOTEBOOKLM_NOTEBOOK_ID = "dba6dc3e-c9bb-4be1-a9cb-421e9c141a92";

export function BriefDecisionsPage() {
  const [selected, setSelected] = useState<HubDecisionRow | null>(null);

  const decisionsQuery = useQuery({
    queryKey: ["hub-decisions"],
    queryFn: () => listHubDecisions(100),
    staleTime: 60_000,
  });

  const rows = useMemo(() => decisionsQuery.data ?? [], [decisionsQuery.data]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <div className="flex items-start gap-3">
        <ScrollText className="mt-1 h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Decisions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every meaningful build choice, with a link to the source of truth in
            NotebookLM.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]">
        <section>
          {decisionsQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading decisions…
            </div>
          ) : decisionsQuery.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
              Couldn't load decisions:{" "}
              {String((decisionsQuery.error as Error).message)}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
              <p className="text-sm font-medium text-foreground">No decisions recorded yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                As we make build choices, they'll land here with a NotebookLM receipt.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <DecisionCard
                  key={row.id}
                  row={row}
                  selected={selected?.id === row.id}
                  onSelect={() => setSelected(row)}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="sticky top-4 self-start">
          <DecisionDrawer decision={selected} />
        </aside>
      </div>
    </div>
  );
}

function DecisionCard({
  row,
  selected,
  onSelect,
}: {
  row: HubDecisionRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`cursor-pointer rounded-lg border p-4 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/40"
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {row.affects_modules.slice(0, 4).map((m) => (
          <Badge key={m} variant="outline" className="capitalize">
            {m}
          </Badge>
        ))}
        {row.notebooklm_source_id && (
          <Badge className="bg-violet-500/15 text-violet-700 dark:text-violet-300">with source</Badge>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{row.title}</h3>
      {row.decided_by.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Decided by {row.decided_by.join(", ")}
        </p>
      )}
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.decision}</p>
    </li>
  );
}

function DecisionDrawer({ decision }: { decision: HubDecisionRow | null }) {
  if (!decision) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
        <p className="text-sm font-medium text-foreground">Select a decision</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Click a row on the left to open the context + NotebookLM source.
        </p>
      </div>
    );
  }

  const notebookHref = `${NOTEBOOKLM_BASE_URL}/${NOTEBOOKLM_NOTEBOOK_ID}`;

  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{decision.title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Recorded {new Date(decision.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="space-y-4 px-4 py-4 text-sm">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Context
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{decision.context}</p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Decision
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{decision.decision}</p>
        </section>
        {decision.decided_by.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Decided by
            </h3>
            <p className="mt-1 text-foreground">{decision.decided_by.join(", ")}</p>
          </section>
        )}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source
          </h3>
          <div className="mt-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={notebookHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center"
              >
                Open in NotebookLM
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Full transcript + audio overview live in the QEP project notebook.
              Listen, replay, and search the receipts.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
