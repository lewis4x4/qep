/**
 * hub-feedback-draft-fix — synthesize a fix proposal + open a draft PR.
 *
 * Admin/owner only. Takes a triaged `hub_feedback` row and:
 *   1. Calls Claude Sonnet 4.6 to generate a branch slug, PR title, and a
 *      PR-body markdown that scopes the fix (not the diff — edge funcs
 *      can't run Claude Code / git locally).
 *   2. If GITHUB_TOKEN + GITHUB_OWNER + GITHUB_REPO are set, creates the
 *      branch from main, writes a `.claude/feedback/QEP-FB-{slug}.md`
 *      spec file to that branch, and opens a DRAFT PR pointed at main.
 *   3. Writes `claude_branch_name`, `claude_pr_url`, updates
 *      `ai_summary` / `ai_suggested_action` with richer context, flips
 *      status → 'awaiting_merge'.
 *
 * Zero-blocking: when GitHub env is missing, we still generate the
 * proposal and stash it in `ai_suggested_action` + the feedback row,
 * with status='drafting'. Brian can pick it up manually. This matches
 * the CLAUDE.md contract: missing credentials must fall back safely.
 *
 * NOT implemented here: actual code-writing via Claude Code Agent SDK.
 * That runs on Brian's workstation against a real worktree; it polls
 * hub_feedback for status='drafting' rows and attaches commits to the
 * draft PR. (Ships as a local runner, not an edge function.)
 */

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  createBranch,
  getBranchSha,
  loadGithubConfig,
  openDraftPr,
  putFile,
  slugify,
} from "../_shared/github-api.ts";

const PROPOSAL_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 30_000;

interface RequestBody {
  feedback_id?: unknown;
}

interface Proposal {
  branch_slug: string;
  pr_title: string;
  pr_body_markdown: string;
  affected_paths: string[];
  risk_level: "low" | "medium" | "high";
}

