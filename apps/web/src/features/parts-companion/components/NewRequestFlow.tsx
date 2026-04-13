import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { createPartsRequest } from "../lib/companion-api";
import type { RequestSource, RequestPriority } from "../lib/types";

interface NewRequestFlowProps {
  onClose: () => void;
}

interface DraftItem {
  part_number: string;
  description: string;
  quantity: number;
  notes: string;
}

type Step = "source" | "machine" | "parts" | "review";

const SOURCE_OPTIONS: Array<{
  key: RequestSource;
  label: string;
  description: string;
}> = [
  {
    key: "service",
    label: "Service Job",
    description: "Tech needs parts for a machine in the shop",
  },
  {
    key: "customer_phone",
    label: "Customer Phone",
    description: "Customer calling for parts",
  },
  {
    key: "customer_walkin",
    label: "Customer Walk-in",
    description: "Customer at the counter",
  },
  {
    key: "sales",
    label: "Sales Request",
    description: "Sales rep needs parts info for a deal",
  },
  {
    key: "internal",
    label: "Internal",
    description: "Restock, transfer, or housekeeping",
  },
];

const PRIORITY_OPTIONS: Array<{
  key: RequestPriority;
  label: string;
  description: string;
  color: string;
}> = [
  {
    key: "critical",
    label: "Critical",
    description: "Machine on lift, tech waiting",
    color: "#DC2626",
  },
  {
    key: "urgent",
    label: "Urgent",
    description: "Customer waiting (phone/counter)",
    color: "#F59E0B",
  },
  {
    key: "normal",
    label: "Normal",
    description: "Standard request",
    color: "#3182CE",
  },
  {
    key: "low",
    label: "Low",
    description: "Restock, non-urgent",
    color: "#718096",
  },
];

