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
  IronLaunchContext,
} from "./types";
import type { SpeakerFingerprint } from "./voice/voiceFingerprint";

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
  contextualOpen: boolean;
  conversationId: string | null;
  avatarState: IronAvatarState;
  activeFlow: IronActiveFlow | null;
  undoToast: IronUndoToast | null;
  errorBanner: string | null;
  /** v1.2: whether Iron should speak responses out loud (TTS). Persisted to localStorage. */
  narrationEnabled: boolean;
  /** v1.2: most recent input mode — drives auto-narration heuristic. */
  lastInputMode: "text" | "voice";
  /** v1.4: canonical speaker fingerprint for the current session. Captured on the first voice utterance, compared against subsequent utterances for multi-voice detection. Cleared when the bar closes. */
  canonicalFingerprint: SpeakerFingerprint | null;
  /** v1.4: true when a recently-captured fingerprint did not match the canonical. Cleared when the user dismisses the banner. */
  multiVoiceWarning: boolean;
  /** v7.1: avatar corner-chip collapsed flag, persisted to localStorage. */
  collapsed: boolean;
  /** v7.1: streaming chat message thread for the active conversation. */
  chatMessages: IronChatMessage[];
  activeContext: IronLaunchContext | null;
  draftPrompt: string;
  contextNonce: number;
}

/**
 * v7.1: a single message in the IronBar streaming chat thread. Lives in
 * client memory only — durable copy is in iron_messages on the server.
 */
export interface IronChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** True while the assistant message is still streaming in. */
  pending?: boolean;
  /** Citation chips returned with the assistant message. */
  citations?: Array<{
    id: string;
    title: string;
    kind: "document" | "crm" | "service_kb" | "web";
    marker?: string;
    url?: string;
    excerpt?: string;
  }>;
  createdAt: number;
}

const NARRATION_LS_KEY = "iron:narration_enabled";
const COLLAPSED_LS_KEY = "iron:avatar_collapsed";

function loadNarrationPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(NARRATION_LS_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

function saveNarrationPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NARRATION_LS_KEY, enabled ? "1" : "0");
  } catch {
    /* noop */
  }
}

function loadCollapsedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsedPref(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_LS_KEY, collapsed ? "1" : "0");
  } catch {
    /* noop */
  }
}

const initialState: IronState = {
  barOpen: false,
  contextualOpen: false,
  conversationId: null,
  avatarState: "idle",
  activeFlow: null,
  undoToast: null,
  errorBanner: null,
  narrationEnabled: loadNarrationPref(),
  lastInputMode: "text",
  canonicalFingerprint: null,
  multiVoiceWarning: false,
  collapsed: loadCollapsedPref(),
  chatMessages: [],
  activeContext: null,
  draftPrompt: "",
  contextNonce: 0,
};

type Action =
  | { type: "OPEN_BAR" }
  | { type: "CLOSE_BAR" }
  | { type: "OPEN_CONTEXTUAL_ASSISTANT"; context: IronLaunchContext }
  | { type: "CLOSE_CONTEXTUAL_ASSISTANT" }
  | { type: "SET_ACTIVE_CONTEXT"; context: IronLaunchContext }
  | { type: "SEED_DRAFT_PROMPT"; text: string }
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
  | { type: "SET_ERROR"; message: string | null }
  | { type: "SET_NARRATION_ENABLED"; enabled: boolean }
  | { type: "SET_LAST_INPUT_MODE"; mode: "text" | "voice" }
  | { type: "SET_CANONICAL_FINGERPRINT"; fingerprint: SpeakerFingerprint }
  | { type: "RESET_CANONICAL_FINGERPRINT" }
  | { type: "SET_MULTI_VOICE_WARNING"; warning: boolean }
  | { type: "TOGGLE_COLLAPSED" }
  | { type: "SET_COLLAPSED"; collapsed: boolean }
  | { type: "CHAT_APPEND"; message: IronChatMessage }
  | { type: "CHAT_PATCH_LAST"; patch: Partial<IronChatMessage> }
  | { type: "CHAT_RESET" };

