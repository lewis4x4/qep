import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Loader2, AlertTriangle } from "lucide-react";
import {
  normalizeVoicePartsOrderResult,
  type VoicePartsOrderResult as VoiceResult,
} from "../lib/parts-row-normalizers";

/* Web Speech API type shim — only available in chromium-based browsers. */
type SpeechRecognitionCompat = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionCompat;

export function VoicePartsOrderButton() {
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionCompat | null>(null);

  const voiceMut = useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await supabase.functions.invoke("voice-to-parts-order", {
        body: { transcript: text, auto_submit: true },
      });
      if (error) throw error;
      return normalizeVoicePartsOrderResult(data);
    },
    onSuccess: (data) => {
      if (data.order_id) {
        navigate(`/parts/orders/${data.order_id}`);
      }
    },
  });

  const hasSpeechRecognition =
    typeof window !== "undefined" &&
    !!(
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!hasSpeechRecognition) {
      setShowPanel(true);
      return;
    }

    const Ctor = (
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    ) as SpeechRecognitionCtor | undefined;
    if (!Ctor) { setShowPanel(true); return; }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setTranscript(finalTranscript);
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
      setShowPanel(true);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setShowPanel(true);
  }, [isRecording, hasSpeechRecognition]);

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const submitVoice = useCallback(() => {
    const text = transcript.trim();
    if (text.length < 5) return;
    voiceMut.mutate(text);
  }, [transcript, voiceMut]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant={isRecording ? "destructive" : "outline"}
        size="sm"
        onClick={toggleRecording}
        aria-pressed={isRecording}
        className="gap-1.5"
      >
        {isRecording ? (
          <>
            <MicOff className="h-3.5 w-3.5" />
            Stop recording
          </>
        ) : (
          <>
            <Mic className="h-3.5 w-3.5" />
            Voice order
          </>
        )}
      </Button>

      {showPanel && (
        <Card className="absolute top-full left-0 mt-2 w-[360px] p-4 space-y-3 z-50 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Voice parts order</h3>
            <button
              type="button"
              aria-label="Close voice order panel"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { setShowPanel(false); setTranscript(""); }}
            >
              ✕
            </button>
          </div>

          {isRecording && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <span className="block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Listening…
            </div>
          )}

          <textarea
            className="w-full h-24 text-sm rounded border border-input bg-background px-2 py-1.5 resize-none"
            placeholder={
              hasSpeechRecognition
                ? 'Say: "I need two left track pads for the Cat 320, machine is down"'
                : "Type your parts request here…"
            }
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />

          {voiceMut.data && (
            <div className="space-y-1.5">
              {voiceMut.data.is_machine_down && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Machine down
                </Badge>
              )}
              <p className="text-xs text-muted-foreground">
                {voiceMut.data.matches.filter((m) => m.matched_part).length} parts matched,{" "}
                {voiceMut.data.matches.filter((m) => !m.matched_part).length} unmatched
              </p>
              {voiceMut.data.auto_submitted && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Auto-submitted (machine-down priority)
                </p>
              )}
            </div>
          )}

          {voiceMut.isError && (
            <p className="text-xs text-destructive">
              {(voiceMut.error as Error)?.message ?? "Voice order failed."}
            </p>
          )}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={voiceMut.isPending || transcript.trim().length < 5}
            onClick={submitVoice}
          >
            {voiceMut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Processing…
              </>
            ) : (
              "Create voice order"
            )}
          </Button>
        </Card>
      )}
    </div>
  );
}

export function VoiceOrderBadge({ orderSource }: { orderSource: string }) {
  if (orderSource === "voice") {
    return (
      <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-400 gap-0.5">
        <Mic className="h-2.5 w-2.5" />
        Voice
      </Badge>
    );
  }
  if (orderSource === "photo") {
    return (
      <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-600 dark:text-blue-400 gap-0.5">
        📷 Photo
      </Badge>
    );
  }
  if (orderSource === "predictive") {
    return (
      <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400 gap-0.5">
        🔮 Predictive
      </Badge>
    );
  }
  if (orderSource === "auto_replenish") {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 gap-0.5">
        ♻ Auto
      </Badge>
    );
  }
  return null;
}

export function MachineDownBadge({ isMachineDown }: { isMachineDown: boolean }) {
  if (!isMachineDown) return null;
  return (
    <Badge variant="destructive" className="text-[10px] gap-0.5">
      <AlertTriangle className="h-2.5 w-2.5" />
      Machine down
    </Badge>
  );
}