export function NewRequestFlow({ onClose }: NewRequestFlowProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<RequestSource | null>(null);
  const [priority, setPriority] = useState<RequestPriority>("normal");
  const [machineDescription, setMachineDescription] = useState("");
  const [bayNumber, setBayNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [newPartNumber, setNewPartNumber] = useState("");
  const [newPartDesc, setNewPartDesc] = useState("");
  const [newPartQty, setNewPartQty] = useState(1);

  const createMutation = useMutation({
    mutationFn: () =>
      createPartsRequest({
        request_source: source!,
        priority,
        machine_description: machineDescription || undefined,
        bay_number: bayNumber || undefined,
        customer_name: customerName || undefined,
        notes: notes || undefined,
        items: items.map((it) => ({
          part_number: it.part_number,
          description: it.description || undefined,
          quantity: it.quantity,
          notes: it.notes || undefined,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts-queue"] });
      onClose();
    },
  });

  const addItem = () => {
    if (!newPartNumber.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        part_number: newPartNumber.trim(),
        description: newPartDesc.trim(),
        quantity: newPartQty,
        notes: "",
      },
    ]);
    setNewPartNumber("");
    setNewPartDesc("");
    setNewPartQty(1);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const canProceed = () => {
    switch (step) {
      case "source":
        return !!source;
      case "machine":
        return true; // Machine is optional
      case "parts":
        return items.length > 0;
      case "review":
        return true;
    }
  };

  const nextStep = () => {
    const steps: Step[] = ["source", "machine", "parts", "review"];
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const prevStep = () => {
    const steps: Step[] = ["source", "machine", "parts", "review"];
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
          <div>
            <h2 className="text-lg font-bold text-[#2D3748]">New Request</h2>
            <div className="flex items-center gap-1 mt-1">
              {(["source", "machine", "parts", "review"] as Step[]).map(
                (s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        background:
                          s === step
                            ? "#E87722"
                            : (["source", "machine", "parts", "review"] as Step[]).indexOf(s) <
                                (["source", "machine", "parts", "review"] as Step[]).indexOf(step)
                              ? "#38A169"
                              : "#E2E8F0",
                      }}
                    />
                    {i < 3 && (
                      <div className="w-4 h-px bg-[#E2E8F0]" />
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded border-none bg-transparent cursor-pointer hover:bg-[#F3F4F6]"
          >
            <X size={20} className="text-[#718096]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-5">
          {/* Step 1: Source + Priority */}
          {step === "source" && (
            <div>
              <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                Request Source
              </h3>
              <div className="flex flex-col gap-2 mb-6">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSource(opt.key)}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer text-left transition-all duration-150"
                    style={{
                      borderColor:
                        source === opt.key ? "#E87722" : "#E2E8F0",
                      background:
                        source === opt.key ? "#FFF3E8" : "white",
                    }}
                  >
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-[#2D3748]">
                        {opt.label}
                      </div>
                      <div className="text-[11px] text-[#718096]">
                        {opt.description}
                      </div>
                    </div>
                    {source === opt.key && (
                      <div className="w-5 h-5 rounded-full bg-qep-orange flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                Priority
              </h3>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setPriority(opt.key)}
                    className="flex-1 p-2.5 rounded-lg border cursor-pointer text-center transition-all duration-150"
                    style={{
                      borderColor:
                        priority === opt.key ? opt.color : "#E2E8F0",
                      background:
                        priority === opt.key ? `${opt.color}10` : "white",
                    }}
                  >
                    <div
                      className="text-[13px] font-bold"
                      style={{ color: opt.color }}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-[#718096] mt-0.5">
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Machine */}
          {step === "machine" && (
            <div>
              <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                Machine (optional)
              </h3>
              <input
                value={machineDescription}
                onChange={(e) => setMachineDescription(e.target.value)}
                placeholder="e.g., 2019 Barko 495ML, S/N BMT-4217"
                className="w-full p-3 rounded-lg border border-[#E2E8F0] text-sm outline-none mb-4 focus:border-qep-orange"
              />

              {source === "service" && (
                <>
                  <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                    Bay Number
                  </h3>
                  <input
                    value={bayNumber}
                    onChange={(e) => setBayNumber(e.target.value)}
                    placeholder="e.g., Bay 3"
                    className="w-full p-3 rounded-lg border border-[#E2E8F0] text-sm outline-none mb-4 focus:border-qep-orange"
                  />
                </>
              )}

              {(source === "customer_phone" ||
                source === "customer_walkin") && (
                <>
                  <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                    Customer Name
                  </h3>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g., Jake Thompson, Thompson Logging"
                    className="w-full p-3 rounded-lg border border-[#E2E8F0] text-sm outline-none focus:border-qep-orange"
                  />
                </>
              )}
            </div>
          )}

          {/* Step 3: Parts */}
          {step === "parts" && (
            <div>
              <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                Parts Needed
              </h3>

              {/* Existing items */}
              {items.length > 0 && (
                <div className="flex flex-col gap-2 mb-4">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]"
                    >
                      <div className="flex-1">
                        <span className="font-mono font-semibold text-[13px] text-[#2D3748]">
                          {item.part_number}
                        </span>
                        {item.description && (
                          <span className="text-xs text-[#718096] ml-2">
                            {item.description}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[#718096]">
                        x{item.quantity}
                      </span>
                      <button
                        onClick={() => removeItem(i)}
                        className="p-1 rounded border-none bg-transparent cursor-pointer hover:bg-red-50"
                      >
                        <Trash2 size={14} className="text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new item */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider block mb-1">
                    Part Number
                  </label>
                  <input
                    value={newPartNumber}
                    onChange={(e) => setNewPartNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addItem();
                    }}
                    placeholder="BK-495-HF-024"
                    className="w-full p-2.5 rounded-lg border border-[#E2E8F0] text-sm font-mono outline-none focus:border-qep-orange"
                  />
                </div>
                <div className="w-20">
                  <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider block mb-1">
                    Qty
                  </label>
                  <input
                    type="number"
                    value={newPartQty}
                    onChange={(e) =>
                      setNewPartQty(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    min={1}
                    className="w-full p-2.5 rounded-lg border border-[#E2E8F0] text-sm outline-none text-center focus:border-qep-orange"
                  />
                </div>
                <button
                  onClick={addItem}
                  disabled={!newPartNumber.trim()}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-lg border-none bg-qep-orange text-white text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#D06A1E]"
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className="mt-2">
                <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider block mb-1">
                  Description (optional)
                </label>
                <input
                  value={newPartDesc}
                  onChange={(e) => setNewPartDesc(e.target.value)}
                  placeholder="Hydraulic Return Filter"
                  className="w-full p-2.5 rounded-lg border border-[#E2E8F0] text-sm outline-none focus:border-qep-orange"
                />
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === "review" && (
            <div>
              <h3 className="text-sm font-bold text-[#2D3748] mb-3">
                Review Request
              </h3>
              <div className="flex flex-col gap-3">
                <div className="p-3 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]">
                  <div className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider mb-1">
                    Source
                  </div>
                  <div className="text-sm text-[#2D3748] capitalize">
                    {source?.replace("_", " ")}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]">
                  <div className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider mb-1">
                    Priority
                  </div>
                  <div className="text-sm text-[#2D3748] capitalize">
                    {priority}
                  </div>
                </div>
                {machineDescription && (
                  <div className="p-3 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]">
                    <div className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider mb-1">
                      Machine
                    </div>
                    <div className="text-sm text-[#2D3748]">
                      {machineDescription}
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-[#F7F8FA] border border-[#E2E8F0]">
                  <div className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider mb-1">
                    Parts ({items.length})
                  </div>
                  {items.map((it, i) => (
                    <div
                      key={i}
                      className="text-sm text-[#2D3748] font-mono"
                    >
                      {it.part_number} x{it.quantity}
                      {it.description ? ` — ${it.description}` : ""}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wider block mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional context..."
                  rows={3}
                  className="w-full p-3 rounded-lg border border-[#E2E8F0] text-sm outline-none resize-none focus:border-qep-orange"
                />
              </div>

              {createMutation.isError && (
                <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  Failed to create request.{" "}
                  {(createMutation.error as Error).message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E2E8F0]">
          <button
            onClick={step === "source" ? onClose : prevStep}
            className="px-4 py-2 rounded-lg border border-[#E2E8F0] bg-white text-sm font-semibold text-[#4A5568] cursor-pointer hover:bg-[#F7F8FA]"
          >
            {step === "source" ? "Cancel" : "← Back"}
          </button>

          {step === "review" ? (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-6 py-2 rounded-lg border-none bg-qep-orange text-white text-sm font-bold cursor-pointer disabled:opacity-60 hover:bg-[#D06A1E]"
            >
              {createMutation.isPending ? "Creating..." : "Submit Request"}
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="flex items-center gap-1 px-4 py-2 rounded-lg border-none bg-qep-orange text-white text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#D06A1E]"
            >
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
