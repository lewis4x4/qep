import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  listCrmActivityFeed,
  listCrmCompanies,
  listCrmContacts,
  listCrmOpenDealsForBoard,
} from "../lib/qrm-api";
import type { QrmActivityFeedItem, QrmRepSafeDeal } from "../lib/types";
import {
  assignVoiceCaptureInboxActivity,
  isVoiceCaptureInboxActivity,
  markVoiceCaptureInboxReviewed,
  readVoiceCaptureMatchConfidence,
  type VoiceCaptureInboxTarget,
} from "../lib/voice-capture-inbox";
import {
  readVoiceCaptureTimelineSignals,
  readVoiceCaptureTranscript,
} from "../lib/voice-capture-activity-metadata";

function preview(text: string | null, length = 180): string {
  if (!text) return "No transcript available.";
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

function targetLabel(activity: QrmActivityFeedItem): string {
  if (activity.dealName) return `Deal: ${activity.dealName}`;
  if (activity.companyName) return `Company: ${activity.companyName}`;
  if (activity.contactName) return `Contact: ${activity.contactName}`;
  return "Voice Capture Inbox";
}

export function VoiceCaptureInboxPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [dealSearch, setDealSearch] = useState("");

  const feedQuery = useQuery({
    queryKey: ["qrm", "activities", "feed", "voice-inbox"],
    queryFn: listCrmActivityFeed,
    staleTime: 30_000,
  });

  const companiesQuery = useQuery({
    queryKey: ["qrm", "voice-inbox", "companies", companySearch],
    queryFn: () => listCrmCompanies(companySearch),
    staleTime: 20_000,
  });

  const contactsQuery = useQuery({
    queryKey: ["qrm", "voice-inbox", "contacts", contactSearch],
    queryFn: () => listCrmContacts(contactSearch),
    staleTime: 20_000,
  });

  const dealsQuery = useQuery({
    queryKey: ["qrm", "voice-inbox", "deals"],
    queryFn: () => listCrmOpenDealsForBoard(),
    staleTime: 20_000,
  });

  const inboxItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = (feedQuery.data ?? []).filter(isVoiceCaptureInboxActivity);
    if (!q) return source;
    return source.filter((item) => {
      const transcript = readVoiceCaptureTranscript(item) ?? "";
      const signals = readVoiceCaptureTimelineSignals(item);
      const haystack = [
        transcript,
        item.actorName ?? "",
        item.contactName ?? "",
        item.companyName ?? "",
        item.dealName ?? "",
        signals?.summary.nextStep ?? "",
        signals?.summary.machineInterest ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [feedQuery.data, search]);

  const activeActivity = useMemo(
    () => inboxItems.find((item) => item.id === activeActivityId) ?? null,
    [inboxItems, activeActivityId],
  );

  const filteredDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    const all = dealsQuery.data?.items ?? [];
    if (!q) return all.slice(0, 8);
    return all.filter((deal: QrmRepSafeDeal) =>
      deal.name.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [dealSearch, dealsQuery.data]);

  const mutateAssign = useMutation({
    mutationFn: async (
      { activity, target }: {
        activity: QrmActivityFeedItem;
        target: VoiceCaptureInboxTarget;
      },
    ) => {
      if (!profile?.id) throw new Error("Missing reviewer profile.");
      await assignVoiceCaptureInboxActivity(activity, target, profile.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["qrm", "activities", "feed", "voice-inbox"],
      });
      setActiveActivityId(null);
      toast({
        title: "Voice capture assigned",
        description: "The inbox activity was retargeted.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Assignment failed",
        description: error instanceof Error
          ? error.message
          : "Could not assign this capture.",
        variant: "destructive",
      });
    },
  });

  const mutateReview = useMutation({
    mutationFn: async (activity: QrmActivityFeedItem) => {
      if (!profile?.id) throw new Error("Missing reviewer profile.");
      await markVoiceCaptureInboxReviewed(activity, profile.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["qrm", "activities", "feed", "voice-inbox"],
      });
      setActiveActivityId(null);
      toast({
        title: "Marked reviewed",
        description: "Capture removed from active inbox.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Review update failed",
        description: error instanceof Error
          ? error.message
          : "Could not mark as reviewed.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Voice Capture Inbox"
        subtitle="Review unmatched or low-confidence voice captures and assign them to company, contact, or deal timelines."
        crumb={{ surface: "TODAY", lens: "VOICE", count: inboxItems.length }}
      />
      <QrmSubNav />

      <Card className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search voice capture inbox"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search transcript, rep, customer, or next step"
            className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.35fr,1fr]">
        <div className="space-y-3">
          {inboxItems.map((activity) => {
            const transcript = readVoiceCaptureTranscript(activity);
            const signals = readVoiceCaptureTimelineSignals(activity);
            const confidence = readVoiceCaptureMatchConfidence(activity);
            const selected = activeActivityId === activity.id;

            return (
              <Card
                key={activity.id}
                className={`p-4 ${selected ? "border-primary" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {targetLabel(activity)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Logged by {activity.actorName ?? "Unknown rep"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    onClick={() =>
                      setActiveActivityId(selected ? null : activity.id)}
                  >
                    {selected ? "Selected" : "Review"}
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-primary">
                    <Mic className="h-3 w-3" /> Voice capture
                  </span>
                  {confidence != null && (
                    <span className="rounded-full border px-2 py-1">
                      Match {Math.round(confidence * 100)}%
                    </span>
                  )}
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
                    Needs assignment
                  </span>
                </div>

                <p className="mt-3 text-sm text-foreground">
                  {preview(transcript)}
                </p>

                {(signals?.summary.machineInterest ||
                  signals?.summary.nextStep) && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {signals.summary.machineInterest && (
                      <p>Equipment: {signals.summary.machineInterest}</p>
                    )}
                    {signals.summary.nextStep && (
                      <p>Next step: {signals.summary.nextStep}</p>
                    )}
                  </div>
                )}

                <div className="mt-3 text-xs">
                  <Link
                    className="text-primary underline underline-offset-4"
                    to="/qrm/activities"
                  >
                    Open in activities feed
                  </Link>
                </div>
              </Card>
            );
          })}

          {!feedQuery.isLoading && inboxItems.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No active voice capture inbox items.
            </Card>
          )}
        </div>

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Assignment panel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select a capture on the left, then assign or mark reviewed.
          </p>

          {!activeActivity && (
            <p className="mt-4 text-sm text-muted-foreground">
              Select an inbox capture to start.
            </p>
          )}

          {activeActivity && (
            <div className="mt-4 space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Transcript</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {preview(readVoiceCaptureTranscript(activeActivity), 500)}
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="voice-inbox-company-search"
                  className="text-xs font-semibold uppercase tracking-wide"
                >
                  Assign to company
                </label>
                <input
                  id="voice-inbox-company-search"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Search companies"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <div className="space-y-1">
                  {(companiesQuery.data?.items ?? []).slice(0, 6).map((
                    company,
                  ) => (
                    <Button
                      key={company.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() =>
                        mutateAssign.mutate({
                          activity: activeActivity,
                          target: { type: "company", id: company.id },
                        })}
                    >
                      {company.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="voice-inbox-contact-search"
                  className="text-xs font-semibold uppercase tracking-wide"
                >
                  Assign to contact
                </label>
                <input
                  id="voice-inbox-contact-search"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <div className="space-y-1">
                  {(contactsQuery.data?.items ?? []).slice(0, 6).map((
                    contact,
                  ) => (
                    <Button
                      key={contact.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() =>
                        mutateAssign.mutate({
                          activity: activeActivity,
                          target: { type: "contact", id: contact.id },
                        })}
                    >
                      {`${contact.firstName} ${contact.lastName}`.trim()}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="voice-inbox-deal-search"
                  className="text-xs font-semibold uppercase tracking-wide"
                >
                  Assign to deal
                </label>
                <input
                  id="voice-inbox-deal-search"
                  value={dealSearch}
                  onChange={(e) => setDealSearch(e.target.value)}
                  placeholder="Search open deals"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <div className="space-y-1">
                  {filteredDeals.map((deal) => (
                    <Button
                      key={deal.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() =>
                        mutateAssign.mutate({
                          activity: activeActivity,
                          target: { type: "deal", id: deal.id },
                        })}
                    >
                      {deal.name}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => mutateReview.mutate(activeActivity)}
              >
                <UserCheck className="mr-2 h-4 w-4" /> Mark reviewed / no match
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
