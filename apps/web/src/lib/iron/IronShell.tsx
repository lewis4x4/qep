/**
 * Wave 7 Iron Companion — top-level shell.
 *
 * Mounts (once, in App.tsx, inside the auth-gated tree):
 *   • IronCorner — draggable, corner-snapping wrapper around IronAvatar
 *   • IronBar    — Cmd+I command palette + streaming chat
 *   • FlowEngineUI — slot-fill walkthrough when a flow is active
 *   • IronUndoToast — 60s undo window after successful execute
 *
 * Z-index discipline:
 *   FlareDrawer  9999  (always wins — bug reports cannot be blocked)
 *   IronCorner   9998
 *   IronBar      9997
 *   FlowEngineUI 9996
 *
 * The avatar reads its visual state from the global IronPresence bus, which
 * lets ANY part of the app push state (long mutations, captured errors,
 * workspace switches, etc.) — not just Iron's own classify/think/speak loop.
 */
import { useIronStore } from "./store";
import { IronCorner } from "./IronCorner";
import { IronBar } from "./IronBar";
import { IronContextualAssistantSheet } from "./IronContextualAssistant";
import { FlowEngineUI } from "./FlowEngineUI";
import { IronUndoToast } from "./IronUndoToast";
import { useIronPresenceState } from "./presence";
import { IronGlobalSubscribers } from "./IronGlobalSubscribers";

function IronShellInner() {
  const { state, openBar, toggleCollapsed } = useIronStore();
  const presenceState = useIronPresenceState();
  return (
    <>
      <IronGlobalSubscribers />
      <IronCorner
        state={presenceState}
        onClick={openBar}
        collapsed={state.collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <IronContextualAssistantSheet />
      <IronBar />
      {state.activeFlow && <FlowEngineUI />}
      <IronUndoToast />
    </>
  );
}

export function IronShell() {
  return <IronShellInner />;
}

export default IronShell;
