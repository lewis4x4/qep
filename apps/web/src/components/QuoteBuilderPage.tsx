import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { catalogAdapter } from "../lib/mock-catalog";
import type { Machine, Attachment } from "../lib/intellidealer.types";
import type { UserRole } from "../lib/database.types";

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

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents);
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function QuoteBuilderPage({ userRole, userEmail, repName }: QuoteBuilderPageProps) {
  const [step, setStep] = useState<Step>("customer");
  const [customer, setCustomer] = useState<CustomerForm>({
    name: "",
    company: "",
    phone: "",
    email: "",
  });
  const [customerErrors, setCustomerErrors] = useState<Partial<CustomerForm>>({});

  const [machines, setMachines] = useState<Machine[]>([]);
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment[]>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");

  // Load machine catalog when entering step 2
  useEffect(() => {
    if (step !== "machine" || machines.length > 0) return;
    setCatalogLoading(true);
    catalogAdapter.getMachines().then((list) => {
      setMachines(list);
      setCatalogLoading(false);
    });
  }, [step, machines.length]);

  // Load attachments when a machine is selected
  useEffect(() => {
    if (!selectedMachine) return;
    const cat = selectedMachine.category;
    if (attachmentsMap[cat]) return; // already loaded
    catalogAdapter.getAttachments(cat).then((list) => {
      setAttachmentsMap((prev) => ({ ...prev, [cat]: list }));
    });
  }, [selectedMachine, attachmentsMap]);

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

  function handleCustomerNext() {
    if (validateCustomer()) setStep("machine");
  }

  function handleMachineNext() {
    if (selectedMachine) setStep("review");
  }

  const toggleAttachment = useCallback((id: string) => {
    setSelectedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  function handlePrint() {
    window.print();
  }

  function handleNewQuote() {
    setStep("customer");
    setCustomer({ name: "", company: "", phone: "", email: "" });
    setCustomerErrors({});
    setSelectedMachine(null);
    setSelectedAttachments(new Set());
    setNotes("");
    setCategoryFilter("all");
    setConditionFilter("all");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const filteredMachines = machines.filter((m) => {
    if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
    if (conditionFilter !== "all" && m.condition !== conditionFilter) return false;
    return true;
  });

  const uniqueCategories = Array.from(new Set(machines.map((m) => m.category)));

  return (
    <>
      {/* ── Print-only proposal (hidden in browser, shown when printing) ── */}
      <ProposalPrint
        customer={customer}
        repName={repName ?? userEmail ?? ""}
        repEmail={userEmail ?? ""}
        selectedMachine={selectedMachine}
        selectedAttachments={selectedAttachmentObjects}
        notes={notes}
        grandTotal={grandTotal}
      />

      {/* ── Screen UI ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col min-h-screen bg-gray-50 print:hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <DocumentIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Quote Builder</h1>
              <p className="text-xs text-gray-400 capitalize">{userRole}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs text-blue-600 hover:underline">Knowledge</a>
            <a href="/voice" className="text-xs text-blue-600 hover:underline">Field Note</a>
            {["admin", "manager", "owner"].includes(userRole) && (
              <a href="/admin" className="text-xs text-blue-600 hover:underline">Admin</a>
            )}
            <button onClick={handleSignOut} className="text-xs text-gray-500 hover:text-gray-700">
              Sign out
            </button>
          </div>
        </header>

        {/* Step indicator */}
        <div className="bg-white border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2 max-w-lg mx-auto">
            <StepDot active={step === "customer"} done={step !== "customer"} label="Customer" />
            <div className={`flex-1 h-px ${step === "customer" ? "bg-gray-200" : "bg-green-500"}`} />
            <StepDot
              active={step === "machine"}
              done={step === "review"}
              label="Equipment"
            />
            <div className={`flex-1 h-px ${step === "review" ? "bg-green-500" : "bg-gray-200"}`} />
            <StepDot active={step === "review"} done={false} label="Proposal" />
          </div>
        </div>

        <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">

          {/* ── STEP 1: Customer info ──────────────────────────────────── */}
          {step === "customer" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Customer information</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Fill in who this quote is for.
                </p>
              </div>

              <div className="space-y-4">
                <FormField
                  label="Contact name"
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
              </div>

              <button
                onClick={handleCustomerNext}
                className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 active:scale-95 transition"
              >
                Select equipment
              </button>
            </div>
          )}

          {/* ── STEP 2: Machine + attachments ─────────────────────────── */}
          {step === "machine" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep("customer")}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" /> Back
                </button>
                <h2 className="text-base font-semibold text-gray-900 flex-1">
                  {selectedMachine ? "Add attachments" : "Select equipment"}
                </h2>
              </div>

              {/* Machine selected summary + clear */}
              {selectedMachine && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-green-600 font-medium">Selected</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {selectedMachine.year} {selectedMachine.make} {selectedMachine.model}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(selectedMachine.retailPrice)} · {selectedMachine.condition === "new" ? "New" : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedMachine(null);
                      setSelectedAttachments(new Set());
                    }}
                    className="text-xs text-gray-400 hover:text-red-500 mt-0.5 whitespace-nowrap"
                  >
                    Change
                  </button>
                </div>
              )}

              {/* Attachment list */}
              {selectedMachine && currentAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Available attachments
                  </p>
                  <div className="space-y-2">
                    {currentAttachments.map((att) => {
                      const checked = selectedAttachments.has(att.id);
                      return (
                        <button
                          key={att.id}
                          onClick={() => toggleAttachment(att.id)}
                          className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                            checked
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition ${
                            checked ? "bg-green-500 border-green-500" : "border-gray-300"
                          }`}>
                            {checked && <CheckSmallIcon className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{att.name}</p>
                            <p className="text-xs text-gray-400 capitalize">{att.category.replace(/_/g, " ")}</p>
                          </div>
                          <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                            {formatCurrency(att.retailPrice)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Machine selection list (when no machine chosen yet) */}
              {!selectedMachine && (
                <>
                  {catalogLoading ? (
                    <div className="flex flex-col items-center gap-3 pt-8">
                      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-400">Loading inventory...</p>
                    </div>
                  ) : (
                    <>
                      {/* Filters */}
                      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                        <FilterChip
                          label="All types"
                          active={categoryFilter === "all"}
                          onClick={() => setCategoryFilter("all")}
                        />
                        {uniqueCategories.map((cat) => (
                          <FilterChip
                            key={cat}
                            label={CATEGORY_LABELS[cat] ?? cat}
                            active={categoryFilter === cat}
                            onClick={() => setCategoryFilter(cat)}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <FilterChip label="All" active={conditionFilter === "all"} onClick={() => setConditionFilter("all")} />
                        <FilterChip label="New" active={conditionFilter === "new"} onClick={() => setConditionFilter("new")} />
                        <FilterChip label="Used" active={conditionFilter === "used"} onClick={() => setConditionFilter("used")} />
                      </div>

                      <div className="space-y-2">
                        {filteredMachines.length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-6">
                            No machines match the selected filters.
                          </p>
                        )}
                        {filteredMachines.map((m) => (
                          <MachineCard
                            key={m.stockNumber}
                            machine={m}
                            onSelect={() => setSelectedMachine(m)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Continue to proposal */}
              {selectedMachine && (
                <div className="space-y-3 pt-2">
                  {/* Running total */}
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Machine</span>
                      <span>{formatCurrency(machineTotal)}</span>
                    </div>
                    {selectedAttachmentObjects.map((a) => (
                      <div key={a.id} className="flex justify-between text-sm text-gray-600">
                        <span className="truncate mr-2">{a.name}</span>
                        <span className="flex-shrink-0">{formatCurrency(a.retailPrice)}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-100 pt-1.5 flex justify-between font-semibold text-gray-900">
                      <span>Total</span>
                      <span>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleMachineNext}
                    className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 active:scale-95 transition"
                  >
                    Review proposal
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review + send ──────────────────────────────────── */}
          {step === "review" && selectedMachine && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep("machine")}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" /> Back
                </button>
                <h2 className="text-base font-semibold text-gray-900 flex-1">Proposal preview</h2>
              </div>

              {/* Customer */}
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                <div className="px-4 py-2.5 flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</span>
                  <button onClick={() => setStep("customer")} className="text-xs text-blue-500 hover:underline">Edit</button>
                </div>
                <div className="px-4 py-3 space-y-0.5">
                  <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
                  <p className="text-sm text-gray-600">{customer.company}</p>
                  <p className="text-xs text-gray-400">{customer.phone} · {customer.email}</p>
                </div>
              </div>

              {/* Equipment */}
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                <div className="px-4 py-2.5 flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Equipment</span>
                  <button onClick={() => setStep("machine")} className="text-xs text-blue-500 hover:underline">Edit</button>
                </div>
                <div className="px-4 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {selectedMachine.year} {selectedMachine.make} {selectedMachine.model}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {CATEGORY_LABELS[selectedMachine.category]} ·{" "}
                        {selectedMachine.condition === "new"
                          ? "New"
                          : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}
                      </p>
                      {selectedMachine.stockNumber && (
                        <p className="text-xs text-gray-400">Stock #{selectedMachine.stockNumber}</p>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 flex-shrink-0 ml-3">
                      {formatCurrency(selectedMachine.retailPrice)}
                    </span>
                  </div>
                </div>
                {selectedAttachmentObjects.map((a) => (
                  <div key={a.id} className="px-4 py-3 flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-800">{a.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{a.category.replace(/_/g, " ")}</p>
                    </div>
                    <span className="text-sm text-gray-700 flex-shrink-0 ml-3">
                      {formatCurrency(a.retailPrice)}
                    </span>
                  </div>
                ))}
                <div className="px-4 py-3 flex justify-between font-semibold text-gray-900">
                  <span>Total</span>
                  <span>{formatCurrency(grandTotal)}</span>
                </div>
              </div>

              {/* Specs */}
              {selectedMachine.specs.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                  <div className="px-4 py-2.5">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Key specs</span>
                  </div>
                  {selectedMachine.specs.map((s) => (
                    <div key={s.label} className="px-4 py-2.5 flex justify-between text-sm">
                      <span className="text-gray-500">{s.label}</span>
                      <span className="text-gray-900 font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Trade-in discussed, delivery to Lake City, financing options..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Quote validity */}
              <p className="text-xs text-gray-400 text-center">
                Pricing valid through {addDays(30)}
              </p>

              {/* Actions */}
              <div className="space-y-2 pb-6">
                <button
                  onClick={handlePrint}
                  className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 active:scale-95 transition flex items-center justify-center gap-2"
                >
                  <PrintIcon className="w-4 h-4" />
                  Save / Print proposal
                </button>
                <button
                  onClick={handleNewQuote}
                  className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
                >
                  Start new quote
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

// ── Print-only proposal ─────────────────────────────────────────────────────────

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

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #qep-proposal, #qep-proposal * { visibility: visible; }
          #qep-proposal { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
      <div id="qep-proposal" className="hidden print:block p-8 max-w-2xl mx-auto font-sans text-gray-900">
        {/* Letterhead */}
        <div className="flex items-start justify-between border-b-2 border-green-600 pb-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-green-700">Quality Equipment &amp; Parts, Inc.</h1>
            <p className="text-sm text-gray-500 mt-0.5">Lake City, FL · qep.blackrockai.co</p>
          </div>
          <div className="text-right text-sm text-gray-500">
            <p className="font-semibold text-gray-800">{repName}</p>
            <p>{repEmail}</p>
            <p>{today}</p>
          </div>
        </div>

        {/* Quote header */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Equipment Quote</h2>
          <div className="text-sm text-gray-600 space-y-0.5">
            <p><span className="font-medium">Customer:</span> {customer.name}</p>
            <p><span className="font-medium">Company:</span> {customer.company}</p>
            <p><span className="font-medium">Phone:</span> {customer.phone}</p>
            <p><span className="font-medium">Email:</span> {customer.email}</p>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left px-3 py-2 font-semibold text-gray-700 border border-gray-200">Description</th>
              <th className="text-right px-3 py-2 font-semibold text-gray-700 border border-gray-200 whitespace-nowrap">Unit Price</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2 border border-gray-200">
                <p className="font-medium">
                  {selectedMachine.year} {selectedMachine.make} {selectedMachine.model}
                </p>
                <p className="text-gray-500 text-xs">
                  {CATEGORY_LABELS[selectedMachine.category]} ·{" "}
                  {selectedMachine.condition === "new"
                    ? "New"
                    : `Used — ${selectedMachine.hoursOrMiles?.toLocaleString()} hrs`}
                  {selectedMachine.stockNumber ? ` · Stock #${selectedMachine.stockNumber}` : ""}
                </p>
              </td>
              <td className="px-3 py-2 border border-gray-200 text-right font-medium">
                {formatCurrency(machinePrice)}
              </td>
            </tr>
            {selectedAttachments.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 border border-gray-200">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-gray-500 text-xs capitalize">{a.category.replace(/_/g, " ")}</p>
                </td>
                <td className="px-3 py-2 border border-gray-200 text-right font-medium">
                  {formatCurrency(a.retailPrice)}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className="px-3 py-2 border border-gray-200 font-bold text-right">Total</td>
              <td className="px-3 py-2 border border-gray-200 text-right font-bold text-green-700 text-base">
                {formatCurrency(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Key specs */}
        {selectedMachine.specs.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Key Specifications</h3>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {selectedMachine.specs.map((s) => (
                  <tr key={s.label}>
                    <td className="px-3 py-1.5 border border-gray-200 text-gray-500 w-1/2">{s.label}</td>
                    <td className="px-3 py-1.5 border border-gray-200 font-medium">{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Notes */}
        {notes.trim() && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Notes</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap border border-gray-200 rounded p-3">{notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 text-xs text-gray-400 space-y-1">
          <p>Pricing valid for 30 days from {today}. Quote subject to final inventory confirmation.</p>
          <p>Financing options available. Contact your QEP sales representative for details.</p>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition ${
        done
          ? "bg-green-500 text-white"
          : active
          ? "bg-green-600 text-white"
          : "bg-gray-200 text-gray-400"
      }`}>
        {done ? <CheckSmallIcon className="w-3.5 h-3.5" /> : null}
      </div>
      <span className={`text-xs whitespace-nowrap ${active ? "text-gray-800 font-medium" : "text-gray-400"}`}>
        {label}
      </span>
    </div>
  );
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
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition ${
          error
            ? "border-red-400 focus:ring-red-400"
            : "border-gray-300 focus:ring-green-500 focus:border-transparent"
        }`}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
        active
          ? "bg-green-600 text-white"
          : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

function MachineCard({ machine, onSelect }: { machine: Machine; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-left hover:border-green-400 hover:shadow-sm active:scale-[0.99] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {machine.year} {machine.make} {machine.model}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {CATEGORY_LABELS[machine.category]} ·{" "}
            {machine.condition === "new"
              ? "New"
              : `Used — ${machine.hoursOrMiles?.toLocaleString()} hrs`}
            {" "}· Stock #{machine.stockNumber}
          </p>
          {machine.specs.slice(0, 2).map((s) => (
            <p key={s.label} className="text-xs text-gray-400">
              {s.label}: {s.value}
            </p>
          ))}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold text-gray-900">{formatCurrency(machine.retailPrice)}</p>
          <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
            machine.condition === "new"
              ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {machine.condition === "new" ? "New" : "Used"}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Inline SVG icons ────────────────────────────────────────────────────────────

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="13" x2="8" y2="13" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" strokeLinecap="round" />
      <polyline points="10 9 9 9 8 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrintIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 6 2 18 2 18 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="6" y="14" width="12" height="8" rx="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
