import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitMerge, XCircle } from "lucide-react";
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
import { CrmPageHeader } from "../components/CrmPageHeader";
import {
  dismissDuplicateCandidate,
  listDuplicateCandidates,
  mergeDuplicateContacts,
} from "../lib/crm-router-api";
import type { CrmDuplicateCandidate } from "../lib/types";

interface CrmDuplicatesPageProps {
  userRole: "rep" | "admin" | "manager" | "owner";
}

function ContactColumn({
  heading,
  contact,
  tone,
}: {
  heading: string;
  contact: CrmDuplicateCandidate["leftContact"];
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

export function CrmDuplicatesPage({ userRole }: CrmDuplicatesPageProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mergeTarget, setMergeTarget] = useState<CrmDuplicateCandidate | null>(null);
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
    mutationFn: (candidate: CrmDuplicateCandidate) => {
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
      <CrmPageHeader
        title="Duplicate Review"
        subtitle="Review suggested contact duplicates and run governed merges with audit history."
      />

      {!canResolve && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You can review duplicate candidates, but merge and dismiss actions require manager, admin, or owner access.
        </Card>
      )}

      {duplicatesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading duplicate candidates">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
          ))}
        </div>
      )}

      {duplicatesQuery.isError && (
        <Card className="p-6 text-center text-sm text-[#334155]">
          Couldn&apos;t load duplicate candidates. Refresh and try again.
        </Card>
      )}

      {!duplicatesQuery.isLoading && !duplicatesQuery.isError && candidates.length === 0 && (
        <Card className="p-6 text-center text-sm text-[#334155]">
          No open duplicate candidates.
        </Card>
      )}

      {!duplicatesQuery.isLoading && !duplicatesQuery.isError && candidates.length > 0 && (
        <div className="space-y-4">
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-[#334155]">
                  <AlertTriangle className="h-4 w-4 text-[#B45309]" />
                  Rule: <span className="font-semibold text-[#0F172A]">{candidate.ruleId}</span>
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
