import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ChevronRight, Plus, Trash2 } from "lucide-react";
import { createPartsRequest } from "../lib/companion-api";
import type { RequestSource, RequestPriority } from "../lib/types";

/* ── Design tokens ─────────────────────────────────────────────── */
const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
} as const;

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
const STEPS: Step[] = ["source", "machine", "parts", "review"];

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
    color: "#EF4444",
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
    color: "#3B82F6",
  },
  {
    key: "low",
    label: "Low",
    description: "Restock, non-urgent",
    color: "#5F7391",
  },
];

/* Shared input style helper */
const inputStyle: React.CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

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
        return true;
      case "parts":
        return items.length > 0;
      case "review":
        return true;
    }
  };

  const nextStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const prevStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const stepIdx = STEPS.indexOf(step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden rounded-2xl"
        style={{
          background: T.bgElevated,
          border: `1px solid ${T.border}`,
          boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${T.border}` }}
        >
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: T.text, margin: 0 }}
            >
              New Request
            </h2>
            <div className="flex items-center gap-1 mt-1.5">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full transition-colors duration-200"
                    style={{
                      background:
                        i < stepIdx
                          ? T.success
                          : s === step
                            ? T.orange
                            : T.borderSoft,
                    }}
                  />
                  {i < STEPS.length - 1 && (
                    <div
                      className="w-5 h-px"
                      style={{ background: T.borderSoft }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border-none cursor-pointer transition-colors duration-150"
            style={{ background: "transparent", color: T.textMuted }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.card)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto px-6 py-5">
          {/* Step 1: Source + Priority */}
          {step === "source" && (
            <div>
              <h3
                className="text-sm font-bold mb-3"
                style={{ color: T.text }}
              >
                Request Source
              </h3>
              <div className="flex flex-col gap-2 mb-6">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSource(opt.key)}
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer text-left transition-all duration-150"
                    style={{
                      border: `1px solid ${source === opt.key ? T.orange : T.border}`,
                      background:
                        source === opt.key ? T.orangeGlow : T.card,
                    }}
                  >
                    <div className="flex-1">
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: T.text }}
                      >
                        {opt.label}
                      </div>
                      <div
                        className="text-[11px]"
                        style={{ color: T.textMuted }}
                      >
                        {opt.description}
                      </div>
                    </div>
                    {source === opt.key && (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: T.orange }}
                      >
                        <div className="w-2 h-2 rounded-full bg-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <h3
                className="text-sm font-bold mb-3"
                style={{ color: T.text }}
              >
                Priority
              </h3>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setPriority(opt.key)}
                    className="flex-1 p-2.5 rounded-lg cursor-pointer text-center transition-all duration-150"
                    style={{
                      border: `1px solid ${priority === opt.key ? opt.color : T.border}`,
                      background:
                        priority === opt.key
                          ? `${opt.color}18`
                          : T.card,
                    }}
                  >
                    <div
                      className="text-[13px] font-bold"
                      style={{ color: opt.color }}
                    >
                      {opt.label}
                    </div>
                    <div
                      className="text-[10px] mt-0.5"
                      style={{ color: T.textMuted }}
                    >
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
              <h3
                className="text-sm font-bold mb-3"
                style={{ color: T.text }}
              >
                Machine (optional)
              </h3>
              <input
                value={machineDescription}
                onChange={(e) => setMachineDescription(e.target.value)}
                placeholder="e.g., 2019 Barko 495ML, S/N BMT-4217"
                style={{
                  ...inputStyle,
                  marginBottom: 16,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
              />

              {source === "service" && (
                <>
                  <h3
                    className="text-sm font-bold mb-3"
                    style={{ color: T.text }}
                  >
                    Bay Number
                  </h3>
                  <input
                    value={bayNumber}
                    onChange={(e) => setBayNumber(e.target.value)}
                    placeholder="e.g., Bay 3"
                    style={{
                      ...inputStyle,
                      marginBottom: 16,
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                  />
                </>
              )}

              {(source === "customer_phone" ||
                source === "customer_walkin") && (
                <>
                  <h3
                    className="text-sm font-bold mb-3"
                    style={{ color: T.text }}
                  >
                    Customer Name
                  </h3>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g., Jake Thompson, Thompson Logging"
                    style={inputStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                  />
                </>
              )}
            </div>
          )}

          {/* Step 3: Parts */}
          {step === "parts" && (
            <div>
              <h3
                className="text-sm font-bold mb-3"
                style={{ color: T.text }}
              >
                Parts Needed
              </h3>

              {/* Existing items */}
              {items.length > 0 && (
                <div className="flex flex-col gap-2 mb-4">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-lg"
                      style={{
                        background: T.bg,
                        border: `1px solid ${T.borderSoft}`,
                      }}
                    >
                      <div className="flex-1">
                        <span
                          className="font-mono font-semibold text-[13px]"
                          style={{ color: T.text }}
                        >
                          {item.part_number}
                        </span>
                        {item.description && (
                          <span
                            className="text-xs ml-2"
                            style={{ color: T.textMuted }}
                          >
                            {item.description}
                          </span>
                        )}
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: T.textMuted }}
                      >
                        x{item.quantity}
                      </span>
                      <button
                        onClick={() => removeItem(i)}
                        className="p-1 rounded border-none bg-transparent cursor-pointer transition-colors duration-150"
                        style={{ color: T.danger }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "rgba(239,68,68,0.12)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new item */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
                    style={{ color: T.textMuted }}
                  >
                    Part Number
                  </label>
                  <input
                    value={newPartNumber}
                    onChange={(e) => setNewPartNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addItem();
                    }}
                    placeholder="BK-495-HF-024"
                    style={{
                      ...inputStyle,
                      fontFamily: "monospace",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                  />
                </div>
                <div style={{ width: 80 }}>
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
                    style={{ color: T.textMuted }}
                  >
                    Qty
                  </label>
                  <input
                    type="number"
                    value={newPartQty}
                    onChange={(e) =>
                      setNewPartQty(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    min={1}
                    style={{
                      ...inputStyle,
                      textAlign: "center",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                  />
                </div>
                <button
                  onClick={addItem}
                  disabled={!newPartNumber.trim()}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-lg border-none text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                  style={{
                    background: T.orange,
                    color: "#fff",
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              <div className="mt-3">
                <label
                  className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
                  style={{ color: T.textMuted }}
                >
                  Description (optional)
                </label>
                <input
                  value={newPartDesc}
                  onChange={(e) => setNewPartDesc(e.target.value)}
                  placeholder="Hydraulic Return Filter"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                />
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === "review" && (
            <div>
              <h3
                className="text-sm font-bold mb-3"
                style={{ color: T.text }}
              >
                Review Request
              </h3>
              <div className="flex flex-col gap-3">
                <div
                  className="p-3 rounded-lg"
                  style={{
                    background: T.bg,
                    border: `1px solid ${T.borderSoft}`,
                  }}
                >
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: T.textMuted }}
                  >
                    Source
                  </div>
                  <div
                    className="text-sm capitalize"
                    style={{ color: T.text }}
                  >
                    {source?.replace("_", " ")}
                  </div>
                </div>
                <div
                  className="p-3 rounded-lg"
                  style={{
                    background: T.bg,
                    border: `1px solid ${T.borderSoft}`,
                  }}
                >
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: T.textMuted }}
                  >
                    Priority
                  </div>
                  <div
                    className="text-sm capitalize"
                    style={{ color: T.text }}
                  >
                    {priority}
                  </div>
                </div>
                {machineDescription && (
                  <div
                    className="p-3 rounded-lg"
                    style={{
                      background: T.bg,
                      border: `1px solid ${T.borderSoft}`,
                    }}
                  >
                    <div
                      className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                      style={{ color: T.textMuted }}
                    >
                      Machine
                    </div>
                    <div
                      className="text-sm"
                      style={{ color: T.text }}
                    >
                      {machineDescription}
                    </div>
                  </div>
                )}
                <div
                  className="p-3 rounded-lg"
                  style={{
                    background: T.bg,
                    border: `1px solid ${T.borderSoft}`,
                  }}
                >
                  <div
                    className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: T.textMuted }}
                  >
                    Parts ({items.length})
                  </div>
                  {items.map((it, i) => (
                    <div
                      key={i}
                      className="text-sm font-mono"
                      style={{ color: T.text }}
                    >
                      {it.part_number} x{it.quantity}
                      {it.description ? ` — ${it.description}` : ""}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <label
                  className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
                  style={{ color: T.textMuted }}
                >
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional context..."
                  rows={3}
                  style={{
                    ...inputStyle,
                    resize: "none",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = T.orange)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
                />
              </div>

              {createMutation.isError && (
                <div
                  className="mt-3 p-3 rounded-lg text-sm"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: T.danger,
                  }}
                >
                  Failed to create request.{" "}
                  {(createMutation.error as Error).message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: `1px solid ${T.border}` }}
        >
          <button
            onClick={step === "source" ? onClose : prevStep}
            className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors duration-150"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              color: T.textMuted,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.cardHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = T.card)}
          >
            {step === "source" ? "Cancel" : "\u2190 Back"}
          </button>

          {step === "review" ? (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-6 py-2 rounded-lg border-none text-sm font-bold cursor-pointer disabled:opacity-60 transition-colors duration-150"
              style={{
                background: T.orange,
                color: "#fff",
              }}
            >
              {createMutation.isPending ? "Creating..." : "Submit Request"}
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="flex items-center gap-1 px-4 py-2 rounded-lg border-none text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              style={{
                background: T.orange,
                color: "#fff",
              }}
            >
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
