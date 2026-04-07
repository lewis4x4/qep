/**
 * Wave 7 Iron Companion — top-level shell.
 *
 * Mounts the IronStoreProvider, the corner avatar, the command palette,
 * the active flow modal, and the undo toast in the right z-index order:
 *
 *   FlareDrawer  9999  (always wins — bug reports cannot be blocked)
 *   IronAvatar   9998
 *   IronBar      9997
 *   FlowEngineUI 9996
 *
 * Mount this once inside the auth-gated tree (App.tsx). It self-manages
 * keyboard shortcut + visibility.
 */
import { IronStoreProvider, useIronStore } from "./store";
import { IronAvatar } from "./IronAvatar";
import { IronBar } from "./IronBar";
import { FlowEngineUI } from "./FlowEngineUI";
import { IronUndoToast } from "./IronUndoToast";

function IronShellInner() {
  const { state, openBar } = useIronStore();
  return (
    <>
      <IronAvatar state={state.avatarState} onClick={openBar} />
      <IronBar />
      {state.activeFlow && <FlowEngineUI />}
      <IronUndoToast />
    </>
  );
}

export function IronShell() {
  return (
    <IronStoreProvider>
      <IronShellInner />
    </IronStoreProvider>
  );
}
