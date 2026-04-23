/**
 * decision-room-ghost-propose
 *
 * For a ghost seat (archetype + companyName), propose specific named
 * candidates via Tavily web search against LinkedIn. Caches results in
 * iron_web_search_cache (24h TTL) keyed by workspace + query hash so a
 * second click costs nothing.
 *
 * Returned proposal shape: { name, title, profileUrl, confidence, evidence }
 * where confidence is derived from (a) whether the result URL is a
 * LinkedIn profile, (b) whether the archetype's title keywords appear in
 * the result, and (c) whether the company name appears.
 *
 * Gateway verify_jwt = false; the function does its own access check.
 */
import { createCallerClient, createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type SeatArchetype =
  | "champion"
  | "economic_buyer"
  | "operations"
  | "procurement"
  | "operator"
  | "maintenance"
  | "executive_sponsor";

interface ArchetypeProfile {
  label: string;
  queryTerms: string[];
  titleKeywords: string[];
}

const ARCHETYPE_PROFILES: Record<SeatArchetype, ArchetypeProfile> = {
  champion: {
    label: "Champion",
    queryTerms: ['"sales lead"', '"account manager"'],
    titleKeywords: ["account", "sales", "manager", "director"],
  },
  economic_buyer: {
    label: "Economic Buyer",
    queryTerms: ['"CFO"', '"Owner"', '"President"', '"Controller"'],
    titleKeywords: ["cfo", "owner", "president", "controller", "vp finance", "finance director"],
  },
  operations: {
    label: "Operations Manager",
    queryTerms: ['"Plant Manager"', '"Operations Manager"', '"COO"', '"General Manager"'],
    titleKeywords: ["plant", "operations", "coo", "general manager", "branch manager"],
  },
  procurement: {
    label: "Procurement",
    queryTerms: ['"Procurement Manager"', '"Purchasing Manager"', '"Sourcing Lead"'],
    titleKeywords: ["procurement", "purchasing", "buyer", "sourcing"],
  },
  operator: {
    label: "Lead Operator",
    queryTerms: ['"Equipment Operator"', '"Foreman"', '"Superintendent"'],
    titleKeywords: ["operator", "foreman", "superintendent", "lead hand"],
  },
  maintenance: {
    label: "Maintenance Lead",
    queryTerms: ['"Maintenance Manager"', '"Shop Manager"', '"Fleet Manager"'],
    titleKeywords: ["maintenance", "mechanic", "shop manager", "service manager", "fleet manager"],
  },
  executive_sponsor: {
    label: "Executive Sponsor",
    queryTerms: ['"CEO"', '"President"', '"Managing Director"'],
    titleKeywords: ["ceo", "president", "managing director"],
  },
};

interface GhostProposeRequest {
  dealId: string;
  archetype: SeatArchetype;
  companyName: string;
}

interface Proposal {
  name: string;
  title: string | null;
  profileUrl: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

function normString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t.slice(0, maxLen);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface TavilyResult {
  title: string;
  url: string;
  excerpt: string;
}

async function runTavily(query: string): Promise<{ results: TavilyResult[] } | { error: string }> {
  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) return { error: "TAVILY_API_KEY not configured" };

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 8,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { error: `tavily ${res.status}` };
    const payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const results = (payload.results ?? []).slice(0, 8).map((r) => ({
      title: String(r.title ?? r.url ?? "Web result"),
      url: String(r.url ?? ""),
      excerpt: String(r.content ?? r.snippet ?? "").slice(0, 600),
    }));
    return { results };
  } catch (err) {
    return { error: `web search failed: ${(err as Error).message}` };
  }
}

/** Very simple LinkedIn title parser — "Jane Smith — Plant Manager at Acme Co". */
function parseLinkedInTitle(raw: string, companyName: string): { name: string; title: string | null } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Typical shape: "Name - Title - Company | LinkedIn"  or  "Name – Title at Company"
  const withoutLinkedIn = cleaned.replace(/\s*[|·]\s*LinkedIn.*$/i, "").trim();
  const parts = withoutLinkedIn.split(/\s[-–—]\s/);
  if (parts.length < 2) return null;
  const name = parts[0]?.trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (!/[A-Za-z]/.test(name)) return null;

  // Title is everything between name and the company segment (or end).
  const titleChunks = parts.slice(1).filter((p) => {
    const lower = p.toLowerCase();
    const companyLower = companyName.toLowerCase();
    return companyLower ? !lower.includes(companyLower) : true;
  });
  const title = titleChunks.join(" · ").trim() || null;
  return { name, title };
}

