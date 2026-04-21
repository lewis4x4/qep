import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface } from "../components/command-deck";
import {
  createCrmCampaignViaRouter,
  executeCrmCampaignViaRouter,
  listCrmCampaignRecipientsViaRouter,
  listCrmCampaignsViaRouter,
  patchCrmCampaignViaRouter,
} from "../lib/qrm-router-api";
import { listCrmContacts, listCrmContactsByIds, listManageableCrmActivityTemplates } from "../lib/qrm-api";
import { readCampaignAudienceCount, readCampaignExecutionCount } from "../lib/campaign-utils";
import type { QrmActivityTemplate, QrmCampaign, QrmCampaignChannel, QrmCampaignRecipient, QrmContactSummary } from "../lib/types";

type CampaignEditorState = {
  id: string | null;
  name: string;
  channel: QrmCampaignChannel;
  templateId: string;
  audienceContactIds: string[];
};

const EMPTY_EDITOR: CampaignEditorState = {
  id: null,
  name: "",
  channel: "email",
  templateId: "",
  audienceContactIds: [],
};

function formatRecipientStatus(status: QrmCampaignRecipient["status"]): string {
  if (status === "ineligible") return "Ineligible";
  if (status === "delivered") return "Delivered";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Pending";
  return "Sent";
}

function formatCampaignState(state: QrmCampaign["state"]): string {
  if (state === "draft") return "Draft";
  if (state === "running") return "Running";
  if (state === "completed") return "Completed";
  return "Cancelled";
}

function statusTone(status: QrmCampaignRecipient["status"] | QrmCampaign["state"]): string {
  switch (status) {
    case "completed":
    case "delivered":
      return "text-emerald-400";
    case "running":
    case "sent":
      return "text-qep-orange";
    case "failed":
    case "cancelled":
      return "text-red-400";
    case "ineligible":
      return "text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function toEditorState(campaign: QrmCampaign): CampaignEditorState {
  const contactIds = Array.isArray(campaign.audienceSnapshot.contactIds)
    ? campaign.audienceSnapshot.contactIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    id: campaign.id,
    name: campaign.name,
    channel: campaign.channel,
    templateId: campaign.templateId ?? "",
    audienceContactIds: contactIds,
  };
}

