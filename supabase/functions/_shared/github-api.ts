/**
 * Minimal GitHub REST helpers for the Stakeholder Build Hub.
 *
 * Zero-blocking policy (per CLAUDE.md): when GITHUB_TOKEN is unset, every
 * method returns `{ skipped: true }` so the caller can continue with a
 * "draft-only, no PR" fallback.
 */

const GITHUB_API = "https://api.github.com";

export interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
}

export function loadGithubConfig(): GithubConfig | null {
  const token = Deno.env.get("GITHUB_TOKEN");
  const owner = Deno.env.get("GITHUB_OWNER");
  const repo = Deno.env.get("GITHUB_REPO");
  const baseBranch = Deno.env.get("GITHUB_BASE_BRANCH") ?? "main";
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, baseBranch };
}

function authHeaders(cfg: GithubConfig): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "qep-hub-edge",
  };
}

async function ghFetch(
  cfg: GithubConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...authHeaders(cfg) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`github ${res.status} ${init?.method ?? "GET"} ${path}: ${body.slice(0, 300)}`);
  }
  return res;
}

export async function getBranchSha(cfg: GithubConfig, branch: string): Promise<string> {
  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const body = (await res.json()) as { object?: { sha?: string } };
  const sha = body.object?.sha;
  if (!sha) throw new Error(`github: no sha for branch ${branch}`);
  return sha;
}

export async function createBranch(cfg: GithubConfig, branchName: string, fromSha: string): Promise<void> {
  await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
}

export async function putFile(
  cfg: GithubConfig,
  opts: { branch: string; path: string; content: string; message: string },
): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(opts.content)));
  await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(opts.path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.message,
      content: encoded,
      branch: opts.branch,
    }),
  });
}

export async function openDraftPr(
  cfg: GithubConfig,
  opts: { title: string; body: string; head: string },
): Promise<{ html_url: string; number: number }> {
  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: cfg.baseBranch,
      draft: true,
    }),
  });
  const body = (await res.json()) as { html_url?: string; number?: number };
  if (!body.html_url || typeof body.number !== "number") {
    throw new Error("github: malformed PR response");
  }
  return { html_url: body.html_url, number: body.number };
}

export async function mergePr(
  cfg: GithubConfig,
  prNumber: number,
  opts?: { commit_title?: string; merge_method?: "merge" | "squash" | "rebase" },
): Promise<{ sha: string; merged: boolean }> {
  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commit_title: opts?.commit_title,
      merge_method: opts?.merge_method ?? "squash",
    }),
  });
  const body = (await res.json()) as { sha?: string; merged?: boolean };
  return { sha: body.sha ?? "", merged: Boolean(body.merged) };
}

export function parsePrNumberFromUrl(url: string): number | null {
  const match = url.match(/\/pull\/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface GithubCommitSummary {
  sha: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  committed_at: string;
  html_url: string;
}

/**
 * List recent commits on a branch. Uses the commits API which returns parents
 * + message + author metadata in one shot.
 *
 * `since` is an ISO timestamp — anything older is skipped server-side.
 */
export async function listCommitsOnBranch(
  cfg: GithubConfig,
  opts: { branch?: string; since?: string; perPage?: number },
): Promise<GithubCommitSummary[]> {
  const params = new URLSearchParams({
    sha: opts.branch ?? cfg.baseBranch,
    per_page: String(Math.min(Math.max(opts.perPage ?? 30, 1), 100)),
  });
  if (opts.since) params.set("since", opts.since);

  const res = await ghFetch(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/commits?${params.toString()}`,
  );
  const raw = (await res.json()) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author?: { name?: string; date?: string } };
    author?: { login?: string } | null;
  }>;
  return raw.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author_name: c.commit.author?.name ?? null,
    author_login: c.author?.login ?? null,
    committed_at: c.commit.author?.date ?? new Date().toISOString(),
    html_url: c.html_url,
  }));
}

/**
 * List PRs associated with a commit. Used to cross-reference the `hub-fb-id:`
 * marker we write in hub-feedback-draft-fix PR bodies back to the originating
 * feedback row.
 */
export async function listPrsForCommit(
  cfg: GithubConfig,
  sha: string,
): Promise<Array<{ number: number; body: string | null; html_url: string }>> {
  const res = await ghFetch(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/commits/${encodeURIComponent(sha)}/pulls`,
  );
  const raw = (await res.json()) as Array<{
    number: number;
    body?: string | null;
    html_url: string;
  }>;
  return raw.map((p) => ({
    number: p.number,
    body: p.body ?? null,
    html_url: p.html_url,
  }));
}

export interface GithubStatusEntry {
  context: string;
  state: "error" | "failure" | "pending" | "success";
  target_url: string | null;
  description: string | null;
  updated_at: string;
}

/**
 * Fetch the combined status for a commit SHA. Netlify posts one status per
 * PR with context `netlify/<site-name>` and `target_url` set to the
 * preview deploy URL once it's built. We use this instead of the newer
 * Checks API because Netlify still writes to the classic Statuses API and
 * it's one round trip.
 */
export async function getCombinedStatus(
  cfg: GithubConfig,
  sha: string,
): Promise<GithubStatusEntry[]> {
  const res = await ghFetch(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/commits/${encodeURIComponent(sha)}/status?per_page=50`,
  );
  const body = (await res.json()) as {
    statuses?: Array<{
      context?: string;
      state?: string;
      target_url?: string | null;
      description?: string | null;
      updated_at?: string;
    }>;
  };
  return (body.statuses ?? []).map((s) => ({
    context: s.context ?? "",
    state: (s.state as GithubStatusEntry["state"]) ?? "pending",
    target_url: s.target_url ?? null,
    description: s.description ?? null,
    updated_at: s.updated_at ?? new Date().toISOString(),
  }));
}

/**
 * Fetch a single PR so we can resolve its head SHA + merged flag. The
 * preview-poll fn needs the head SHA to query combined-status; the merge
 * flag lets us skip rows whose PR closed out-of-band.
 */
export async function getPullRequest(
  cfg: GithubConfig,
  prNumber: number,
): Promise<{
  head_sha: string;
  head_ref: string;
  merged: boolean;
  state: "open" | "closed";
  draft: boolean;
}> {
  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls/${prNumber}`);
  const body = (await res.json()) as {
    head?: { sha?: string; ref?: string };
    merged?: boolean;
    state?: string;
    draft?: boolean;
  };
  return {
    head_sha: body.head?.sha ?? "",
    head_ref: body.head?.ref ?? "",
    merged: Boolean(body.merged),
    state: body.state === "closed" ? "closed" : "open",
    draft: Boolean(body.draft),
  };
}

export function slugify(s: string, max = 60): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return base || "feedback";
}
