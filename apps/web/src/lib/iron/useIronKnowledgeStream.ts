/**
 * Wave 7.1 Iron Companion — streaming knowledge hook.
 *
 * Talks to the iron-knowledge edge function via raw `fetch()` (NOT
 * `supabase.functions.invoke`, which buffers the entire response).
 * Parses the SSE stream — same `data: {json}\n\n` shape as the existing
 * chat function — and exposes per-token updates to React.
 *
 * Drives the global presence bus on the way in/out so the avatar
 * transitions thinking → speaking → idle automatically.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pushPresence } from "./presence";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface IronKnowledgeSource {
  id: string;
  title: string;
  kind: "document" | "crm" | "service_kb" | "web";
  confidence: number;
  excerpt?: string;
  marker?: string;
  url?: string;
}

export interface IronKnowledgeMeta {
  trace_id: string;
  conversation_id: string;
  model: string;
  degradation_state: "full" | "reduced" | "cached" | "escalated";
  tokens_today: number;
  retrieval: {
    internal_count: number;
    web_count: number;
    embedding_ok: boolean;
  };
}

export type IronKnowledgeStatus = "idle" | "connecting" | "streaming" | "done" | "error";

export interface IronKnowledgeStreamApi {
  status: IronKnowledgeStatus;
  text: string;
  meta: IronKnowledgeMeta | null;
  sources: IronKnowledgeSource[];
  error: string | null;
  start: (input: { message: string; conversationId?: string; route?: string; enableWeb?: boolean }) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useIronKnowledgeStream(): IronKnowledgeStreamApi {
  const [status, setStatus] = useState<IronKnowledgeStatus>("idle");
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<IronKnowledgeMeta | null>(null);
  const [sources, setSources] = useState<IronKnowledgeSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const presenceReleaseRef = useRef<(() => void) | null>(null);

  const releasePresence = useCallback(() => {
    if (presenceReleaseRef.current) {
      presenceReleaseRef.current();
      presenceReleaseRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    releasePresence();
    setStatus("idle");
  }, [releasePresence]);

  const reset = useCallback(() => {
    cancel();
    setText("");
    setMeta(null);
    setSources([]);
    setError(null);
  }, [cancel]);

  const start = useCallback(
    async (input: { message: string; conversationId?: string; route?: string; enableWeb?: boolean }) => {
      cancel();
      setText("");
      setSources([]);
      setMeta(null);
      setError(null);
      setStatus("connecting");

      // Push thinking immediately so the avatar reacts the moment the
      // user hits Enter, even before the first token arrives.
      presenceReleaseRef.current = pushPresence("iron-knowledge", "thinking");

      const sessionResult = await supabase.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken) {
        setError("not authenticated");
        setStatus("error");
        releasePresence();
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let res: Response;
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/iron-knowledge`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: input.message,
            conversation_id: input.conversationId,
            route: input.route,
            enable_web: input.enableWeb !== false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          setStatus("idle");
          releasePresence();
          return;
        }
        setError(err instanceof Error ? err.message : "fetch failed");
        setStatus("error");
        releasePresence();
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        setError(`iron-knowledge ${res.status}: ${body.slice(0, 200)}`);
        setStatus("error");
        releasePresence();
        return;
      }

      setStatus("streaming");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstTokenSeen = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") {
              continue;
            }
            try {
              const evt = JSON.parse(payload) as {
                meta?: IronKnowledgeMeta;
                text?: string;
                sources?: IronKnowledgeSource[];
              };
              if (evt.meta) setMeta(evt.meta);
              if (typeof evt.text === "string" && evt.text.length > 0) {
                if (!firstTokenSeen) {
                  firstTokenSeen = true;
                  // Transition to speaking on first token so the avatar
                  // mirrors the live response stream.
                  releasePresence();
                  presenceReleaseRef.current = pushPresence(
                    "iron-knowledge",
                    "speaking",
                  );
                }
                setText((prev) => prev + evt.text);
              }
              if (Array.isArray(evt.sources)) {
                setSources(evt.sources);
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (streamErr) {
        if ((streamErr as { name?: string })?.name !== "AbortError") {
          setError(streamErr instanceof Error ? streamErr.message : "stream error");
          setStatus("error");
          releasePresence();
          return;
        }
      }

      setStatus("done");
      releasePresence();
      abortRef.current = null;
    },
    [cancel, releasePresence],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      releasePresence();
    };
  }, [releasePresence]);

  return { status, text, meta, sources, error, start, cancel, reset };
}
