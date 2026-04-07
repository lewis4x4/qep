import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitMerge, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CompanyMergeDialog } from "../components/CompanyMergeDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { QrmPageHeader } from "../components/QrmPageHeader";
import {
  dismissDuplicateCandidate,
  listDuplicateCandidates,
  mergeDuplicateContacts,
} from "../lib/qrm-router-api";
import type { QrmDuplicateCandidate } from "../lib/types";

interface QrmDuplicatesPageProps {
  userRole: "rep" | "admin" | "manager" | "owner";
}

function ContactColumn({
  heading,
  contact,
  tone,
}: {
  heading: string;
  contact: QrmDuplicateCandidate["leftContact"];
  tone: "keep" | "discard";
}) {
  const classes = tone === "keep"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-red-200 bg-red-50 text-red-900";

  return (
    <div className={`rounded-lg border p-3 ${classes}`} aria-label={heading}>
      <h3 className="text-xs font-semibold uppercase tracking-wide">{heading}</h3>
      {contact ? (
        <dl className="mt-2 space-y-1 text-sm">
          <div>
            <dt className="sr-only">Name</dt>
            <dd className="font-semibold">{contact.firstName} {contact.lastName}</dd>
          </div>
          <div>
            <dt className="sr-only">Email</dt>
            <dd>{contact.email || "No email"}</dd>
          </div>
          <div>
            <dt className="sr-only">Phone</dt>
            <dd>{contact.phone || "No phone"}</dd>
          </div>
          <div>
            <dt className="sr-only">Title</dt>
            <dd>{contact.title || "No title"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm">Contact details unavailable.</p>
      )}
    </div>
  );
}

export function QrmDuplicatesPage({ userRole }: QrmDuplicatesPageProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mergeTarget, setMergeTarget] = useState<QrmDuplicateCandidate | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const canResolve = userRole === "admin" || userRole === "manager" || userRole === "owner";

  const duplicatesQuery = useQuery({
    queryKey: ["crm", "duplicates", "open"],
    queryFn: () => listDuplicateCandidates(),
    staleTime: 10_000,
  });

  const dismissMutation = useMutation({
    mutationFn: (candidateId: string) => dismissDuplicateCandidate(candidateId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "duplicates"] });
      toast({ title: "Duplicate dismissed", description: "The candidate was removed from the merge queue." });
    },
    onError: (error) => {
      toast({
        title: "Unable to dismiss duplicate",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (candidate: QrmDuplicateCandidate) => {
      if (!candidate.leftContact || !candidate.rightContact) {
        throw new Error("Merge requires both contacts.");
      }
      return mergeDuplicateContacts({
        survivorId: candidate.leftContact.id,
        loserId: candidate.rightContact.id,
      });
    },
    onSuccess: async () => {
      setMergeTarget(null);
      setConfirmText("");
      await queryClient.invalidateQueries({ queryKey: ["crm", "duplicates"] });
      await queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] });
      toast({ title: "Contacts merged", description: "Duplicate records were merged and audited." });
    },
    onError: (error) => {
      toast({
        title: "Merge failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const candidates = useMemo(() => duplicatesQuery.data ?? [], [duplicatesQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Duplicate Review"
        subtitle="Review suggested contact + company duplicates and run governed merges with audit history."
      />

      {/* Duplicate companies (fuzzy match via find_duplicate_companies RPC — Phase H) */}
      <DuplicateCompaniesSection />

      {!canResolve && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You can review duplicate candidates, but merge and dismiss actions require manager, admin, or owner access.
        </Card>
      )}

      {duplicatesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading duplicate candidates">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {duplicatesQuery.isError && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Couldn&apos;t load duplicate candidates. Refresh and try again.
        </Card>
      )}

      {!duplicatesQuery.isLoading && !duplicatesQuery.isError && candidates.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No open duplicate candidates.
        </Card>
      )}

      {!duplicatesQuery.isLoading && !duplicatesQuery.isError && candidates.length > 0 && (
        <div className="space-y-4">
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-primary" />
                  Rule: <span className="font-semibold text-foreground">{candidate.ruleId}</span>
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs">Score {candidate.score.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canResolve || dismissMutation.isPending}
                    onClick={() => dismissMutation.mutate(candidate.id)}
                  >
                    <XCircle className="mr-1 h-4 w-4" />
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    disabled={!canResolve}
                    onClick={() => setMergeTarget(candidate)}
                  >
                    <GitMerge className="mr-1 h-4 w-4" />
                    Merge
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2" role="group" aria-label="Duplicate comparison">
                <ContactColumn heading="Keeping" contact={candidate.leftContact} tone="keep" />
                <ContactColumn heading="Discarding" contact={candidate.rightContact} tone="discard" />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={mergeTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setMergeTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm contact merge</DialogTitle>
            <DialogDescription>
              This action updates linked deals, activities, tags, territories, company links, and equipment references.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Type <span className="font-semibold text-foreground">MERGE</span> to continue.</p>
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="MERGE"
              aria-label="Type MERGE to confirm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={confirmText !== "MERGE" || mergeMutation.isPending || !mergeTarget}
              onClick={() => {
                if (mergeTarget) {
                  mergeMutation.mutate(mergeTarget);
                }
              }}
            >
              {mergeMutation.isPending ? "Merging..." : "Confirm Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Duplicate Companies section (Phase H) ─────────────────────────── */

interface CompanyDupRow {
  group_key: string;
  company_a_id: string;
  company_a_name: string;
  company_b_id: string;
  company_b_name: string;
  similarity_score: number;
}

function DuplicateCompaniesSection() {
  const [mergePair, setMergePair] = useState<CompanyDupRow | null>(null);
  const { data: dupes = [], isLoading, isError } = useQuery({
    queryKey: ["duplicate-companies"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: CompanyDupRow[] | null; error: unknown }>;
      }).rpc("find_duplicate_companies", { p_threshold: 0.6 });
      if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to scan"));
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitMerge className="h-4 w-4 text-qep-orange" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">Suspected duplicate companies</h3>
        <span className="text-[10px] text-muted-foreground">fuzzy match · pg_trgm similarity ≥ 0.60</span>
      </div>

      {isLoading && <div className="h-20 animate-pulse rounded bg-muted/20" />}

      {isError && (
        <p className="text-xs text-red-400">
          Couldn't run the duplicate scan. Confirm pg_trgm is enabled and find_duplicate_companies RPC is deployed.
        </p>
      )}

      {!isLoading && !isError && dupes.length === 0 && (
        <p className="text-xs text-muted-foreground">No suspected company duplicates.</p>
      )}

      {!isLoading && !isError && dupes.length > 0 && (
        <div className="space-y-1.5">
          {dupes.slice(0, 25).map((d, i) => (
            <div key={`${d.company_a_id}-${d.company_b_id}-${i}`} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 text-xs border-b border-border/50 pb-1.5 last:border-b-0 last:pb-0">
              <a
                href={`/qrm/companies/${d.company_a_id}`}
                className="truncate text-foreground hover:text-qep-orange"
              >
                {d.company_a_name}
              </a>
              <span className="text-center tabular-nums text-muted-foreground">
                {(d.similarity_score * 100).toFixed(0)}%
              </span>
              <a
                href={`/qrm/companies/${d.company_b_id}`}
                className="truncate text-foreground hover:text-qep-orange"
              >
                {d.company_b_name}
              </a>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => setMergePair(d)}
              >
                <GitMerge className="mr-1 h-3 w-3" /> Merge
              </Button>
            </div>
          ))}
          {dupes.length > 25 && (
            <p className="text-[10px] text-muted-foreground">+{dupes.length - 25} more pairs — scan capped at 200.</p>
          )}
        </div>
      )}

      <CompanyMergeDialog pair={mergePair} onClose={() => setMergePair(null)} />
    </Card>
  );
}

