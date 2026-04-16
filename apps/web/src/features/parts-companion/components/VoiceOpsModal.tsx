import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, X, Volume2, VolumeX, Sparkles, Wrench, Search, ShoppingCart, History, Zap } from "lucide-react";
import { submitVoiceCommand, type VoiceOpsContext, type VoiceOpsResult } from "../lib/voice-ops-api";

// ── Web Speech API compat shim ──────────────────────────────

type SpeechRecognitionCompat = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventCompat) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

interface SpeechRecognitionEventCompat {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
  resultIndex: number;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionCompat;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionCtor | null;
}

// ── Tokens (match companion aesthetic) ──────────────────────

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
  warning: "#F59E0B",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
  magenta: "#c026d3",
} as const;

// ── Types ──────────────────────────────────────────────────

type TurnKind = "rep" | "assistant" | "error" | "thinking";

interface Turn {
  id: string;
  kind: TurnKind;
  text: string;
  intent?: string;
  tool_calls?: Array<{ name: string; input: Record<string, unknown>; result: unknown }>;
  elapsed_ms?: number;
  timestamp: number;
}

// ── Component ──────────────────────────────────────────────

export function VoiceOpsModal({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context?: VoiceOpsContext;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null);
  const lastContextRef = useRef<VoiceOpsContext | undefined>(context);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lastContextRef.current = context;
  }, [context]);

  useEffect(() => {
    if (!open) return;
    const ctor = getRecognitionCtor();
    if (!ctor) {
      setRecognitionSupported(false);
      return;
    }
    const recognition = new ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* no-op */
      }
      recognitionRef.current = null;
    };
  }, [open]);

  // Auto-scroll thread on new turn
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [turns.length]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitTranscript = useCallback(async (transcript: string, confidence?: number) => {
    const repTurn: Turn = {
      id: `rep-${Date.now()}`,
      kind: "rep",
      text: transcript,
      timestamp: Date.now(),
    };
    const thinking: Turn = {
      id: `think-${Date.now()}`,
      kind: "thinking",
      text: "🧠 Thinking…",
      timestamp: Date.now(),
    };
    setTurns((prev) => [...prev, repTurn, thinking]);

    try {
      const res = await submitVoiceCommand({
        transcript,
        confidence,
        context: lastContextRef.current,
      });
      setTurns((prev) =>
        prev
          .filter((t) => t.id !== thinking.id)
          .concat([
            {
              id: `asst-${Date.now()}`,
              kind: "assistant",
              text: res.spoken_text || "(no response)",
              intent: res.intent,
              tool_calls: res.tool_calls,
              elapsed_ms: res.elapsed_ms,
              timestamp: Date.now(),
            },
          ]),
      );
      if (ttsEnabled && res.spoken_text) speakText(res.spoken_text);
    } catch (err) {
      setTurns((prev) =>
        prev
          .filter((t) => t.id !== thinking.id)
          .concat([
            {
              id: `err-${Date.now()}`,
              kind: "error",
              text: (err as Error).message,
              timestamp: Date.now(),
            },
          ]),
      );
    }
  }, [ttsEnabled]);

  const startListening = useCallback(() => {
    setError(null);
    setInterim("");
    const rec = recognitionRef.current;
    if (!rec) {
      setRecognitionSupported(false);
      return;
    }
    let finalTranscript = "";
    let finalConfidence = 0;
    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const alt = result[0];
        if (result.isFinal) {
          finalTranscript += alt.transcript;
          finalConfidence = Math.max(finalConfidence, alt.confidence ?? 0);
        } else {
          interimText += alt.transcript;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (ev) => {
      setError(`Mic error: ${ev.error}`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const trimmed = finalTranscript.trim();
      if (trimmed.length > 0) {
        void submitTranscript(trimmed, finalConfidence);
      }
    };
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(`Could not start mic: ${(e as Error).message}`);
    }
  }, [submitTranscript]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* no-op */
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full max-w-2xl flex flex-col"
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          maxHeight: "85vh",
          boxShadow: "0 24px 56px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: `1px solid ${T.borderSoft}` }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(192,38,211,0.3) 0%, rgba(168,85,247,0.3) 100%)",
              boxShadow: "0 0 24px rgba(192,38,211,0.4)",
            }}
          >
            <Mic size={18} color="#fff" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg leading-tight">Voice Counter Ops</div>
            <div className="text-xs" style={{ color: T.textMuted }}>
              Claude + your live parts catalog · "price on 129150" · "add 10 oil filters"
            </div>
          </div>
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              background: ttsEnabled ? T.purpleBg : T.bgElevated,
              color: ttsEnabled ? T.purple : T.textMuted,
              border: `1px solid ${ttsEnabled ? T.purple : T.border}`,
            }}
            title={ttsEnabled ? "Spoken replies on" : "Spoken replies off"}
          >
            {ttsEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
          >
            <X size={14} />
          </button>
        </header>

        {/* Thread */}
        <div
          ref={threadRef}
          className="flex-1 overflow-auto px-5 py-4 space-y-3"
          style={{ minHeight: 280 }}
        >
          {turns.length === 0 && (
            <EmptyState recognitionSupported={recognitionSupported} />
          )}
          {turns.map((turn) => (
            <TurnRow key={turn.id} turn={turn} />
          ))}
          {interim && (
            <div
              className="rounded-xl px-3 py-2 self-end inline-block"
              style={{
                background: T.orangeGlow,
                border: `1px dashed ${T.orange}`,
                color: T.text,
                opacity: 0.7,
              }}
            >
              <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: T.orange }}>
                listening
              </div>
              <div className="text-sm font-medium">{interim}…</div>
            </div>
          )}
        </div>

        {/* Footer — mic button */}
        <footer
          className="px-5 py-5 flex items-center gap-4"
          style={{ borderTop: `1px solid ${T.borderSoft}` }}
        >
          {!recognitionSupported ? (
            <div
              className="flex-1 text-sm p-3 rounded-lg"
              style={{ background: T.dangerBg, color: T.danger, border: `1px solid ${T.danger}` }}
            >
              Your browser doesn't support voice recognition. Use Chrome/Safari/Edge on desktop.
            </div>
          ) : (
            <>
              <button
                onMouseDown={startListening}
                onMouseUp={stopListening}
                onMouseLeave={stopListening}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startListening();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopListening();
                }}
                disabled={!recognitionSupported}
                className="relative w-20 h-20 rounded-full flex items-center justify-center transition-transform"
                style={{
                  background: listening
                    ? "linear-gradient(135deg, #c026d3 0%, #9333ea 100%)"
                    : "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                  boxShadow: listening
                    ? "0 0 0 12px rgba(192,38,211,0.15), 0 0 40px rgba(192,38,211,0.5)"
                    : "0 8px 20px rgba(192,38,211,0.35)",
                  transform: listening ? "scale(1.08)" : "scale(1)",
                }}
                title="Press and hold to talk"
              >
                {listening ? <Mic size={28} color="#fff" /> : <MicOff size={28} color="#fff" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {listening ? "🎤 Listening — speak now" : "Press and hold to talk"}
                </div>
                <div className="text-xs" style={{ color: T.textDim }}>
                  {listening
                    ? "Release when you're done"
                    : "Tip: short + specific. 'Price on 129150.' or 'Add 10 hydraulic filters.'"}
                </div>
                {error && (
                  <div className="text-xs mt-1" style={{ color: T.danger }}>
                    {error}
                  </div>
                )}
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

// ── Empty state + turn row ─────────────────────────────────

function EmptyState({ recognitionSupported }: { recognitionSupported: boolean }) {
  if (!recognitionSupported) return null;
  return (
    <div className="py-8 text-center">
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
        style={{
          background: "linear-gradient(135deg, rgba(192,38,211,0.18) 0%, rgba(168,85,247,0.18) 100%)",
        }}
      >
        <Sparkles size={24} color={T.magenta} />
      </div>
      <div className="font-semibold text-base mb-2">Hold the mic and talk like you would to a counter partner.</div>
      <div className="text-xs max-w-sm mx-auto mb-4" style={{ color: T.textMuted }}>
        Claude understands phrases. It looks up real parts, checks your stock, and can drop drafts into the replenish queue.
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          { icon: Search, label: "Price on 129150" },
          { icon: Wrench, label: "Stock on BK-HYD-4951" },
          { icon: ShoppingCart, label: "Add 10 Yanmar oil filters" },
          { icon: History, label: "Who ordered this last?" },
        ].map((ex) => (
          <span
            key={ex.label}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
            style={{
              background: T.bgElevated,
              border: `1px solid ${T.border}`,
              color: T.textMuted,
            }}
          >
            <ex.icon size={11} />
            {ex.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.kind === "rep") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-md rounded-2xl px-4 py-2.5"
          style={{
            background: T.orange,
            color: "#fff",
            borderBottomRightRadius: 4,
          }}
        >
          <div className="text-sm">{turn.text}</div>
        </div>
      </div>
    );
  }
  if (turn.kind === "thinking") {
    return (
      <div className="flex justify-start">
        <div
          className="rounded-2xl px-4 py-2.5 inline-flex items-center gap-2"
          style={{
            background: T.bgElevated,
            color: T.textMuted,
            border: `1px solid ${T.borderSoft}`,
            borderBottomLeftRadius: 4,
          }}
        >
          <Sparkles size={13} className="animate-pulse" color={T.magenta} />
          <span className="text-sm">Thinking…</span>
        </div>
      </div>
    );
  }
  if (turn.kind === "error") {
    return (
      <div className="flex justify-start">
        <div
          className="max-w-md rounded-2xl px-4 py-2.5"
          style={{
            background: T.dangerBg,
            color: T.danger,
            border: `1px solid ${T.danger}`,
          }}
        >
          <div className="text-sm font-mono">{turn.text}</div>
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-md">
        <div
          className="rounded-2xl px-4 py-2.5 mb-1"
          style={{
            background: T.bgElevated,
            color: T.text,
            border: `1px solid ${T.borderSoft}`,
            borderBottomLeftRadius: 4,
          }}
        >
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{turn.text}</div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] px-2" style={{ color: T.textDim }}>
          <Sparkles size={9} color={T.magenta} />
          <span className="uppercase tracking-wide font-medium" style={{ color: T.magenta }}>
            Claude
          </span>
          {turn.intent && (
            <>
              <span>·</span>
              <span>{turn.intent}</span>
            </>
          )}
          {turn.elapsed_ms != null && (
            <>
              <span>·</span>
              <span>{(turn.elapsed_ms / 1000).toFixed(1)}s</span>
            </>
          )}
          {turn.tool_calls && turn.tool_calls.length > 0 && (
            <>
              <span>·</span>
              <Zap size={9} />
              <span>
                {turn.tool_calls.map((t) => t.name.replace(/_/g, " ")).join(", ")}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TTS ────────────────────────────────────────────────────

function speakText(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  // Cancel any in-progress utterance first
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.05;
  utter.pitch = 1;
  utter.volume = 1;
  // Prefer a natural-sounding English voice if the browser has one
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => /en-US/.test(v.lang) && /Natural|Google|Samantha|Aaron/i.test(v.name)) ??
                    voices.find((v) => /en-US/.test(v.lang));
  if (preferred) utter.voice = preferred;
  window.speechSynthesis.speak(utter);
}