export function QrmCampaignsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<CampaignEditorState>(EMPTY_EDITOR);
  const [contactSearchInput, setContactSearchInput] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setContactSearch(contactSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [contactSearchInput]);

  const campaignsQuery = useQuery({
    queryKey: ["crm", "campaigns"],
    queryFn: listCrmCampaignsViaRouter,
    staleTime: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["crm", "activity-templates", "manage"],
    queryFn: listManageableCrmActivityTemplates,
    staleTime: 60_000,
  });

  const contactSearchQuery = useQuery({
    queryKey: ["crm", "campaigns", "contact-search", contactSearch],
    queryFn: () => listCrmContacts(contactSearch),
    enabled: editorOpen,
    staleTime: 30_000,
  });

  const selectedAudienceQuery = useQuery({
    queryKey: ["crm", "campaigns", "selected-audience", editor.audienceContactIds.join(",")],
    queryFn: () => listCrmContactsByIds(editor.audienceContactIds),
    enabled: editor.audienceContactIds.length > 0,
    staleTime: 30_000,
  });

  const recipientsQuery = useQuery({
    queryKey: ["crm", "campaigns", selectedCampaignId, "recipients"],
    queryFn: () => listCrmCampaignRecipientsViaRouter(selectedCampaignId!),
    enabled: Boolean(selectedCampaignId),
    staleTime: 15_000,
  });

  const campaigns = campaignsQuery.data ?? [];
  const templates = useMemo(
    () =>
      (templatesQuery.data ?? []).filter(
        (template) => template.activityType === "email" || template.activityType === "sms",
      ),
    [templatesQuery.data],
  );
  const matchingTemplates = templates.filter((template) => template.activityType === editor.channel);
  const selectedAudience = selectedAudienceQuery.data ?? [];
  const contactSearchResults = contactSearchQuery.data?.items ?? [];

  const summary = useMemo(() => {
    return {
      total: campaigns.length,
      drafts: campaigns.filter((campaign) => campaign.state === "draft").length,
      running: campaigns.filter((campaign) => campaign.state === "running").length,
      completed: campaigns.filter((campaign) => campaign.state === "completed").length,
    };
  }, [campaigns]);

  async function refreshCampaigns(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "campaigns"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "campaigns", selectedCampaignId, "recipients"] }),
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: editor.name.trim(),
        channel: editor.channel,
        templateId: editor.templateId || null,
        audienceContactIds: editor.audienceContactIds,
      };

      if (editor.id) {
        return patchCrmCampaignViaRouter(editor.id, payload);
      }
      return createCrmCampaignViaRouter(payload);
    },
    onSuccess: async () => {
      await refreshCampaigns();
      setEditorOpen(false);
      setEditor(EMPTY_EDITOR);
      setContactSearchInput("");
      toast({
        title: editor.id ? "Campaign updated" : "Campaign created",
        description: editor.id
          ? "The audience and template are up to date."
          : "Campaign draft is ready for execution.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save campaign",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const executeMutation = useMutation({
    mutationFn: (campaignId: string) => executeCrmCampaignViaRouter(campaignId),
    onSuccess: async (_result, campaignId) => {
      setSelectedCampaignId(campaignId);
      await refreshCampaigns();
      toast({
        title: "Campaign executed",
        description: "Delivery run completed. Check recipient results below.",
      });
    },
    onError: (error) => {
      toast({
        title: "Campaign execution failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (campaignId: string) => patchCrmCampaignViaRouter(campaignId, { archive: true }),
    onSuccess: async () => {
      await refreshCampaigns();
      toast({
        title: "Campaign archived",
        description: "The campaign has been removed from the active list.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not archive campaign",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function openNewCampaign(): void {
    setEditor(EMPTY_EDITOR);
    setContactSearchInput("");
    setEditorOpen(true);
  }

  function openEditCampaign(campaign: QrmCampaign): void {
    setEditor(toEditorState(campaign));
    setSelectedCampaignId(campaign.id);
    setContactSearchInput("");
    setEditorOpen(true);
  }

  function addAudienceContact(contact: QrmContactSummary): void {
    setEditor((current) => {
      if (current.audienceContactIds.includes(contact.id)) return current;
      return {
        ...current,
        audienceContactIds: [...current.audienceContactIds, contact.id],
      };
    });
  }

  function removeAudienceContact(contactId: string): void {
    setEditor((current) => ({
      ...current,
      audienceContactIds: current.audienceContactIds.filter((id) => id !== contactId),
    }));
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Campaigns"
        subtitle="Segment, send, and track CRM campaigns without leaving QRM."
      />
      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <DeckSurface className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{summary.total}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Drafts</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{summary.drafts}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Running</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{summary.running}</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Completed</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{summary.completed}</p>
        </DeckSurface>
      </div>

      <DeckSurface className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Campaign control room</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Draft campaigns, attach an approved email or SMS template, build the audience, then run and inspect recipient outcomes from the same surface.
            </p>
          </div>
          <Button onClick={openNewCampaign}>
            <Plus className="mr-2 h-4 w-4" />
            New campaign
          </Button>
        </div>
      </DeckSurface>

      {campaignsQuery.isLoading ? (
        <DeckSurface className="p-6 text-center text-sm text-muted-foreground">
          Loading campaigns…
        </DeckSurface>
      ) : campaignsQuery.isError ? (
        <DeckSurface className="p-6 text-center text-sm text-red-300">
          Couldn&apos;t load campaigns right now.
        </DeckSurface>
      ) : campaigns.length === 0 ? (
        <DeckSurface className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No campaigns exist yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Create the first campaign to start segmenting and sending outreach from QRM.</p>
        </DeckSurface>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const audienceCount = readCampaignAudienceCount(campaign);
            const delivered = readCampaignExecutionCount(campaign, "delivered");
            const failed = readCampaignExecutionCount(campaign, "failed");
            const ineligible = readCampaignExecutionCount(campaign, "ineligible");
            const total = readCampaignExecutionCount(campaign, "total");
            const selected = selectedCampaignId === campaign.id;

            return (
              <DeckSurface key={campaign.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{campaign.name}</p>
                      <span className={`text-[11px] font-medium ${statusTone(campaign.state)}`}>
                        {formatCampaignState(campaign.state)}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {campaign.channel.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>Audience {audienceCount}</span>
                      <span>Total {total}</span>
                      <span className="text-emerald-400">Delivered {delivered}</span>
                      <span className="text-red-400">Failed {failed}</span>
                      <span className="text-amber-400">Ineligible {ineligible}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedCampaignId(selected ? null : campaign.id);
                      }}
                    >
                      <Users className="mr-2 h-4 w-4" />
                      {selected ? "Hide tracking" : "Track"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditCampaign(campaign)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => executeMutation.mutate(campaign.id)}
                      disabled={executeMutation.isPending}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Send
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => archiveMutation.mutate(campaign.id)}
                      disabled={archiveMutation.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Archive
                    </Button>
                  </div>
                </div>

                {selected && (
                  <div className="mt-4 space-y-2 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
                    {recipientsQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">Loading recipient results…</p>
                    ) : recipientsQuery.isError ? (
                      <p className="text-sm text-red-300">Couldn&apos;t load recipient results.</p>
                    ) : (recipientsQuery.data?.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No recipient results yet. Execute the campaign to generate tracking rows.</p>
                    ) : (
                      recipientsQuery.data?.map((recipient) => (
                        <div
                          key={recipient.id}
                          className="flex flex-col gap-1 rounded-sm border border-qep-deck-rule/40 bg-background/40 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{recipient.contactName}</span>
                            <span className={`text-[11px] font-medium ${statusTone(recipient.status)}`}>
                              {formatRecipientStatus(recipient.status)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[recipient.companyName, recipient.email ?? recipient.phone].filter(Boolean).join(" · ")}
                          </p>
                          {recipient.ineligibilityReason ? (
                            <p className="text-xs text-amber-300">{recipient.ineligibilityReason}</p>
                          ) : null}
                          {recipient.errorCode ? (
                            <p className="text-xs text-red-300">Error {recipient.errorCode}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </DeckSurface>
            );
          })}
        </div>
      )}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle>{editor.id ? "Edit campaign" : "New campaign"}</SheetTitle>
            <SheetDescription>
              Build the audience, choose the approved template, and keep the copy human before you send it.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={editor.name}
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
                placeholder="Prospect reactivation — North Florida"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="campaign-channel">Channel</Label>
                <select
                  id="campaign-channel"
                  value={editor.channel}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      channel: event.target.value as QrmCampaignChannel,
                      templateId: "",
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-template">Template</Label>
                <select
                  id="campaign-template"
                  value={editor.templateId}
                  onChange={(event) => setEditor((current) => ({ ...current, templateId: event.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="">No template selected</option>
                  {matchingTemplates.map((template: QrmActivityTemplate) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DeckSurface className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Audience</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search contacts, add them to the segment, then track results at the recipient level after send.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{editor.audienceContactIds.length} selected</p>
              </div>

              <div className="mt-4 space-y-3">
                <Input
                  value={contactSearchInput}
                  onChange={(event) => setContactSearchInput(event.target.value)}
                  placeholder="Search contacts by name, email, or phone"
                />

                {selectedAudience.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedAudience.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => removeAudienceContact(contact.id)}
                        className="rounded-full border border-qep-deck-rule px-3 py-1 text-xs text-foreground hover:border-qep-orange"
                      >
                        {contact.firstName} {contact.lastName} ×
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {contactSearchQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Searching contacts…</p>
                  ) : (
                    contactSearchResults.map((contact) => (
                      <div
                        key={contact.id}
                        className="flex items-center justify-between rounded-sm border border-qep-deck-rule/50 bg-background/40 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[contact.title, contact.email ?? contact.phone].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addAudienceContact(contact)}
                          disabled={editor.audienceContactIds.includes(contact.id)}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Add
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </DeckSurface>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editor.id ? "Save campaign" : "Create campaign"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
