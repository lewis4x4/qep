/**
 * Wave 7 Iron Companion — client store via React context + useReducer.
 *
 * No external state library (no Zustand). Tracks:
 *   • Whether the IronBar (command palette) is open
 *   • The active flow run-in-progress (slots being filled)
 *   • Avatar visual state
 *   • Undo toast queue (one at a time for now)
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  IronAvatarState,
  IronFlowDefinitionLite,
} from "./types";

export interface IronUndoToast {
  run_id: string;
  flow_label: string;
  flow_slug: string;
  result: Record<string, unknown>;
  expires_at: number; // wall-clock ms
}

export interface IronActiveFlow {
  flow: IronFlowDefinitionLite;
  conversation_id: string;
  slot_values: Record<string, unknown>;
  client_slot_updated_at: Record<string, string>;
  current_slot_index: number;
  high_value_confirmation_cents?: number;
  total_cents: number;
  /** Stable across the slot-fill session for idempotency. */
  idempotency_key: string;
}

interface IronState {
  barOpen: boolean;
  conversationId: string | null;
  avatarState: IronAvatarState;
  activeFlow: IronActiveFlow | null;
  undoToast: IronUndoToast | null;
  errorBanner: string | null;
}

const initialState: IronState = {
  barOpen: false,
  conversationId: null,
  avatarState: "idle",
  activeFlow: null,
  undoToast: null,
  errorBanner: null,
};

type Action =
  | { type: "OPEN_BAR" }
  | { type: "CLOSE_BAR" }
  | { type: "SET_AVATAR"; state: IronAvatarState }
  | { type: "SET_CONVERSATION"; id: string }
  | { type: "START_FLOW"; flow: IronFlowDefinitionLite; conversationId: string; idempotencyKey: string; prefilled: Record<string, unknown> }
  | { type: "SET_SLOT"; slot_id: string; value: unknown; updated_at?: string }
  | { type: "ADVANCE_SLOT" }
  | { type: "BACK_SLOT" }
  | { type: "SET_HIGH_VALUE_CONFIRMATION"; cents: number }
  | { type: "SET_TOTAL_CENTS"; cents: number }
  | { type: "CANCEL_FLOW" }
  | { type: "FLOW_SUCCEEDED"; toast: IronUndoToast }
  | { type: "DISMISS_UNDO_TOAST" }
  | { type: "SET_ERROR"; message: string | null };

function reducer(state: IronState, action: Action): IronState {
  switch (action.type) {
    case "OPEN_BAR":
      return { ...state, barOpen: true };
    case "CLOSE_BAR":
      return { ...state, barOpen: false };
    case "SET_AVATAR":
      return { ...state, avatarState: action.state };
    case "SET_CONVERSATION":
      return { ...state, conversationId: action.id };
    case "START_FLOW":
      return {
        ...state,
        barOpen: false,
        conversationId: action.conversationId,
        avatarState: "flow_active",
        activeFlow: {
          flow: action.flow,
          conversation_id: action.conversationId,
          slot_values: { ...action.prefilled },
          client_slot_updated_at: {},
          current_slot_index: 0,
          total_cents: 0,
          idempotency_key: action.idempotencyKey,
        },
      };
    case "SET_SLOT": {
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: {
          ...state.activeFlow,
          slot_values: { ...state.activeFlow.slot_values, [action.slot_id]: action.value },
          client_slot_updated_at: action.updated_at
            ? { ...state.activeFlow.client_slot_updated_at, [action.slot_id]: action.updated_at }
            : state.activeFlow.client_slot_updated_at,
        },
      };
    }
    case "ADVANCE_SLOT": {
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: {
          ...state.activeFlow,
          current_slot_index: state.activeFlow.current_slot_index + 1,
        },
      };
    }
    case "BACK_SLOT": {
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: {
          ...state.activeFlow,
          current_slot_index: Math.max(0, state.activeFlow.current_slot_index - 1),
        },
      };
    }
    case "SET_HIGH_VALUE_CONFIRMATION": {
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: { ...state.activeFlow, high_value_confirmation_cents: action.cents },
      };
    }
    case "SET_TOTAL_CENTS": {
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: { ...state.activeFlow, total_cents: action.cents },
      };
    }
    case "CANCEL_FLOW":
      return { ...state, activeFlow: null, avatarState: "idle" };
    case "FLOW_SUCCEEDED":
      return {
        ...state,
        activeFlow: null,
        avatarState: "success",
        undoToast: action.toast,
      };
    case "DISMISS_UNDO_TOAST":
      return { ...state, undoToast: null, avatarState: "idle" };
    case "SET_ERROR":
      return { ...state, errorBanner: action.message };
    default:
      return state;
  }
}

