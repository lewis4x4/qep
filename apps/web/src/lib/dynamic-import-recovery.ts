const RECOVERY_PREFIX = "qep:dynamic-import-recovery:";
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

export function isDynamicImportLoadError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  if (!message) return false;

  return [
    "failed to fetch dynamically imported module",
    "importing a module script failed",
    "failed to load module script",
    "chunkloaderror",
    "loading chunk",
  ].some((needle) => message.includes(needle));
}

export function shouldReloadForDynamicImportFailure(
  storage: StorageLike,
  path: string,
  now = Date.now(),
): boolean {
  const key = `${RECOVERY_PREFIX}${path}`;
  const raw = storage.getItem(key);
  const lastAttempt = raw ? Number(raw) : Number.NaN;

  if (Number.isFinite(lastAttempt) && now - lastAttempt < RECOVERY_COOLDOWN_MS) {
    return false;
  }

  storage.setItem(key, String(now));
  return true;
}

function reloadForDynamicImportFailure(path: string): boolean {
  try {
    if (!shouldReloadForDynamicImportFailure(window.sessionStorage, path)) {
      return false;
    }
  } catch {
    // If sessionStorage is unavailable, prefer a single optimistic reload.
  }

  window.location.reload();
  return true;
}

let installed = false;

export function installDynamicImportRecovery(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const recover = (error: unknown): boolean => {
    if (!isDynamicImportLoadError(error)) {
      return false;
    }
    return reloadForDynamicImportFailure(window.location.pathname);
  };

  window.addEventListener("vite:preloadError", (event) => {
    const viteEvent = event as Event & {
      payload?: unknown;
      preventDefault: () => void;
    };
    if (recover(viteEvent.payload)) {
      viteEvent.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    if (recover(event.error ?? event.message)) {
      event.preventDefault();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (recover(event.reason)) {
      event.preventDefault();
    }
  });
}
