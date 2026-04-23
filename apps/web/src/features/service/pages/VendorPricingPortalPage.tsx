import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

type PortalPriceRow = {
  id: string;
  partNumber: string;
  description: string | null;
  currentPrice: number | null;
  currency: string;
  effectiveDate: string;
};

type PortalSubmissionRow = {
  id: string;
  partNumber: string;
  description: string | null;
  proposedPrice: number;
  currency: string;
  effectiveDate: string;
  notes: string | null;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

type PortalPayload = {
  vendor: {
    id: string;
    name: string;
    supplierType: string;
    notes: string | null;
    label: string | null;
    contactName: string | null;
    contactEmail: string | null;
  };
  prices: PortalPriceRow[];
  submissions: PortalSubmissionRow[];
};

async function portalRequest<T>(accessKey: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vendor-pricing-portal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ accessKey, ...body }),
  });

  const payload = await response.json() as T & { error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Vendor portal request failed.");
  }
  return payload;
}

export function VendorPricingPortalPage() {
  const { accessKey } = useParams<{ accessKey: string }>();
  const [search, setSearch] = useState("");
  const [submittedByName, setSubmittedByName] = useState("");
  const [submittedByEmail, setSubmittedByEmail] = useState("");
  const [drafts, setDrafts] = useState<Array<{ partNumber: string; description: string; proposedPrice: string; effectiveDate: string; submissionNotes: string }>>([
    { partNumber: "", description: "", proposedPrice: "", effectiveDate: "", submissionNotes: "" },
  ]);

  const portalQuery = useQuery({
    queryKey: ["vendor-pricing-portal", accessKey, search],
    queryFn: () => portalRequest<PortalPayload>(accessKey!, { action: "session", search }),
    enabled: Boolean(accessKey),
    staleTime: 10_000,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const items = drafts
        .filter((draft) => draft.partNumber.trim() && draft.proposedPrice.trim())
        .map((draft) => ({
          partNumber: draft.partNumber.trim(),
          description: draft.description.trim() || null,
          proposedListPrice: Number.parseFloat(draft.proposedPrice),
          effectiveDate: draft.effectiveDate || null,
          submissionNotes: draft.submissionNotes.trim() || null,
        }));

      return portalRequest<PortalPayload>(accessKey!, {
        action: "submit",
        search,
        submittedByName,
        submittedByEmail,
        items,
      });
    },
    onSuccess: (payload) => {
      portalQuery.refetch();
      setSubmittedByName(payload.vendor.contactName ?? "");
      setSubmittedByEmail(payload.vendor.contactEmail ?? "");
      setDrafts([{ partNumber: "", description: "", proposedPrice: "", effectiveDate: "", submissionNotes: "" }]);
    },
  });

  const vendor = portalQuery.data?.vendor;
  const prices = portalQuery.data?.prices ?? [];
  const submissions = portalQuery.data?.submissions ?? [];
  const pendingCount = useMemo(
    () => submissions.filter((submission) => submission.status === "pending").length,
    [submissions],
  );

  if (!accessKey) {
    return <div className="min-h-screen flex items-center justify-center">Invalid vendor link.</div>;
  }

  if (portalQuery.isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading vendor pricing portal…</div>;
  }

  if (portalQuery.isError || !vendor) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">This vendor pricing link is unavailable.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {portalQuery.error instanceof Error ? portalQuery.error.message : "Ask QEP for a fresh vendor pricing link."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Vendor pricing portal
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">{vendor.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review your current QEP price file, submit updates, and track approval status without emailing spreadsheets back and forth.
          </p>
          {vendor.notes ? <p className="mt-3 text-sm text-muted-foreground">{vendor.notes}</p> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Current prices" value={String(prices.length)} />
            <MetricCard label="Pending reviews" value={String(pendingCount)} />
            <MetricCard label="Recent submissions" value={String(submissions.length)} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Current price file</h2>
                <p className="text-sm text-muted-foreground">
                  Search by part number or description to verify what QEP currently has on file.
                </p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search part number or description"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="mt-4 space-y-2">
              {prices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No price rows matched the current search.</p>
              ) : (
                prices.map((row) => (
                  <div key={row.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{row.partNumber}</p>
                        <p className="text-xs text-muted-foreground">{row.description || "No description on file."}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {row.currentPrice == null ? "—" : `${row.currentPrice.toFixed(4)} ${row.currency}`}
                        </p>
                        <p className="text-xs text-muted-foreground">Effective {row.effectiveDate}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground">Submit price updates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the part numbers you want changed. QEP reviews each submission before it updates the active vendor price file.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                value={submittedByName}
                onChange={(event) => setSubmittedByName(event.target.value)}
                placeholder="Your name"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                value={submittedByEmail}
                onChange={(event) => setSubmittedByEmail(event.target.value)}
                placeholder="Your email"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <div className="mt-4 space-y-3">
              {drafts.map((draft, index) => (
                <div key={index} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={draft.partNumber}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, partNumber: event.target.value } : item),
                        )
                      }
                      placeholder="Part number"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <input
                      value={draft.proposedPrice}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, proposedPrice: event.target.value } : item),
                        )
                      }
                      placeholder="Proposed price"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <input
                      value={draft.description}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item),
                        )
                      }
                      placeholder="Description"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:col-span-2"
                    />
                    <input
                      type="date"
                      value={draft.effectiveDate}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, effectiveDate: event.target.value } : item),
                        )
                      }
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <input
                      value={draft.submissionNotes}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, submissionNotes: event.target.value } : item),
                        )
                      }
                      placeholder="Notes"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDrafts((current) => [
                    ...current,
                    { partNumber: "", description: "", proposedPrice: "", effectiveDate: "", submissionNotes: "" },
                  ])
                }
              >
                Add row
              </Button>
              <Button type="button" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit for approval"}
              </Button>
            </div>

            {submitMutation.isError ? (
              <p className="mt-3 text-sm text-red-300">
                {submitMutation.error instanceof Error ? submitMutation.error.message : "Submission failed."}
              </p>
            ) : null}
          </section>
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Submission history</h2>
          <div className="mt-4 space-y-2">
            {submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            ) : (
              submissions.map((submission) => (
                <div key={submission.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{submission.partNumber}</p>
                      <p className="text-xs text-muted-foreground">{submission.description || "No description submitted."}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">
                        {submission.proposedPrice.toFixed(4)} {submission.currency}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{submission.status}</p>
                    </div>
                  </div>
                  {submission.reviewNotes ? (
                    <p className="mt-2 text-xs text-muted-foreground">Review notes: {submission.reviewNotes}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default VendorPricingPortalPage;