interface IronStoreApi {
  state: IronState;
  openBar: () => void;
  closeBar: () => void;
  setAvatar: (state: IronAvatarState) => void;
  setConversationId: (id: string) => void;
  startFlow: (input: { flow: IronFlowDefinitionLite; conversationId: string; prefilled?: Record<string, unknown> }) => void;
  setSlot: (slot_id: string, value: unknown, updated_at?: string) => void;
  advanceSlot: () => void;
  backSlot: () => void;
  setHighValueConfirmation: (cents: number) => void;
  setTotalCents: (cents: number) => void;
  cancelFlow: () => void;
  flowSucceeded: (toast: IronUndoToast) => void;
  dismissUndoToast: () => void;
  setError: (message: string | null) => void;
}

const IronStoreContext = createContext<IronStoreApi | null>(null);

export function IronStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Stable callbacks via refs so consumers don't re-render unnecessarily
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const api = useMemo<IronStoreApi>(() => {
    const d = (action: Action) => dispatchRef.current(action);
    return {
      state,
      openBar: () => d({ type: "OPEN_BAR" }),
      closeBar: () => d({ type: "CLOSE_BAR" }),
      setAvatar: (s) => d({ type: "SET_AVATAR", state: s }),
      setConversationId: (id) => d({ type: "SET_CONVERSATION", id }),
      startFlow: ({ flow, conversationId, prefilled }) =>
        d({
          type: "START_FLOW",
          flow,
          conversationId,
          idempotencyKey: crypto.randomUUID(),
          prefilled: prefilled ?? {},
        }),
      setSlot: (slot_id, value, updated_at) => d({ type: "SET_SLOT", slot_id, value, updated_at }),
      advanceSlot: () => d({ type: "ADVANCE_SLOT" }),
      backSlot: () => d({ type: "BACK_SLOT" }),
      setHighValueConfirmation: (cents) => d({ type: "SET_HIGH_VALUE_CONFIRMATION", cents }),
      setTotalCents: (cents) => d({ type: "SET_TOTAL_CENTS", cents }),
      cancelFlow: () => d({ type: "CANCEL_FLOW" }),
      flowSucceeded: (toast) => d({ type: "FLOW_SUCCEEDED", toast }),
      dismissUndoToast: () => d({ type: "DISMISS_UNDO_TOAST" }),
      setError: (message) => d({ type: "SET_ERROR", message }),
    };
  }, [state]);

  return <IronStoreContext.Provider value={api}>{children}</IronStoreContext.Provider>;
}

export function useIronStore(): IronStoreApi {
  const ctx = useContext(IronStoreContext);
  if (!ctx) {
    throw new Error("useIronStore must be used within an IronStoreProvider");
  }
  return ctx;
}

/** Convenience selector hook for components that only care about a slice. */
export function useIronState<T>(selector: (s: IronState) => T): T {
  const { state } = useIronStore();
  return useMemo(() => selector(state), [state, selector]);
}

/** Helper to compute total cents from line_items shape. */
export function computeIronFlowTotalCents(slots: Record<string, unknown>): number {
  const lineItems = slots.line_items;
  if (!Array.isArray(lineItems)) return 0;
  let total = 0;
  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const qty = Number(item.quantity ?? 1);
    const price = Number(item.unit_price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price) && price > 0) {
      total += Math.round(qty * price * 100);
    }
  }
  return total;
}

/** Used by callers that need a stable click handler — keeps dispatch stable. */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
