/**
 * Wave 6.11 Flare — global provider.
 *
 * Mounts the hotkey, installs ring buffers, owns the drawer state,
 * and freezes context + screenshot + DOM snapshot at the moment of
 * capture (not submit) so the user's typing delay doesn't shift the
 * captured state.
 *
 * Wrapped in its own error boundary so a flare-layer crash never
 * cascades into the host app.
 */
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from "react";
import { installRingBuffers } from "./ringBuffers";
import { buildContext } from "./captureContext";
import { captureScreenshot, captureDomSnapshot } from "./screenshot";
import { useFlareHotkey } from "./useFlareHotkey";
import { FlareDrawer } from "./FlareDrawer";
import type { FlareContext } from "./types";

interface FlareProviderProps {
  children: ReactNode;
}

/* ── Error boundary so a Flare crash can't kill the host app ──── */

class FlareErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log directly — don't route through ring buffer to avoid recursion
    // if the crash itself originated in the ring buffer layer.
    try {
      // eslint-disable-next-line no-console
      console.log("[flare:crashed]", error?.message, info?.componentStack);
    } catch { /* swallow */ }
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}

export function FlareProvider({ children }: FlareProviderProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"bug" | "idea">("bug");
  const [context, setContext] = useState<FlareContext | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [domSnapshot, setDomSnapshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Install ring buffers once on mount
  useEffect(() => {
    const uninstall = installRingBuffers();
    return uninstall;
  }, []);

  const capture = useCallback(async (targetMode: "bug" | "idea") => {
    if (capturing || open) return;
    setCapturing(true);
    try {
      // Build context first (synchronous-ish) so we have a baseline even
      // if screenshot fails.
      const [ctx, shot, dom] = await Promise.all([
        buildContext(),
        captureScreenshot(),
        Promise.resolve(captureDomSnapshot()),
      ]);
      setContext(ctx);
      setScreenshot(shot);
      setDomSnapshot(dom);
      setMode(targetMode);
      setOpen(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[flare] capture failed:", err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, open]);

  useFlareHotkey({
    onBug: () => void capture("bug"),
    onIdea: () => void capture("idea"),
  });

  const handleClose = useCallback(() => {
    setOpen(false);
    // Clear transient state after the drawer animation
    setTimeout(() => {
      setContext(null);
      setScreenshot(null);
      setDomSnapshot(null);
    }, 300);
  }, []);

  return (
    <FlareErrorBoundary>
      {children}
      <FlareDrawer
        open={open}
        mode={mode}
        context={context}
        screenshot={screenshot}
        domSnapshot={domSnapshot}
        onClose={handleClose}
      />
    </FlareErrorBoundary>
  );
}
