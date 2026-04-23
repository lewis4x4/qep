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
  /** Why the match dropped to a lower confidence — surfaced in the save
   *  guardrail so the rep sees *why* a candidate is weak, not just that
   *  they are. Null when nothing to warn about. */
  mismatchReason: string | null;
  /** Where this proposal came from. Internal sources (past-deal signers,
   *  voice-capture stakeholder mentions) are always trustworthy signal
   *  and bypass the low-confidence guardrail. `web` is Tavily / LinkedIn.
   *  Undefined on cached rows written before v3. */
  source?: "signer" | "voice" | "web";
}

/** Tokens stripped before comparing company names. Corporate suffixes and
 *  filler words match too broadly ("LLC" ↔ "LLC" is meaningless signal). */
const COMPANY_STOPWORDS = new Set([
  "llc",
  "inc",
  "incorporated",
  "co",
  "company",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "lp",
  "llp",
  "plc",
  "the",
  "and",
  "of",
  "&",
]);

/** Break a company name into comparable tokens — lowercased, stopword-free,
 *  punctuation-stripped. Returns an empty array if nothing significant is left. */
function companyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !COMPANY_STOPWORDS.has(t));
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

  // Company match is the single biggest source of false positives. We
  // evaluate three bands:
  //   exactHit   — the full normalized company string appears contiguous
  //                (e.g. "gulf coast land clearing" as a phrase)
  //   fullTokens — every significant token appears somewhere (phrase can
  //                be scrambled or abbreviated but no tokens missing)
  //   partialTokens — only some tokens match (this is the Gary Tyler trap:
  //                "Gulf Coast" matches "Gulf Coast Land Clearing" and
  //                "Gulf Coast Building" alike — NOT enough to trust)
  const haystack = `${result.title} ${result.excerpt}`.toLowerCase();
  const targetPhrase = companyName.trim().toLowerCase();
  const targetTokens = companyTokens(companyName);
  const matchedTokens = targetTokens.filter((tok) => haystack.includes(tok));

  const exactHit = targetPhrase.length > 0 && haystack.includes(targetPhrase);
  const fullTokensHit = targetTokens.length > 0 && matchedTokens.length === targetTokens.length;
  const partialHit = !fullTokensHit && matchedTokens.length > 0;

  // Extract the candidate's own company from their LinkedIn title
  // ("President/Owner at Gulf Coast Building…") so we can tell the rep
  // exactly which company the candidate belongs to when it disagrees.
  const candidateCompany = parsed.title
    ? parsed.title.match(/\bat\s+(.+?)(?:\s*[|·]|$)/i)?.[1]?.trim() ?? null
    : null;

  let confidence: "high" | "medium" | "low";
  if (isLinkedIn && titleHit && exactHit) {
    confidence = "high";
  } else if (isLinkedIn && titleHit && fullTokensHit) {
    confidence = "medium";
  } else {
    // Anything short of a full-token company match is weak — this is
    // where false positives used to slip through as "medium".
    confidence = "low";
  }

  const evidence = [
    isLinkedIn ? "LinkedIn profile" : "web result",
    titleHit ? `title fits ${profile.label.toLowerCase()}` : null,
    exactHit
      ? `"${companyName}" in result`
      : fullTokensHit
      ? `all company tokens present`
      : partialHit
      ? `partial company match (${matchedTokens.length}/${targetTokens.length} tokens)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Build the human-readable mismatch reason the UI shows before save when
  // confidence is "low". Prefer naming the candidate's own company so the
  // rep sees the exact disagreement.
  let mismatchReason: string | null = null;
  if (confidence === "low") {
    if (candidateCompany && !fullTokensHit) {
      mismatchReason = `Profile lists "${candidateCompany}", not "${companyName}".`;
    } else if (partialHit) {
      mismatchReason = `Only ${matchedTokens.length} of ${targetTokens.length} words in "${companyName}" appear on this profile.`;
    } else if (!isLinkedIn) {
      mismatchReason = `Result is not a LinkedIn profile.`;
    } else if (!titleHit) {
      mismatchReason = `Title does not include any ${profile.label.toLowerCase()} keywords.`;
    } else {
      mismatchReason = `Company "${companyName}" not confirmed on the profile.`;
    }
  }

  return {
    name: parsed.name,
    title: parsed.title,
    profileUrl: result.url || null,
    confidence,
    evidence,
    mismatchReason,
  };
}

/** Lightweight container for internal-source proposals. We separate
 *  them from Tavily ranking because they deserve unconditional priority
 *  regardless of the confidence bands we derive from LinkedIn results. */
interface InternalProposal extends Proposal {
  source: "signer" | "voice";
}

/** Normalize a person's name to compare across sources — lowercase,
 *  trimmed, collapsed whitespace. Used both for dedup and for filtering
 *  internal candidates against the already-named contacts at the company. */
function normPersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mine internal CRM sources for candidate names *before* firing Tavily.
 *
 * Two high-signal paths today:
 *   1. Past-deal signers at this company (quote_signatures). They
 *      committed to something in writing — the highest-quality signal
 *      the CRM can produce. Only surfaced for archetypes that plausibly
 *      sign (champion / economic_buyer / executive_sponsor).
 *   2. Voice-capture stakeholder mentions (additionalStakeholders +
 *      contactName). The customer literally named these people on a
 *      call; they're strictly better than a LinkedIn stranger even when
 *      we don't have their title.
 *
 * Known contacts at the company are excluded so we don't propose the
 * same person already occupying a named seat.
 */
async function fetchInternalCandidates(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
  archetype: SeatArchetype,
): Promise<InternalProposal[]> {
  const out: InternalProposal[] = [];

  // Set of already-known people (contacts at this company) — dedup source.
  const knownNames = new Set<string>();
  const knownEmails = new Set<string>();
  try {
    const { data: contacts } = await admin
      .from("crm_contacts")
      .select("first_name, last_name, email")
      .eq("primary_company_id", companyId)
      .is("deleted_at", null)
      .limit(200);
    for (const c of contacts ?? []) {
      const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
      if (name) knownNames.add(normPersonName(name));
      if (c.email) knownEmails.add((c.email as string).trim().toLowerCase());
    }
  } catch (_err) {
    // Missing contacts data is not fatal — we just fall through without
    // dedup protection. A duplicate proposal is a minor UX issue, not
    // worth aborting the internal lookup over.
  }

  // 1. Signers from past deals at this company. quote_signatures joins
  //    through crm_deals, so we first gather the deal IDs and then pull
  //    their signatures in a single IN query — faster than a nested
  //    select in PostgREST for small result sets.
  const archetypeAllowsSigners =
    archetype === "champion" ||
    archetype === "economic_buyer" ||
    archetype === "executive_sponsor";
  if (archetypeAllowsSigners) {
    try {
      const { data: deals } = await admin
        .from("crm_deals")
        .select("id")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .limit(50);
      const dealIds = (deals ?? []).map((d: { id: string }) => d.id);
      if (dealIds.length > 0) {
        const { data: signers } = await admin
          .from("quote_signatures")
          .select("signer_name, signer_email, signed_at, deal_id")
          .in("deal_id", dealIds)
          .order("signed_at", { ascending: false })
          .limit(20);
        for (const s of signers ?? []) {
          const name = (s.signer_name as string | null)?.trim();
          const email = (s.signer_email as string | null)?.trim().toLowerCase() ?? null;
          if (!name) continue;
          if (knownNames.has(normPersonName(name))) continue;
          if (email && knownEmails.has(email)) continue;
          out.push({
            name,
            title: null,
            profileUrl: null,
            confidence: "high",
            evidence: "Signed a quote at this company",
            mismatchReason: null,
            source: "signer",
          });
          knownNames.add(normPersonName(name));
        }
      }
    } catch (_err) {
      // Non-fatal — fall through to voice captures.
    }
  }

  // 2. Voice-capture stakeholder mentions at this company. The rep or
  //    customer named these people on a call; we may not have titles
  //    but the source signal is stronger than any LinkedIn result.
  try {
    const { data: captures } = await admin
      .from("voice_captures")
      .select("extracted_data, created_at")
      .eq("linked_company_id", companyId)
      .not("extracted_data", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const seenInVoice = new Set<string>();
    for (const row of captures ?? []) {
      const ex = row.extracted_data as
        | { record?: { contactName?: string | null; additionalStakeholders?: string[] } }
        | null;
      if (!ex?.record) continue;
      const names: string[] = [];
      if (ex.record.contactName) names.push(ex.record.contactName);
      if (Array.isArray(ex.record.additionalStakeholders)) {
        names.push(...ex.record.additionalStakeholders);
      }
      for (const raw of names) {
        const name = raw?.trim();
        if (!name || name.length < 2) continue;
        const n = normPersonName(name);
        if (knownNames.has(n) || seenInVoice.has(n)) continue;
        seenInVoice.add(n);
        out.push({
          name,
          title: null,
          profileUrl: null,
          confidence: "medium",
          evidence: `Named in a voice capture at this company (${(row.created_at as string).slice(0, 10)})`,
          mismatchReason: null,
          source: "voice",
        });
        if (out.length >= 6) break;
      }
      if (out.length >= 6) break;
    }
  } catch (_err) {
    // Non-fatal.
  }

  return out.slice(0, 4);
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
    .select("id, company_id")
    .eq("id", body.dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealErr) return safeJsonError("deal_lookup_failed", 500, origin);
  if (!dealRow) return safeJsonError("deal not found or access denied", 404, origin);

  const profile = ARCHETYPE_PROFILES[body.archetype];
  const query = `${profile.queryTerms.join(" OR ")} "${body.companyName}" site:linkedin.com/in`;
  // v3 bumps the cache for the CRM-first + source field shape. Old v2
  // entries would be missing `source` on each proposal and wouldn't
  // include internal candidates at all.
  const cacheKey = await sha256Hex(`decision-room-ghost-propose:v3:${query}`);

  // Resolve the caller's workspace explicitly. get_my_workspace() under
  // service role returns "default", which would collapse every workspace
  // into one shared cache bucket — a real cross-tenant leak since
  // LinkedIn-sourced names are workspace-scoped in intent. Fall back to
  // "default" only if the caller has no workspace of their own.
  const cacheWorkspaceId = caller.workspaceId ?? "default";

  // Cache hit? Filter by the caller's workspace so two tenants never
  // share results via this function.
  const { data: cacheRow } = await admin
    .from("iron_web_search_cache")
    .select("results, created_at")
    .eq("workspace_id", cacheWorkspaceId)
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

  // CRM-first: mine internal sources before burning a Tavily call. Signers
  // and voice-capture stakeholders are higher-signal than any LinkedIn
  // stranger, so they always rank above web results in the UI.
  const companyIdForInternal = (dealRow as { company_id: string | null }).company_id;
  const internalProposals: InternalProposal[] = companyIdForInternal
    ? await fetchInternalCandidates(admin, companyIdForInternal, body.archetype)
    : [];

  const tavily = await runTavily(query);
  if ("error" in tavily) {
    return safeJsonError(tavily.error, 502, origin);
  }

  const webProposals: Proposal[] = rankProposals(
    tavily.results
      .map((r) => scoreProposal(profile, r, body.companyName))
      .filter((p): p is Proposal => p != null),
  ).map((p) => ({ ...p, source: "web" as const }));

  // Dedup: drop any web proposal that collides with an internal one by
  // normalized name. Trust the internal source — it's the one the rep's
  // own team produced.
  const internalNames = new Set(internalProposals.map((p) => normPersonName(p.name)));
  const proposals: Proposal[] = [
    ...internalProposals,
    ...webProposals.filter((p) => !internalNames.has(normPersonName(p.name))),
  ].slice(0, 6);

  // Best-effort cache write — don't fail the response if cache insert fails.
  try {
    await admin.from("iron_web_search_cache").upsert(
      {
        workspace_id: cacheWorkspaceId,
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
