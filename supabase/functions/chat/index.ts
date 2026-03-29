import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}


Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // SEC-QEP-005: Verify user has a valid profile (server-side RBAC)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    // SEC-QEP-006: Per-user rate limiting — 10 requests per minute
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: user.id,
      p_endpoint: "chat",
      p_max_requests: 10,
      p_window_seconds: 60,
    });

    if (rlError) {
      // SEC-QEP-102: Fail closed — return 503 when rate limit check errors
      console.error("Rate limit check failed:", rlError);
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable. Please try again shortly." }),
        { status: 503, headers: { ...ch, "Content-Type": "application/json", "Retry-After": "10" } }
      );
    } else if (allowed !== true) {
      // SEC-QEP-102: Fail closed — reject unless explicitly allowed.
      // Catches both false (rate limited) and null/undefined (unexpected return).
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please wait before sending another message." }),
        {
          status: 429,
          headers: { ...ch, "Content-Type": "application/json", "Retry-After": "60" },
        }
      );
    }

    const body = await req.json();
    const rawMessage = body?.message;
    const rawHistory = body?.history;

    // SEC-QEP-004: Server-side input validation — prevent history injection
    const MAX_MESSAGE_LENGTH = 8000;
    const MAX_HISTORY_ITEMS = 20;

    if (typeof rawMessage !== "string" || rawMessage.length > MAX_MESSAGE_LENGTH) {
      return new Response(JSON.stringify({ error: "Invalid message" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const message = rawMessage;

    // Whitelist role field — only "user" and "assistant" are valid
    const validatedHistory: ChatMessage[] = [];
    if (Array.isArray(rawHistory)) {
      for (const item of rawHistory.slice(-MAX_HISTORY_ITEMS)) {
        if (
          item &&
          typeof item === "object" &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.length <= MAX_MESSAGE_LENGTH
        ) {
          validatedHistory.push({ role: item.role, content: item.content });
        }
      }
    }

    if (!message.trim()) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    // Generate embedding for the user's question
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    // Use OpenAI embeddings (1536 dims) for pgvector compatibility
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: message,
      }),
    });
    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Semantic search for relevant chunks
    const { data: chunks, error: searchError } = await supabaseAdmin.rpc("search_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: 5,
    });

    if (searchError) {
      console.error("Search error:", searchError);
    }

    // Build context from retrieved chunks
    const context = chunks && chunks.length > 0
      ? chunks.map((c: { document_title: string; content: string }) =>
          `[Source: ${c.document_title}]\n${c.content}`
        ).join("\n\n---\n\n")
      : null;

    const systemPrompt = context
      ? `You are the QEP USA internal knowledge assistant. Answer questions based strictly on the provided company documents. If the answer isn't in the documents, say so clearly — do not make up information.

Here are the relevant excerpts from QEP's internal documents:

${context}

Guidelines:
- Be concise and direct
- Cite the source document when relevant
- If information is not in the provided context, say "I don't have that information in QEP's documents"
- Never reveal confidential details outside what's shown in context`
      : `You are the QEP USA internal knowledge assistant. The knowledge base is currently empty or no relevant documents were found for this question. Let the user know you'll be able to answer once QEP's documents (handbook, SOPs, etc.) are loaded into the system.`;

    // Stream response using Claude
    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...validatedHistory,
        { role: "user", content: message },
      ],
    });

    // Build deduplicated source list for citation UI
    type ChunkRow = { document_title: string; similarity: number };
    const sources: { title: string; confidence: number }[] = [];
    if (chunks && chunks.length > 0) {
      const seen = new Set<string>();
      for (const c of chunks as ChunkRow[]) {
        if (!seen.has(c.document_title)) {
          seen.add(c.document_title);
          sources.push({
            title: c.document_title,
            confidence: Math.round(c.similarity * 100),
          });
        }
      }
    }

    // Return SSE stream
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              const data = `data: ${JSON.stringify({ text: event.delta.text })}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
          }
          // Emit sources before closing so UI can render citations
          if (sources.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
          }
        } catch (streamError) {
          console.error("Stream error:", streamError);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "Sorry, I encountered an error generating a response. Please try again." })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        ...ch,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat function error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
