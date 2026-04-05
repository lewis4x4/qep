import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface Props {
  jobId: string;
  machineId: string | null;
}

/**
 * Capture technician field notes (typed or browser speech) into machine_knowledge_notes.
 * Optional Whisper path: upload audio to Supabase Storage (presigned) and call
 * service-knowledge-capture with transcribed text when OPENAI_API_KEY + storage are configured.
 */
export function VoiceFieldNotes({ jobId, machineId }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (!text.trim()) throw new Error("Enter a note");
      const { error } = await supabase.functions.invoke("service-knowledge-capture", {
        body: {
          job_id: jobId,
          equipment_id: machineId ?? undefined,
          note_type: "voice",
          content: text.trim(),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
    },
  });

  const startSpeech = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        onresult: ((ev: unknown) => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        onresult: ((ev: unknown) => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    setListening(true);
    const rec = new SR();
    rec.lang = "en-US";
    rec.onresult = (ev: unknown) => {
      const results = (ev as { results: ArrayLike<{ 0: { transcript: string } }> }).results;
      const t = Array.from(results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ");
      setText((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Field note / voice</h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type or use speech…"
        className="w-full rounded border px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={startSpeech}
          disabled={listening}
          className="text-xs px-2 py-1 rounded bg-secondary"
        >
          {listening ? "Listening…" : "Speak"}
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
        >
          Save to knowledge
        </button>
      </div>
      {save.isError && (
        <p className="text-xs text-destructive">{(save.error as Error).message}</p>
      )}
    </div>
  );
}
