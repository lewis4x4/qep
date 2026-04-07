/**
 * Wave 6.11 Flare — ring buffers for click / network / console / route.
 *
 * Installed once by FlareProvider. Each buffer is a fixed-length array
 * using shift-on-overflow. In-memory per tab, no persistence.
 */
import type {
  FlareClickEvent,
  FlareConsoleError,
  FlareNetworkEvent,
  FlareRouteChange,
} from "./types";
import { redactString, redactUrl } from "./redactPII";

const CLICK_CAP = 10;
const NETWORK_CAP = 10;
const CONSOLE_CAP = 50;
const ROUTE_CAP = 10;

class RingBuffer<T> {
  private buf: T[] = [];
  constructor(private cap: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  snapshot(): T[] {
    return [...this.buf];
  }
}

const clicks = new RingBuffer<FlareClickEvent>(CLICK_CAP);
const network = new RingBuffer<FlareNetworkEvent>(NETWORK_CAP);
const consoleErrors = new RingBuffer<FlareConsoleError>(CONSOLE_CAP);
const routes = new RingBuffer<FlareRouteChange>(ROUTE_CAP);

let installed = false;
let cleanupFns: Array<() => void> = [];

/* ── Inline CSS selector builder (avoids @medv/finder dep) ─────── */

function buildSelector(el: Element): string {
  if (!el || el === document.documentElement) return "html";
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < 6) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }
    const classList = Array.from(current.classList).filter((c) => !c.startsWith("css-") && c.length < 30);
    if (classList.length > 0) {
      part += "." + classList.slice(0, 2).join(".");
    }
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((e) => e.tagName === current!.tagName)
      : [];
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = current.parentElement;
    depth += 1;
  }
  return parts.join(" > ").slice(0, 200);
}

/* ── Install / uninstall ─────────────────────────────────────────── */

export function installRingBuffers(): () => void {
  if (installed) return () => void 0;
  installed = true;

  // 1. Click trail — capture phase so we see clicks even from inside
  //    contentEditable or focus-trapping modals
  const clickHandler = (e: MouseEvent) => {
    try {
      const target = e.target as Element | null;
      if (!target) return;
      const text = target instanceof HTMLElement ? target.innerText?.slice(0, 80) ?? null : null;
      clicks.push({
        ts: Date.now(),
        selector: buildSelector(target),
        text: text ? redactString(text) : null,
        x: e.clientX,
        y: e.clientY,
      });
    } catch { /* swallow */ }
  };
  document.addEventListener("click", clickHandler, true);
  cleanupFns.push(() => document.removeEventListener("click", clickHandler, true));

  // 2. Network trail — monkey-patch fetch
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
    const start = Date.now();
    const input = args[0];
    const init = args[1];
    const method = (init?.method ?? (typeof input !== "string" && "method" in (input as Request) ? (input as Request).method : "GET")) || "GET";
    let url = typeof input === "string" ? input : (input as Request | URL).toString();
    url = redactUrl(url);
    try {
      const res = await originalFetch(...args);
      network.push({
        ts: start,
        url,
        method,
        status: res.status,
        duration_ms: Date.now() - start,
        error: null,
      });
      return res;
    } catch (err) {
      network.push({
        ts: start,
        url,
        method,
        status: null,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? redactString(err.message) : "unknown",
      });
      throw err;
    }
  };
  cleanupFns.push(() => { window.fetch = originalFetch; });

  // 3. Console errors — monkey-patch + event listeners
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      consoleErrors.push({
        ts: Date.now(),
        level: "error",
        message: redactString(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")).slice(0, 500),
        stack: args.find((a) => a instanceof Error)
          ? redactString(((args.find((a) => a instanceof Error) as Error).stack ?? "")).slice(0, 2000)
          : null,
      });
    } catch { /* swallow */ }
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    try {
      consoleErrors.push({
        ts: Date.now(),
        level: "warn",
        message: redactString(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")).slice(0, 500),
        stack: null,
      });
    } catch { /* swallow */ }
    originalWarn(...args);
  };
  cleanupFns.push(() => { console.error = originalError; console.warn = originalWarn; });

  const onError = (ev: ErrorEvent) => {
    consoleErrors.push({
      ts: Date.now(),
      level: "error",
      message: redactString(ev.message ?? "unknown error").slice(0, 500),
      stack: ev.error?.stack ? redactString(ev.error.stack).slice(0, 2000) : null,
    });
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    consoleErrors.push({
      ts: Date.now(),
      level: "error",
      message: redactString(`unhandled rejection: ${reason}`).slice(0, 500),
      stack: ev.reason instanceof Error && ev.reason.stack
        ? redactString(ev.reason.stack).slice(0, 2000)
        : null,
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  cleanupFns.push(() => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  });

  // 4. Route trail — monkey-patch history + popstate
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  let lastRoute = location.pathname + location.search;

  const recordRouteChange = (to: string) => {
    if (to === lastRoute) return;
    routes.push({ ts: Date.now(), from: lastRoute, to });
    lastRoute = to;
  };

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPush(...args);
    recordRouteChange(location.pathname + location.search);
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplace(...args);
    recordRouteChange(location.pathname + location.search);
  };
  const onPopstate = () => recordRouteChange(location.pathname + location.search);
  window.addEventListener("popstate", onPopstate);
  cleanupFns.push(() => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPopstate);
  });

  return () => {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    installed = false;
  };
}

export function snapshotRingBuffers() {
  return {
    click_trail: clicks.snapshot(),
    network_trail: network.snapshot(),
    console_errors: consoleErrors.snapshot(),
    route_trail: routes.snapshot(),
  };
}
