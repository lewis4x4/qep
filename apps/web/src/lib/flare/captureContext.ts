/**
 * Wave 6.11 Flare — context builder.
 *
 * Assembles the FlareContext payload from the live page: identity,
 * location, ring buffers, environment, performance metrics.
 */
import { supabase } from "@/lib/supabase";
import { snapshotRingBuffers } from "./ringBuffers";
import { redactDeep } from "./redactPII";
import type { FlareContext, FlareVisibleEntity } from "./types";

/* ── Session id — once per tab, persists in sessionStorage ─────── */

function getOrCreateSessionId(): string {
  const key = "flare_session_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

const TAB_ID = crypto.randomUUID();
const PAGE_LOAD_TS = performance.timeOrigin;

/* ── Browser / OS parsing (minimal, no UA parser dep) ────────────── */

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua) && !/Edg/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return "Safari";
  return "Unknown";
}

function parseOS(ua: string): string {
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

/* ── Visible entities — scrape data-entity-id / data-entity-type ─ */

function scrapeVisibleEntities(): FlareVisibleEntity[] {
  const out: FlareVisibleEntity[] = [];
  const seen = new Set<string>();
  document.querySelectorAll<HTMLElement>("[data-entity-id]").forEach((el) => {
    const rect = el.getBoundingClientRect();
    // Only count elements actually in the viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const type = el.dataset.entityType ?? "unknown";
    const id = el.dataset.entityId;
    if (!id) return;
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, id });
  });
  return out.slice(0, 50);
}

/* ── Route extraction — best-effort from location + react-router ─ */

function currentRoute(): string {
  // Prefer the matched route template if an element exposes it
  const routeEl = document.querySelector<HTMLElement>("[data-flare-route]");
  if (routeEl?.dataset.flareRoute) return routeEl.dataset.flareRoute;
  // Fall back to raw pathname
  return location.pathname;
}

/* ── Performance metrics — best-effort from Web Vitals APIs ───── */

function collectPerformanceMetrics() {
  const perf = (performance as Performance & { memory?: { usedJSHeapSize?: number } });
  const memory_used_mb = perf.memory?.usedJSHeapSize != null
    ? Math.round(perf.memory.usedJSHeapSize / (1024 * 1024))
    : null;

  // LCP / CLS / FID are collected via PerformanceObserver in a real web-vitals
  // integration; without one we just surface whatever navigation timing exists
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const lcp_ms = nav ? Math.round(nav.loadEventEnd - nav.startTime) : null;

  return {
    lcp_ms,
    fid_ms: null,
    cls: null,
    memory_used_mb,
  };
}

/* ── Store snapshot — redacted react-query cache keys ────────── */

function collectQueryKeys(): string[] {
  try {
    const w = window as Window & { __REACT_QUERY_CLIENT__?: { getQueryCache?: () => { getAll?: () => Array<{ queryKey: unknown }> } } };
    const cache = w.__REACT_QUERY_CLIENT__?.getQueryCache?.();
    if (!cache?.getAll) return [];
    return cache.getAll().map((q) => JSON.stringify(q.queryKey)).slice(0, 100);
  } catch {
    return [];
  }
}

/* ── Main ────────────────────────────────────────────────────── */

export async function buildContext(): Promise<FlareContext> {
  const session = (await supabase.auth.getSession()).data.session;
  const user = session?.user;

  // Caller workspace + role pulled from profile if available
  let workspaceId = "default";
  let role = "unknown";
  let ironRole: string | null = null;
  if (user?.id) {
    try {
      const { data: profile } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { workspace_id?: string; role?: string; iron_role?: string } | null; error: unknown }> } } };
      }).from("profiles").select("workspace_id, role, iron_role").eq("id", user.id).maybeSingle();
      if (profile) {
        workspaceId = profile.workspace_id ?? "default";
        role = profile.role ?? "unknown";
        ironRole = profile.iron_role ?? null;
      }
    } catch { /* ignore */ }
  }

  const ring = snapshotRingBuffers();
  const ua = navigator.userAgent;

  const visibleEntities = scrapeVisibleEntities();
  const queryKeys = collectQueryKeys();

  const nconn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;

  const context: FlareContext = {
    user_id: user?.id ?? "anonymous",
    workspace_id: workspaceId,
    reporter_email: user?.email ?? "",
    reporter_role: role,
    reporter_iron_role: ironRole,

    url: location.href,
    route: currentRoute(),
    page_title: document.title,

    visible_entities: visibleEntities,

    click_trail: ring.click_trail,
    network_trail: ring.network_trail,
    console_errors: ring.console_errors,
    route_trail: ring.route_trail,

    store_snapshot: null, // populated by host app if they expose one
    react_query_cache_keys: queryKeys,
    feature_flags: (redactDeep({}) as Record<string, boolean>),

    browser: parseBrowser(ua),
    os: parseOS(ua),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio ?? 1,
    },
    network_type: nconn?.effectiveType ?? null,
    app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev",
    git_sha: (import.meta.env.VITE_GIT_SHA as string | undefined) ?? "local",
    build_timestamp: (import.meta.env.VITE_BUILD_TIMESTAMP as string | undefined) ?? new Date(0).toISOString(),

    session_id: getOrCreateSessionId(),
    tab_id: TAB_ID,
    time_on_page_ms: Math.round(performance.now()),

    performance_metrics: collectPerformanceMetrics(),
  };

  return context;
}

export { PAGE_LOAD_TS };
