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
import { pushPresence } from "./presence";
import { requireIronAccessToken } from "./auth";
import { buildIronNoDeadEndMessage } from "./no-dead-end";
import type { IronLaunchContext } from "./types";

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
  start: (input: { message: string; conversationId?: string; route?: string; enableWeb?: boolean; context?: IronLaunchContext | null }) => Promise<void>;
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
    async (input: { message: string; conversationId?: string; route?: string; enableWeb?: boolean; context?: IronLaunchContext | null }) => {
      cancel();
      setText("");
      setSources([]);
      setMeta(null);
      setError(null);
      setStatus("connecting");

      // Push thinking immediately so the avatar reacts the moment the
      // user hits Enter, even before the first token arrives.
      presenceReleaseRef.current = pushPresence("iron-knowledge", "thinking");

      let accessToken: string;
      try {
        accessToken = await requireIronAccessToken();
      } catch (err) {
        setError(buildIronNoDeadEndMessage({
          surface: "knowledge",
          action: "answer the question",
          error: err instanceof Error ? err.message : "Iron auth failed",
        }));
        setStatus("error");
        releasePresence();
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const requestBody = JSON.stringify({
        message: input.message,
        conversation_id: input.conversationId,
        route: input.route,
        enable_web: input.enableWeb !== false,
        context: input.context
          ? {
              kind: input.context.kind,
              entity_id: input.context.entityId ?? null,
              title: input.context.title,
              route: input.context.route,
              evidence: input.context.evidence ?? null,
            }
          : undefined,
      });

      const fetchKnowledge = (token: string) => fetch(`${SUPABASE_URL}/functions/v1/iron-knowledge`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal: controller.signal,
      });

      let res: Response;
      try {
        res = await fetchKnowledge(accessToken);
        if (res.status === 401 || res.status === 403) {
          const freshToken = await requireIronAccessToken({ forceRefresh: true });
          res = await fetchKnowledge(freshToken);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          setStatus("idle");
          releasePresence();
          return;
        }
        const message = err instanceof TypeError
          ? "Iron could not reach the knowledge service. Check connection and try again."
          : err instanceof Error ? err.message : "fetch failed";
        setError(buildIronNoDeadEndMessage({
          surface: "knowledge",
          action: "answer the question",
          error: message,
        }));
        setStatus("error");
        releasePresence();
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        setError(buildIronNoDeadEndMessage({
          surface: "knowledge",
          action: "answer the question",
          error: `iron-knowledge ${res.status}: ${body.slice(0, 200)}`,
        }));
        setStatus("error");
        releasePresence();
        return;
      }

      // COST_LIMIT + other structured JSON responses come back as
      // Content-Type: application/json instead of text/event-stream.
      // Detect and render the message field as a normal assistant turn
      // so the user sees *why* the call failed instead of a blank bubble.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        try {
          const payload = (await res.json()) as {
            ok?: boolean;
            category?: string;
            message?: string;
            tokens_today?: number;
          };
          const friendly = payload.message ??
            (payload.category === "COST_LIMIT"
              ? "Iron usage cap reached for today. Resets at midnight UTC."
              : "Iron returned an unexpected response.");
          // Stream the friendly message as a single "text" chunk so the
          // IronBar rendering path is identical to a normal answer.
          setText(friendly);
          setStatus("done");
          releasePresence();
          return;
        } catch {
          setError(buildIronNoDeadEndMessage({
            surface: "knowledge",
            action: "answer the question",
            error: "Iron returned a non-streaming response we couldn't parse.",
          }));
          setStatus("error");
          releasePresence();
          return;
        }
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
          setError(buildIronNoDeadEndMessage({
            surface: "knowledge",
            action: "finish streaming the answer",
            error: streamErr instanceof Error ? streamErr.message : "stream error",
          }));
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