const PROPOSAL_SYSTEM = `You are a senior engineer drafting a PR spec for QEP OS, a dealership operating system (parts, sales, service, rental).

Read the stakeholder feedback and propose a PR-shaped fix. Return ONLY JSON:

{
  "branch_slug": "kebab-case, <= 40 chars, no prefix",
  "pr_title": "Conventional-commit style, <= 72 chars (e.g. 'fix(parts): column header wraps on mobile')",
  "pr_body_markdown": "Markdown body for the PR. MUST have these sections:\\n## Context\\n## Proposal\\n## Files likely to change\\n## Risks / rollback",
  "affected_paths": ["array", "of", "likely/file/paths"],
  "risk_level": "low" | "medium" | "high"
}

Rules:
- Branch slug: action-first ("fix-mobile-column-wrap", not "column-wrap-mobile-fix").
- PR title: short. Operators read it at a glance.
- PR body: plain voice (no "thrilled to", no "excited about"). State the problem, the minimal fix, then list paths.
- Risk "high" requires a migration, an RLS change, or touches financial calculations.
- Don't invent filenames. If unsure, say "search apps/web/src/features/... for ...".`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const auth = await requireHubUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (auth.audience !== "internal" || !["admin", "owner"].includes(auth.role)) {
      return safeJsonError("admin/owner only", 403, origin);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not set", 500, origin);
    }

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    const feedbackId = typeof body?.feedback_id === "string" ? body.feedback_id : "";
    if (!feedbackId) return safeJsonError("feedback_id required", 400, origin);

    const { data: feedback, error: fetchErr } = await auth.supabase
      .from("hub_feedback")
      .select("*")
      .eq("id", feedbackId)
      .is("deleted_at", null)
      .single();
    if (fetchErr || !feedback) {
      return safeJsonError("feedback not found", 404, origin);
    }
    if (feedback.status === "shipped" || feedback.status === "wont_fix") {
      return safeJsonError(`feedback already ${feedback.status}`, 409, origin);
    }

    // 1. Mark as drafting so concurrent double-clicks collapse to one run.
    await auth.supabase
      .from("hub_feedback")
      .update({ status: "drafting" })
      .eq("id", feedbackId);

    // 2. Ask Claude for a structured proposal.
    const proposal = await generateProposal({
      apiKey: anthropicKey,
      feedbackBody: String(feedback.body ?? ""),
      aiSummary: String(feedback.ai_summary ?? ""),
      feedbackType: String(feedback.feedback_type ?? ""),
      priority: String(feedback.priority ?? "medium"),
    });

    const branchName = `hub-fb/${feedback.id.slice(0, 8)}-${slugify(proposal.branch_slug, 40)}`;

    // 3. If GitHub is configured, create branch + draft PR.
    const ghCfg = loadGithubConfig();
    let prUrl: string | null = null;
    let branchCreated = false;
    let ghError: string | null = null;

    if (ghCfg) {
      try {
        const baseSha = await getBranchSha(ghCfg, ghCfg.baseBranch);
        await createBranch(ghCfg, branchName, baseSha);
        branchCreated = true;

        const specPath = `.claude/feedback/${branchName.split("/").pop()}.md`;
        const specContent = [
          `# ${proposal.pr_title}`,
          "",
          `Generated by hub-feedback-draft-fix for feedback [\`${feedback.id}\`](./).`,
          `Audience: ${auth.audience} · Type: ${feedback.feedback_type} · Priority: ${feedback.priority}`,
          "",
          "## Original feedback",
          "",
          "> " + String(feedback.body ?? "").split("\n").join("\n> "),
          "",
          proposal.pr_body_markdown,
        ].join("\n");

        await putFile(ghCfg, {
          branch: branchName,
          path: specPath,
          content: specContent,
          message: `chore(hub): draft spec for feedback ${feedback.id.slice(0, 8)}`,
        });

        const pr = await openDraftPr(ghCfg, {
          title: proposal.pr_title,
          body: proposal.pr_body_markdown + `\n\n---\n_hub-feedback-id: \`${feedback.id}\`_`,
          head: branchName,
        });
        prUrl = pr.html_url;
      } catch (e) {
        ghError = e instanceof Error ? e.message : String(e);
        // Fall through: we still persist the proposal locally.
      }
    }

    // 4. Write results back to the feedback row.
    const finalStatus = prUrl ? "awaiting_merge" : "drafting";
    const update = {
      status: finalStatus,
      claude_branch_name: branchCreated ? branchName : null,
      claude_pr_url: prUrl,
      ai_suggested_action: `${proposal.pr_title} — ${
        proposal.affected_paths.slice(0, 3).join(", ") || "scope TBD"
      }`,
    };

    const { data: updated, error: updErr } = await auth.supabase
      .from("hub_feedback")
      .update(update)
      .eq("id", feedbackId)
      .select("*")
      .single();

    if (updErr || !updated) {
      throw new Error(`update failed: ${updErr?.message ?? "unknown"}`);
    }

    return safeJsonOk(
      {
        feedback: updated,
        proposal,
        branch: branchCreated ? branchName : null,
        pr_url: prUrl,
        github_configured: Boolean(ghCfg),
        github_error: ghError,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-feedback-draft-fix" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function generateProposal(params: {
  apiKey: string;
  feedbackBody: string;
  aiSummary: string;
  feedbackType: string;
  priority: string;
}): Promise<Proposal> {
  const user = [
    `Type: ${params.feedbackType}`,
    `Priority: ${params.priority}`,
    params.aiSummary ? `Triage summary: ${params.aiSummary}` : null,
    "",
    "Stakeholder feedback body:",
    params.feedbackBody,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PROPOSAL_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: PROPOSAL_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic proposal ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const textPart = ((data?.content ?? []) as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  const raw = (textPart?.text ?? "").trim();
  const stripped = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Defaults below.
  }

  const slug = typeof parsed.branch_slug === "string" ? slugify(parsed.branch_slug, 40) : "feedback";
  const title = typeof parsed.pr_title === "string" ? parsed.pr_title.slice(0, 120) : "chore(hub): stakeholder feedback";
  const bodyMd = typeof parsed.pr_body_markdown === "string"
    ? parsed.pr_body_markdown
    : "## Context\n\n(no body)\n\n## Proposal\n\n(pending)";
  const paths = Array.isArray(parsed.affected_paths)
    ? (parsed.affected_paths as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 10)
    : [];
  const risk = parsed.risk_level === "high" || parsed.risk_level === "medium" || parsed.risk_level === "low"
    ? parsed.risk_level
    : "medium";

  return {
    branch_slug: slug,
    pr_title: title,
    pr_body_markdown: bodyMd,
    affected_paths: paths,
    risk_level: risk,
  };
}
