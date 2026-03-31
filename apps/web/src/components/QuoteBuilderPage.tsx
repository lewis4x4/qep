import { useState, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import {
  ChevronLeft,
  Check,
  Printer,
  Plus,
  Search,
  Tractor,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { catalogAdapter } from "../lib/mock-catalog";
import type { Machine, Attachment } from "../lib/intellidealer.types";
import type { UserRole } from "../lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CustomerInsightCard,
  MarketValuationCard,
  useCustomerProfile,
  useMarketValuation,
} from "@/features/dge";
import { useToast } from "@/hooks/use-toast";
import {
  createCrmQuote,
  getCrmCompany,
  getCrmContact,
  getCrmDeal,
  updateCrmQuote,
} from "@/features/crm/lib/crm-api";
import type { CrmQuoteUpsertInput } from "@/features/crm/lib/types";

interface QuoteBuilderPageProps {
  userRole: UserRole;
  userEmail: string | null;
  repName: string | null;
}

type Step = "customer" | "machine" | "review";

interface CustomerForm {
  name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
}

const STEPS: { key: Step; label: string }[] = [
  { key: "customer", label: "Customer Info" },
  { key: "machine", label: "Equipment" },
  { key: "review", label: "Proposal" },
];

const STEP_QUERY = "step";

function parseQuoteStep(raw: string | null): Step {
  if (raw === "customer" || raw === "machine" || raw === "review") return raw;
  return "customer";
}

const CATEGORY_LABELS: Record<string, string> = {
  excavator: "Excavator",
  wheel_loader: "Wheel Loader",
  backhoe: "Backhoe",
  skid_steer: "Skid Steer",
  compact_track_loader: "Compact Track Loader",
  motor_grader: "Motor Grader",
  dozer: "Dozer",
  telehandler: "Telehandler",
  forklift: "Forklift",
  utility_vehicle: "Utility Vehicle",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function stepIndex(step: Step): number {
  return STEPS.findIndex((s) => s.key === step);
}

function buildQuoteLineItems(
  machine: Machine,
  attachments: Attachment[]
): Array<Record<string, unknown>> {
  const machineLine: Record<string, unknown> = {
    type: "machine",
    stock_number: machine.stockNumber,
    make: machine.make,
    model: machine.model,
    year: machine.year,
    category: machine.category,
    condition: machine.condition,
    unit_price: machine.retailPrice,
    quantity: 1,
    subtotal: machine.retailPrice,
  };

  const attachmentLines = attachments.map((attachment) => ({
    type: "attachment",
    attachment_id: attachment.id,
    name: attachment.name,
    category: attachment.category,
    unit_price: attachment.retailPrice,
    quantity: 1,
    subtotal: attachment.retailPrice,
  }));

  return [machineLine, ...attachmentLines];
}

// ── Main component ───────────────────────────────────────────────────────────

export function QuoteBuilderPage({ userRole, userEmail, repName }: QuoteBuilderPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const seededContactId = searchParams.get("crm_contact_id");
  const seededDealId = searchParams.get("crm_deal_id");

  const stepParam = searchParams.get(STEP_QUERY);
  const step = parseQuoteStep(stepParam);

  const pushStep = useCallback(
    (next: Step) => {
      setSearchParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set(STEP_QUERY, next);
          return n;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const replaceStep = useCallback(
    (next: Step) => {
      setSearchParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set(STEP_QUERY, next);
          return n;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const goBackStep = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  useLayoutEffect(() => {
    if (
      stepParam !== "customer" &&
      stepParam !== "machine" &&
      stepParam !== "review"
    ) {
      setSearchParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set(STEP_QUERY, "customer");
          return n;
        },
        { replace: true }
      );
    }
  }, [stepParam, setSearchParams]);
  const [customer, setCustomer] = useState<CustomerForm>({
    name: "",
    company: "",
    phone: "",
    email: "",
    address: "",
  });
  const [customerErrors, setCustomerErrors] = useState<Partial<CustomerForm>>({});

  const [machines, setMachines] = useState<Machine[]>([]);
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment[]>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [conditionFilter, setConditionFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [crmContactId, setCrmContactId] = useState<string | null>(seededContactId);
  const [crmDealId, setCrmDealId] = useState<string | null>(seededDealId);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  const [saveQuotePending, setSaveQuotePending] = useState(false);
  const [saveQuoteError, setSaveQuoteError] = useState<string | null>(null);
  const [crmContextSummary, setCrmContextSummary] = useState<string | null>(null);

  // Load machine catalog when entering step 2
  useEffect(() => {
    if (step !== "machine" || machines.length > 0) return;
    setCatalogLoading(true);
    catalogAdapter.getMachines().then((list) => {
      setMachines(list);
      setCatalogLoading(false);
    });
  }, [step, machines.length]);

  useEffect(() => {
    if (step === "review" && !selectedMachine) {
      replaceStep("machine");
    }
  }, [step, selectedMachine, replaceStep]);

  // Load attachments when a machine is selected
  useEffect(() => {
    if (!selectedMachine) return;
    const cat = selectedMachine.category;
    if (attachmentsMap[cat]) return;
    catalogAdapter
      .getAttachments(cat)
      .then((list) => setAttachmentsMap((prev) => ({ ...prev, [cat]: list })));
  }, [selectedMachine, attachmentsMap]);

  useEffect(() => {
    if (!seededContactId && !seededDealId) {
      return;
    }

    let cancelled = false;

    async function hydrateFromCrm(): Promise<void> {
      try {
        let resolvedContactId = seededContactId;
        const summaryParts: string[] = [];

        if (seededDealId) {
          const deal = await getCrmDeal(seededDealId);
          if (deal) {
            setCrmDealId(deal.id);
            if (!resolvedContactId && deal.primaryContactId) {
              resolvedContactId = deal.primaryContactId;
              setCrmContactId(deal.primaryContactId);
            }
            summaryParts.push(`Deal: ${deal.name}`);
          }
        }

        if (resolvedContactId) {
          const contact = await getCrmContact(resolvedContactId);
          if (!contact) {
            return;
          }

          setCrmContactId(contact.id);
          let companyName = "";
          if (contact.primaryCompanyId) {
            const company = await getCrmCompany(contact.primaryCompanyId);
            companyName = company?.name ?? "";
          }

          if (!cancelled) {
            setCustomer((current) => ({
              name: current.name || `${contact.firstName} ${contact.lastName}`.trim(),
              company: current.company || companyName || "",
              phone: current.phone || contact.phone || "",
              email: current.email || contact.email || "",
              address: current.address,
            }));
          }

          summaryParts.push(`Contact: ${contact.firstName} ${contact.lastName}`);
        }

        if (!cancelled && summaryParts.length > 0) {
          setCrmContextSummary(summaryParts.join(" · "));
        }
      } catch {
        if (!cancelled) {
          toast({
            title: "CRM context unavailable",
            description: "Quote Builder loaded, but CRM prefill could not be applied.",
            variant: "destructive",
          });
        }
      }
    }

    void hydrateFromCrm();

    return () => {
      cancelled = true;
    };
  }, [seededContactId, seededDealId, toast]);

  const currentAttachments = selectedMachine
    ? (attachmentsMap[selectedMachine.category] ?? [])
    : [];

  const selectedAttachmentObjects = currentAttachments.filter((a) =>
    selectedAttachments.has(a.id)
  );

  const machineTotal = selectedMachine?.retailPrice ?? 0;
  const attachmentsTotal = selectedAttachmentObjects.reduce(
    (sum, a) => sum + a.retailPrice,
    0
  );
  const grandTotal = machineTotal + attachmentsTotal;

  function validateCustomer(): boolean {
    const errors: Partial<CustomerForm> = {};
    if (!customer.name.trim()) errors.name = "Required";
    if (!customer.company.trim()) errors.company = "Required";
    if (!customer.phone.trim()) errors.phone = "Required";
    if (!customer.email.trim()) {
      errors.email = "Required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      errors.email = "Enter a valid email";
    }
    setCustomerErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const toggleAttachment = useCallback((id: string) => {
    setSelectedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleNewQuote() {
    setSearchParams(
      (p) => {
        const n = new URLSearchParams();
        const c = p.get("crm_contact_id");
        const d = p.get("crm_deal_id");
        if (c) n.set("crm_contact_id", c);
        if (d) n.set("crm_deal_id", d);
        n.set(STEP_QUERY, "customer");
        return n;
      },
      { replace: true }
    );
    setCustomer({ name: "", company: "", phone: "", email: "", address: "" });
    setCustomerErrors({});
    setSelectedMachine(null);
    setSelectedAttachments(new Set());
    setNotes("");
    setCategoryFilter("all");
    setConditionFilter("all");
    setSearchQuery("");
    setSavedQuoteId(null);
    setSaveQuoteError(null);
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const effectiveSearchQuery = normalizedSearchQuery.length > 256
    ? normalizedSearchQuery.slice(0, 256)
    : normalizedSearchQuery;

  const filteredMachines = machines.filter((m) => {
    if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
    if (conditionFilter !== "all" && m.condition !== conditionFilter) return false;
    if (effectiveSearchQuery) {
      if (
        !m.make.toLowerCase().includes(effectiveSearchQuery) &&
        !m.model.toLowerCase().includes(effectiveSearchQuery) &&
        !(CATEGORY_LABELS[m.category] ?? "").toLowerCase().includes(effectiveSearchQuery)
      )
        return false;
    }
    return true;
  });

  const uniqueCategories = Array.from(new Set(machines.map((m) => m.category)));
  const currentStepIndex = stepIndex(step);
  const valuationRequest = useMemo(
    () =>
      selectedMachine
        ? {
            make: selectedMachine.make,
            model: selectedMachine.model,
            year: selectedMachine.year,
            hours: selectedMachine.hoursOrMiles ?? 0,
            condition: selectedMachine.condition,
            location: customer.address || undefined,
            stock_number: selectedMachine.stockNumber,
          }
        : null,
    [selectedMachine, customer.address]
  );
  const customerLookup = useMemo(
    () => ({
      email: customer.email.trim() || undefined,
      includeFleet: userRole !== "rep",
    }),
    [customer.email, userRole]
  );
  const reviewStepActive = step === "review";
  const {
    data: marketValuation,
    loading: marketValuationLoading,
    error: marketValuationError,
    refresh: refreshMarketValuation,
  } = useMarketValuation(valuationRequest, reviewStepActive && Boolean(valuationRequest));
  const {
    data: customerProfile,
    loading: customerProfileLoading,
    error: customerProfileError,
    refresh: refreshCustomerProfile,
  } = useCustomerProfile(customerLookup, reviewStepActive && Boolean(customerLookup.email));

  async function handleSaveQuote(): Promise<void> {
    if (!selectedMachine) {
      replaceStep("machine");
      return;
    }

    if (!validateCustomer()) {
      replaceStep("customer");
      return;
    }

    const hasCrmLink = Boolean(crmContactId || crmDealId);
    const status: CrmQuoteUpsertInput["status"] = hasCrmLink ? "linked" : "draft";
    const lineItems = buildQuoteLineItems(selectedMachine, selectedAttachmentObjects);
    const customerSnapshot = {
      name: customer.name.trim(),
      company: customer.company.trim(),
      phone: customer.phone.trim(),
      email: customer.email.trim(),
      address: customer.address.trim() || null,
    };

    const payload: CrmQuoteUpsertInput = {
      crmContactId,
      crmDealId,
      status,
      title: `${customer.company.trim() || customer.name.trim()} — ${selectedMachine.make} ${selectedMachine.model}`,
      lineItems,
      customerSnapshot,
      metadata: {
        notes: notes.trim() || null,
        source: "quote_builder_ui",
      },
      linkedAt: status === "linked" ? new Date().toISOString() : null,
    };

    try {
      setSaveQuotePending(true);
      setSaveQuoteError(null);

      const saved = savedQuoteId
        ? await updateCrmQuote(savedQuoteId, payload)
        : await createCrmQuote(payload);

      setSavedQuoteId(saved.id);
      toast({
        title: savedQuoteId ? "Quote updated" : "Quote saved",
        description: hasCrmLink
          ? "Quote is durably linked to CRM."
          : "Quote saved as draft. Link to a CRM contact or deal when available.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save quote.";
      setSaveQuoteError(message);
      toast({
        title: "Quote save failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaveQuotePending(false);
    }
  }

  return (
    <>
      <ProposalPrint
        customer={customer}
        repName={repName ?? userEmail ?? ""}
        repEmail={userEmail ?? ""}
        selectedMachine={selectedMachine}
        selectedAttachments={selectedAttachmentObjects}
        notes={notes}
        grandTotal={grandTotal}
      />

      <div className="flex flex-col min-h-screen bg-background print:hidden">
        <main className="flex-1 px-6 py-6">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">Quote Builder</h1>
          <p className="text-sm text-muted-foreground">
            Build and print equipment proposals for customers
          </p>
        </div>

        {/* Step wizard */}
        <div className="mb-6">
          <div className="flex items-start max-w-md">
            {STEPS.map((s, i) => {
              const isDone = currentStepIndex > i;
              const isActive = currentStepIndex === i;
              return (
                <div key={s.key} className="flex items-start flex-1 last:flex-none">
                  <button
                    onClick={() => {
                      if (isDone) replaceStep(s.key);
                    }}
                    disabled={!isDone}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                        isDone
                          ? "bg-primary text-primary-foreground"
                          : isActive
                          ? "bg-accent text-accent-foreground ring-2 ring-accent ring-offset-2"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {isDone ? <Check className="w-4 h-4" /> : i + 1}
                    </div>
                    <span
                      className={cn(
                        "text-xs whitespace-nowrap",
                        isActive ? "text-foreground font-medium" : "text-muted-foreground"
                      )}
                    >
                      {s.label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div
                      className={cn(
                        "flex-1 h-px mx-2 mt-4",
                        currentStepIndex > i ? "bg-primary" : "bg-border"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── STEP 1: Customer Info ───────────────────────────────────── */}
          {step === "customer" && (
            <div className="xl:grid xl:grid-cols-12 xl:gap-8">
            <div className="xl:col-span-7">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Customer Information</CardTitle>
                  <p className="text-sm text-muted-foreground">Fill in who this quote is for.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      label="Contact Name"
                      required
                      value={customer.name}
                      error={customerErrors.name}
                      placeholder="John Smith"
                      onChange={(v) => setCustomer((c) => ({ ...c, name: v }))}
                    />
                    <FormField
                      label="Company"
                      required
                      value={customer.company}
                      error={customerErrors.company}
                      placeholder="Smith Construction LLC"
                      onChange={(v) => setCustomer((c) => ({ ...c, company: v }))}
                    />
                    <FormField
                      label="Phone"
                      required
                      type="tel"
                      value={customer.phone}
                      error={customerErrors.phone}
                      placeholder="(386) 555-0100"
                      onChange={(v) => setCustomer((c) => ({ ...c, phone: v }))}
                    />
                    <FormField
                      label="Email"
                      required
                      type="email"
                      value={customer.email}
                      error={customerErrors.email}
                      placeholder="john@smithconstruction.com"
                      onChange={(v) => setCustomer((c) => ({ ...c, email: v }))}
                    />
                    <div className="sm:col-span-2">
                      <FormField
                        label="Address"
                        value={customer.address}
                        placeholder="123 Main St, Lake City, FL 32025"
                        onChange={(v) => setCustomer((c) => ({ ...c, address: v }))}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (validateCustomer()) pushStep("machine");
                    }}
                  >
                    Select Equipment
                  </Button>
                </CardContent>
              </Card>
            </div>

            <aside className="hidden xl:flex xl:col-span-5 flex-col gap-4 pt-1">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Before you continue</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Double-check the email — the proposal will reference this address when printed.</p>
                  <p>Include the company address if delivery or job-site pricing applies.</p>
                  <p>Phone number is required for follow-up task creation in CRM.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Quote workflow</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex gap-2">
                    <span className="text-primary font-bold shrink-0">1</span>
                    <span>Enter customer info</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground font-bold shrink-0">2</span>
                    <span>Select machine + attachments</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-muted-foreground font-bold shrink-0">3</span>
                    <span>Review and print proposal</span>
                  </div>
                </CardContent>
              </Card>
            </aside>
            </div>
          )}

          {/* ── STEP 2: Equipment Selection ─────────────────────────────── */}
          {step === "machine" && (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBackStep}
                  className="text-muted-foreground"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <h2 className="text-base font-semibold text-foreground flex-1">
                  {selectedMachine ? "Add Attachments" : "Select Equipment"}
                </h2>
              </div>

              {/* Filters (only when browsing catalog) */}
              {!selectedMachine && (
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search machines..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <SelectFilter value={categoryFilter} onChange={setCategoryFilter}>
                    <option value="all">All Categories</option>
                    {uniqueCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat] ?? cat}
                      </option>
                    ))}
                  </SelectFilter>
                  <SelectFilter value={conditionFilter} onChange={setConditionFilter}>
                    <option value="all">All Conditions</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="rental">Rental</option>
                  </SelectFilter>
                </div>
              )}

              {/* Loading state — skeleton cards; also covers initial render frame before useEffect fires */}
              {!selectedMachine && (catalogLoading || machines.length === 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <CardContent className="pt-4 pb-3">
                        <div className="w-full h-24 bg-muted rounded-md mb-3 animate-pulse" />
                        <div className="h-4 bg-muted rounded animate-pulse mb-1.5 w-3/4" />
                        <div className="h-3 bg-muted rounded animate-pulse mb-3 w-1/3" />
                        <div className="flex gap-1.5 mb-2">
                          <div className="h-5 bg-muted rounded-full animate-pulse w-20" />
                          <div className="h-5 bg-muted rounded-full animate-pulse w-16" />
                        </div>
                        <div className="h-3 bg-muted rounded animate-pulse mb-1 w-full" />
                        <div className="h-3 bg-muted rounded animate-pulse mb-3 w-4/5" />
                        <div className="h-5 bg-muted rounded animate-pulse w-24" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Selected machine + attachments */}
              {selectedMachine && (
                <div className="space-y-4">
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="py-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-primary font-medium mb-0.5">Selected Machine</p>
                        <p className="text-sm font-semibold text-foreground">
                          {selectedMachine.year} {selectedMachine.make}{" "}
                          {selectedMachine.model}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[selectedMachine.category]} ·{" "}
                          {selectedMachine.condition === "new"
                            ? "New"
                            : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}{" "}
                          · {formatCurrency(selectedMachine.retailPrice)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedMachine(null);
                          setSelectedAttachments(new Set());
                        }}
                      >
                        Change
                      </Button>
                    </CardContent>
                  </Card>

                  {currentAttachments.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Available Attachments
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {currentAttachments.map((att) => {
                          const checked = selectedAttachments.has(att.id);
                          return (
                            <button
                              key={att.id}
                              onClick={() => toggleAttachment(att.id)}
                              className={cn(
                                "w-full flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors",
                                checked
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border hover:bg-muted/40"
                              )}
                            >
                              <div
                                className={cn(
                                  "w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors",
                                  checked
                                    ? "bg-primary border-primary"
                                    : "border-muted-foreground/40"
                                )}
                              >
                                {checked && (
                                  <Check className="w-3 h-3 text-primary-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {att.name}
                                </p>
                                <p className="text-xs text-muted-foreground capitalize">
                                  {att.category.replace(/_/g, " ")}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-foreground flex-shrink-0">
                                {formatCurrency(att.retailPrice)}
                              </span>
                            </button>
                          );
                        })}
                      </CardContent>
                    </Card>
                  )}

                  {/* Running total */}
                  <Card>
                    <CardContent className="py-3 space-y-1.5">
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Machine</span>
                        <span>{formatCurrency(machineTotal)}</span>
                      </div>
                      {selectedAttachmentObjects.map((a) => (
                        <div key={a.id} className="flex justify-between text-sm text-muted-foreground">
                          <span className="truncate mr-2">{a.name}</span>
                          <span className="flex-shrink-0">{formatCurrency(a.retailPrice)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Total</span>
                        <span>{formatCurrency(grandTotal)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={goBackStep}>
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </Button>
                    <Button className="flex-1" onClick={() => pushStep("review")}>
                      Review Proposal
                    </Button>
                  </div>
                </div>
              )}

              {/* Machine catalog grid */}
              {!selectedMachine && !catalogLoading && machines.length > 0 && (
                <>
                  {filteredMachines.length === 0 ? (
                    <div className="flex flex-col items-center py-16 text-center">
                      <p className="text-sm text-muted-foreground">
                        No machines match your filters.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          setCategoryFilter("all");
                          setConditionFilter("all");
                          setSearchQuery("");
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredMachines.map((m) => (
                        <MachineCard
                          key={m.stockNumber}
                          machine={m}
                          onSelect={() => setSelectedMachine(m)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Proposal Preview ─────────────────────────────────── */}
          {step === "review" && selectedMachine && (
            <div className="xl:grid xl:grid-cols-12 xl:gap-8">
            <div className="xl:col-span-7 space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBackStep}
                  className="text-muted-foreground"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <h2 className="text-base font-semibold text-foreground flex-1">
                  Proposal Preview
                </h2>
              </div>

              {/* QEP branding header */}
              <Card>
                <CardContent className="pt-4 pb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">
                      Quality Equipment &amp; Parts, Inc.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Lake City, FL · Equipment Quote
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{repName ?? userEmail}</p>
                    <p>{userEmail}</p>
                    <p>
                      {new Date().toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Customer info */}
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Customer
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto py-0 text-xs text-primary"
                      onClick={() => pushStep("customer")}
                    >
                      Edit
                    </Button>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{customer.name}</p>
                  <p className="text-sm text-muted-foreground">{customer.company}</p>
                  {customer.address && (
                    <p className="text-xs text-muted-foreground">{customer.address}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {customer.phone} · {customer.email}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-[#E2E8F0] bg-[#F8FAFC]">
                <CardContent className="pt-4 pb-3 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#475569]">
                    CRM Linkage
                  </p>
                  <p className="text-sm text-[#0F172A]">
                    {crmContextSummary ?? "No CRM entity selected."}
                  </p>
                  {!crmContactId && !crmDealId && (
                    <p className="text-xs text-[#64748B]">
                      This quote will save as <strong>draft</strong> until it is started from a contact or deal.
                    </p>
                  )}
                  {(crmDealId || crmContactId) && (
                    <div className="flex flex-wrap gap-2">
                      {crmDealId && (
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/crm/deals/${crmDealId}`}>Open Deal</Link>
                        </Button>
                      )}
                      {crmContactId && (
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/crm/contacts/${crmContactId}`}>Open Contact</Link>
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Line items table */}
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Equipment
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto py-0 text-xs text-primary"
                      onClick={() => pushStep("machine")}
                    >
                      Edit
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <p className="font-medium">
                            {selectedMachine.year} {selectedMachine.make}{" "}
                            {selectedMachine.model}
                          </p>
                          {selectedMachine.stockNumber && (
                            <p className="text-xs text-muted-foreground">
                              Stock #{selectedMachine.stockNumber}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {CATEGORY_LABELS[selectedMachine.category]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={selectedMachine.condition === "new" ? "default" : "outline"}
                          >
                            {selectedMachine.condition === "new"
                              ? "New"
                              : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(selectedMachine.retailPrice)}
                        </TableCell>
                      </TableRow>
                      {selectedAttachmentObjects.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <p className="font-medium">{a.name}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {a.category.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">—</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(a.retailPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Separator className="my-2" />
                  <div className="flex justify-between items-center px-4">
                    <span className="text-sm font-semibold text-foreground">Total</span>
                    <span className="text-sm font-bold text-foreground">
                      {formatCurrency(grandTotal)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              <div className="grid gap-4 lg:grid-cols-2">
                <MarketValuationCard
                  data={marketValuation}
                  loading={marketValuationLoading}
                  error={marketValuationError}
                  onRefresh={refreshMarketValuation}
                />
                <CustomerInsightCard
                  data={customerProfile}
                  loading={customerProfileLoading}
                  error={customerProfileError}
                  onRefresh={refreshCustomerProfile}
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="quote-notes" className="text-xs font-medium text-muted-foreground">
                  Notes{" "}
                  <span className="font-normal">(optional)</span>
                </Label>
                <textarea
                  id="quote-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Trade-in discussed, delivery to Lake City, financing options..."
                  rows={3}
                  className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-qep-orange resize-none"
                />
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Pricing valid through {addDays(30)}
              </p>

              {saveQuoteError && (
                <p className="text-sm text-destructive" role="alert">
                  {saveQuoteError}
                </p>
              )}

              <div className="flex gap-2 pb-6">
                <Button variant="outline" onClick={goBackStep}>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button className="flex-1" onClick={() => void handleSaveQuote()} disabled={saveQuotePending}>
                  {saveQuotePending ? "Saving..." : savedQuoteId ? "Update Quote" : "Save Quote"}
                </Button>
                <Button className="flex-1" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print / Download PDF
                </Button>
                <Button variant="outline" onClick={handleNewQuote}>
                  New Quote
                </Button>
              </div>
            </div>

            <aside className="hidden xl:flex xl:col-span-5 flex-col gap-4 pt-1">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Proposal summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium text-foreground text-right max-w-[60%] truncate">{customer.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Company</span>
                    <span className="font-medium text-foreground text-right max-w-[60%] truncate">{customer.company}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Machine</span>
                    <span className="font-medium text-foreground text-right max-w-[60%]">{formatCurrency(machineTotal)}</span>
                  </div>
                  {selectedAttachmentObjects.map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <span className="text-muted-foreground truncate mr-2">{a.name}</span>
                      <span className="font-medium text-foreground shrink-0">{formatCurrency(a.retailPrice)}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold text-foreground text-lg">{formatCurrency(grandTotal)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
                  <p>Pricing valid for 30 days. Print or download PDF to send to the customer.</p>
                  <p>After printing, create a CRM follow-up so the next step stays attached to the deal.</p>
                </CardContent>
              </Card>
            </aside>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function formFieldDomId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `qb-${slug || "field"}`;
}

function FormField({
  label,
  required,
  value,
  error,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  error?: string;
  placeholder?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  const inputId = formFieldDomId(label);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={inputId}
        data-testid={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={error ? "border-destructive focus-visible:ring-destructive" : ""}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SelectFilter({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-qep-orange"
    >
      {children}
    </select>
  );
}

function MachineCard({ machine, onSelect }: { machine: Machine; onSelect: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all"
      onClick={onSelect}
    >
      <CardContent className="pt-4 pb-3">
        {/* Image placeholder */}
        <div className="w-full h-24 bg-muted rounded-md mb-3 flex items-center justify-center">
          <Tractor className="w-10 h-10 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-semibold text-foreground">
          {machine.year} {machine.make} {machine.model}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          Stock #{machine.stockNumber}
        </p>
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {CATEGORY_LABELS[machine.category]}
          </Badge>
          <Badge
            variant={machine.condition === "new" ? "default" : "outline"}
            className="text-xs"
          >
            {machine.condition === "new"
              ? "New"
              : `Used — ${machine.hoursOrMiles?.toLocaleString()} hrs`}
          </Badge>
        </div>
        {machine.specs.slice(0, 2).map((s) => (
          <p key={s.label} className="text-xs text-muted-foreground">
            {s.label}: {s.value}
          </p>
        ))}
        <p className="text-sm font-bold text-foreground mt-2">
          {formatCurrency(machine.retailPrice)}
        </p>
        <Button
          size="sm"
          className="w-full mt-2"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add to Quote
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Print-only proposal ──────────────────────────────────────────────────────

interface ProposalPrintProps {
  customer: CustomerForm;
  repName: string;
  repEmail: string;
  selectedMachine: Machine | null;
  selectedAttachments: Attachment[];
  notes: string;
  grandTotal: number;
}

function ProposalPrint({
  customer,
  repName,
  repEmail,
  selectedMachine,
  selectedAttachments,
  notes,
  grandTotal,
}: ProposalPrintProps) {
  if (!selectedMachine) return null;

  const machinePrice = selectedMachine.retailPrice;
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const printTokens = {
    text: "hsl(var(--qep-charcoal))",
    heading: "hsl(var(--qep-dark))",
    muted: "hsl(var(--qep-gray))",
    border: "hsl(var(--qep-light-gray))",
    panel: "hsl(var(--qep-bg))",
    accent: "hsl(var(--qep-orange))",
    accentStrong: "hsl(var(--qep-orange-accessible))",
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #qep-proposal, #qep-proposal * { visibility: visible; }
          #qep-proposal { position: absolute; top: 0; left: 0; width: 100%; }
          @page { size: 8.5in 11in; margin: 1in; }
        }
      `}</style>
      <div
        id="qep-proposal"
        className="hidden print:block p-8 max-w-[8.5in] mx-auto font-sans"
        style={{ color: printTokens.text }}
      >
        {/* Letterhead */}
        <div
          className="flex items-start justify-between pb-4 mb-6"
          style={{ borderBottom: `2px solid ${printTokens.accent}` }}
        >
          <div>
            <h1 className="text-2xl font-bold" style={{ color: printTokens.heading }}>
              Quality Equipment &amp; Parts, Inc.
            </h1>
            <p className="text-sm leading-5 mt-0.5" style={{ color: printTokens.text }}>
              Lake City, FL · qepusa.com
            </p>
          </div>
          <div className="text-right text-sm" style={{ color: printTokens.text }}>
            <p className="font-semibold" style={{ color: printTokens.heading }}>{repName}</p>
            <p>{repEmail}</p>
            <p>{today}</p>
          </div>
        </div>

        {/* Customer */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-1" style={{ color: printTokens.heading }}>
            Equipment Quote
          </h2>
          <div className="text-base space-y-0.5" style={{ color: printTokens.text }}>
            <p>
              <span className="font-medium">Customer:</span> {customer.name}
            </p>
            <p>
              <span className="font-medium">Company:</span> {customer.company}
            </p>
            {customer.address && (
              <p>
                <span className="font-medium">Address:</span> {customer.address}
              </p>
            )}
            <p>
              <span className="font-medium">Phone:</span> {customer.phone}
            </p>
            <p>
              <span className="font-medium">Email:</span> {customer.email}
            </p>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr style={{ backgroundColor: printTokens.panel }}>
              <th
                className="text-left px-3 py-2 font-semibold"
                style={{ color: printTokens.heading, border: `1px solid ${printTokens.border}` }}
              >
                Description
              </th>
              <th
                className="text-right px-3 py-2 font-semibold whitespace-nowrap"
                style={{ color: printTokens.heading, border: `1px solid ${printTokens.border}` }}
              >
                Unit Price
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                className="px-3 py-2"
                style={{ border: `1px solid ${printTokens.border}`, color: printTokens.text }}
              >
                <p className="font-medium">{selectedMachine.year} {selectedMachine.make} {selectedMachine.model}</p>
                <p className="text-xs" style={{ color: printTokens.muted }}>
                  {CATEGORY_LABELS[selectedMachine.category]} ·{" "}
                  {selectedMachine.condition === "new"
                    ? "New"
                    : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}
                  {selectedMachine.stockNumber
                    ? ` · Stock #${selectedMachine.stockNumber}`
                    : ""}
                </p>
              </td>
              <td
                className="px-3 py-2 text-right font-medium"
                style={{ border: `1px solid ${printTokens.border}`, color: printTokens.text }}
              >
                {formatCurrency(machinePrice)}
              </td>
            </tr>
            {selectedAttachments.map((a) => (
              <tr key={a.id}>
                <td
                  className="px-3 py-2"
                  style={{ border: `1px solid ${printTokens.border}`, color: printTokens.text }}
                >
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs capitalize" style={{ color: printTokens.muted }}>
                    {a.category.replace(/_/g, " ")}
                  </p>
                </td>
                <td
                  className="px-3 py-2 text-right font-medium"
                  style={{ border: `1px solid ${printTokens.border}`, color: printTokens.text }}
                >
                  {formatCurrency(a.retailPrice)}
                </td>
              </tr>
            ))}
            <tr style={{ backgroundColor: printTokens.panel }}>
              <td
                className="px-3 py-2 font-bold text-right"
                style={{ border: `1px solid ${printTokens.border}`, color: printTokens.heading }}
              >
                Total
              </td>
              <td
                className="px-3 py-2 text-right font-bold text-base"
                style={{ border: `1px solid ${printTokens.border}`, color: printTokens.accentStrong }}
              >
                {formatCurrency(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Key specs */}
        {selectedMachine.specs.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-2" style={{ color: printTokens.heading }}>
              Key Specifications
            </h3>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {selectedMachine.specs.map((s) => (
                  <tr key={s.label}>
                    <td
                      className="px-3 py-1.5 w-1/2"
                      style={{ border: `1px solid ${printTokens.border}`, color: printTokens.muted }}
                    >
                      {s.label}
                    </td>
                    <td
                      className="px-3 py-1.5 font-medium"
                      style={{ border: `1px solid ${printTokens.border}`, color: printTokens.text }}
                    >
                      {s.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Notes */}
        {notes.trim() && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-1" style={{ color: printTokens.heading }}>
              Notes
            </h3>
            <p
              className="text-sm whitespace-pre-wrap rounded p-3"
              style={{ color: printTokens.text, border: `1px solid ${printTokens.border}` }}
            >
              {notes}
            </p>
          </div>
        )}

        {/* Footer */}
        <div
          className="pt-4 text-xs space-y-1"
          style={{ borderTop: `1px solid ${printTokens.border}`, color: printTokens.muted }}
        >
          <p>
            Pricing valid for 30 days from {today}. Quote subject to final inventory
            confirmation.
          </p>
          <p>
            Financing options available. Contact your QEP sales representative for details.
          </p>
        </div>
      </div>
    </>
  );
}