function reducer(state: IronState, action: Action): IronState {
  switch (action.type) {
    case "OPEN_BAR":
      return { ...state, barOpen: true, contextualOpen: false };
    case "CLOSE_BAR":
      // v1.4: closing the bar ends the speaker session — reset the canonical
      // fingerprint and clear any standing multi-voice warning so the next
      // session starts clean.
      return {
        ...state,
        barOpen: false,
        canonicalFingerprint: null,
        multiVoiceWarning: false,
      };
    case "OPEN_CONTEXTUAL_ASSISTANT":
      return {
        ...state,
        barOpen: false,
        contextualOpen: true,
        activeContext: action.context,
        draftPrompt: action.context.draftPrompt,
        contextNonce: Date.now(),
      };
    case "CLOSE_CONTEXTUAL_ASSISTANT":
      return {
        ...state,
        contextualOpen: false,
      };
    case "SET_ACTIVE_CONTEXT":
      return {
        ...state,
        activeContext: action.context,
        draftPrompt: action.context.draftPrompt,
        contextNonce: Date.now(),
      };
    case "SEED_DRAFT_PROMPT":
      return {
        ...state,
        draftPrompt: action.text,
        contextNonce: Date.now(),
      };
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
    case "SET_NARRATION_ENABLED":
      saveNarrationPref(action.enabled);
      return { ...state, narrationEnabled: action.enabled };
    case "SET_LAST_INPUT_MODE":
      return { ...state, lastInputMode: action.mode };
    case "SET_CANONICAL_FINGERPRINT":
      return { ...state, canonicalFingerprint: action.fingerprint };
    case "RESET_CANONICAL_FINGERPRINT":
      return { ...state, canonicalFingerprint: null, multiVoiceWarning: false };
    case "SET_MULTI_VOICE_WARNING":
      return { ...state, multiVoiceWarning: action.warning };
    case "TOGGLE_COLLAPSED": {
      const next = !state.collapsed;
      saveCollapsedPref(next);
      return { ...state, collapsed: next };
    }
    case "SET_COLLAPSED":
      saveCollapsedPref(action.collapsed);
      return { ...state, collapsed: action.collapsed };
    case "CHAT_APPEND":
      return { ...state, chatMessages: [...state.chatMessages, action.message] };
    case "CHAT_PATCH_LAST": {
      if (state.chatMessages.length === 0) return state;
      const next = state.chatMessages.slice();
      const lastIdx = next.length - 1;
      next[lastIdx] = { ...next[lastIdx], ...action.patch };
      return { ...state, chatMessages: next };
    }
    case "CHAT_RESET":
      return { ...state, chatMessages: [], conversationId: null };
    default:
      return state;
  }
}

interface IronStoreApi {
  state: IronState;
  openBar: () => void;
  closeBar: () => void;
  openContextualAssistant: (context: IronLaunchContext) => void;
  closeContextualAssistant: () => void;
  setActiveContext: (context: IronLaunchContext) => void;
  seedDraftPrompt: (text: string) => void;
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
  setNarrationEnabled: (enabled: boolean) => void;
  setLastInputMode: (mode: "text" | "voice") => void;
  setCanonicalFingerprint: (fingerprint: SpeakerFingerprint) => void;
  resetCanonicalFingerprint: () => void;
  setMultiVoiceWarning: (warning: boolean) => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  chatAppend: (message: IronChatMessage) => void;
  chatPatchLast: (patch: Partial<IronChatMessage>) => void;
  chatReset: () => void;
}

const IronStoreContext = createContext<IronStoreApi | null>(null);

export function IronStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Latest dispatch lives in a ref so the callback bag below can be built
  // exactly once. If we rebuilt the bag on every state change, every
  // dispatched action would invalidate every consumer's useEffect deps,
  // which is exactly the infinite-render-loop trap that bit IronBar's
  // streaming chat patcher.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Built once, frozen reference for the lifetime of the provider.
  const callbacksRef = useRef<Omit<IronStoreApi, "state"> | null>(null);
  if (callbacksRef.current === null) {
    const d = (action: Action) => dispatchRef.current(action);
    callbacksRef.current = {
      openBar: () => d({ type: "OPEN_BAR" }),
      closeBar: () => d({ type: "CLOSE_BAR" }),
      openContextualAssistant: (context) => d({ type: "OPEN_CONTEXTUAL_ASSISTANT", context }),
      closeContextualAssistant: () => d({ type: "CLOSE_CONTEXTUAL_ASSISTANT" }),
      setActiveContext: (context) => d({ type: "SET_ACTIVE_CONTEXT", context }),
      seedDraftPrompt: (text) => d({ type: "SEED_DRAFT_PROMPT", text }),
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
      setNarrationEnabled: (enabled) => d({ type: "SET_NARRATION_ENABLED", enabled }),
      setLastInputMode: (mode) => d({ type: "SET_LAST_INPUT_MODE", mode }),
      setCanonicalFingerprint: (fingerprint) => d({ type: "SET_CANONICAL_FINGERPRINT", fingerprint }),
      resetCanonicalFingerprint: () => d({ type: "RESET_CANONICAL_FINGERPRINT" }),
      setMultiVoiceWarning: (warning) => d({ type: "SET_MULTI_VOICE_WARNING", warning }),
      toggleCollapsed: () => d({ type: "TOGGLE_COLLAPSED" }),
      setCollapsed: (collapsed) => d({ type: "SET_COLLAPSED", collapsed }),
      chatAppend: (message) => d({ type: "CHAT_APPEND", message }),
      chatPatchLast: (patch) => d({ type: "CHAT_PATCH_LAST", patch }),
      chatReset: () => d({ type: "CHAT_RESET" }),
    };
  }

  // The api object identity changes when state changes (so consumers see
  // fresh state), but every callback inside is a stable reference taken
  // from callbacksRef. Effects that depend on the callbacks no longer
  // re-fire on every state mutation.
  const api = useMemo<IronStoreApi>(() => ({
    state,
    ...callbacksRef.current!,
  }), [state]);

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