function scoreProposal(profile: ArchetypeProfile, result: TavilyResult, companyName: string): Proposal | null {
  const isLinkedIn = /linkedin\.com\/in\//i.test(result.url);
  const parsed = parseLinkedInTitle(result.title, companyName);
  if (!parsed) return null;

  const hayTitle = `${parsed.title ?? ""} ${result.excerpt}`.toLowerCase();
  const titleHit = profile.titleKeywords.some((kw) => hayTitle.includes(kw));

  const hayExcerpt = result.excerpt.toLowerCase();
  const companyHit = companyName
    ? hayExcerpt.includes(companyName.toLowerCase()) || result.title.toLowerCase().includes(companyName.toLowerCase())
    : false;

  let confidence: "high" | "medium" | "low";
  if (isLinkedIn && titleHit && companyHit) confidence = "high";
  else if ((isLinkedIn && titleHit) || (titleHit && companyHit)) confidence = "medium";
  else confidence = "low";

  const evidence = [
    isLinkedIn ? "LinkedIn profile" : "web result",
    titleHit ? `title fits ${profile.label.toLowerCase()}` : null,
    companyHit ? `${companyName} referenced` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    name: parsed.name,
    title: parsed.title,
    profileUrl: result.url || null,
    confidence,
    evidence,
  };
}

function rankProposals(list: Proposal[]): Proposal[] {
  const rank: Record<Proposal["confidence"], number> = { high: 0, medium: 1, low: 2 };
  const seen = new Set<string>();
  return list
    .slice()
    .sort((a, b) => rank[a.confidence] - rank[b.confidence])
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("method_not_allowed", 405, origin);

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return safeJsonError("invalid_json", 400, origin);
  }

  const dealId = normString(raw.dealId, 40);
  const archetype = typeof raw.archetype === "string" ? raw.archetype : null;
  const companyName = normString(raw.companyName, 200);
  if (!dealId || !UUID_PATTERN.test(dealId)) return safeJsonError("invalid dealId", 400, origin);
  if (!archetype || !(archetype in ARCHETYPE_PROFILES)) {
    return safeJsonError("unknown archetype", 400, origin);
  }
  if (!companyName) return safeJsonError("companyName required", 400, origin);

  const body: GhostProposeRequest = {
    dealId,
    archetype: archetype as SeatArchetype,
    companyName,
  };

  const admin = createAdminClient();
  const caller = await resolveCallerContext(req, admin);
  if (!caller.userId || !caller.role || !caller.authHeader) {
    return safeJsonError("Unauthorized", 401, origin);
  }

  const callerClient = createCallerClient(caller.authHeader);
  const { data: dealRow, error: dealErr } = await callerClient
    .from("crm_deals")
    .select("id")
    .eq("id", body.dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealErr) return safeJsonError("deal_lookup_failed", 500, origin);
  if (!dealRow) return safeJsonError("deal not found or access denied", 404, origin);

  const profile = ARCHETYPE_PROFILES[body.archetype];
  const query = `${profile.queryTerms.join(" OR ")} "${body.companyName}" site:linkedin.com/in`;
  const cacheKey = await sha256Hex(`decision-room-ghost-propose:v1:${query}`);

  // Cache hit?
  const { data: cacheRow } = await admin
    .from("iron_web_search_cache")
    .select("results, created_at")
    .eq("query_hash", cacheKey)
    .maybeSingle();

  if (cacheRow) {
    const age = Date.now() - new Date(cacheRow.created_at as string).getTime();
    if (age < CACHE_TTL_MS && Array.isArray(cacheRow.results)) {
      return safeJsonOk(
        {
          proposals: cacheRow.results as Proposal[],
          source: "cache",
          query,
          generatedAt: new Date().toISOString(),
        },
        origin,
      );
    }
  }

  const tavily = await runTavily(query);
  if ("error" in tavily) {
    return safeJsonError(tavily.error, 502, origin);
  }

  const proposals = rankProposals(
    tavily.results
      .map((r) => scoreProposal(profile, r, body.companyName))
      .filter((p): p is Proposal => p != null),
  );

  // Best-effort cache write — don't fail the response if cache insert fails.
  try {
    await admin.from("iron_web_search_cache").upsert(
      {
        query_hash: cacheKey,
        query_text: query,
        results: proposals,
      },
      { onConflict: "workspace_id,query_hash" },
    );
  } catch (err) {
    captureEdgeException(err, { fn: "decision-room-ghost-propose", req, extra: { stage: "cache_write" } });
    console.warn("[decision-room-ghost-propose] cache write failed", err);
  }

  return safeJsonOk(
    {
      proposals,
      source: "fresh",
      query,
      generatedAt: new Date().toISOString(),
    },
    origin,
  );
});
