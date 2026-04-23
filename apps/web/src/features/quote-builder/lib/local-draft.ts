import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

const LOCAL_DRAFT_PREFIX = "qep.quote-builder.local-draft.";

// Keys are scoped by the authenticated user so a shared device (or a
// sign-out / sign-in in the same browser profile) never leaks one rep's
// partial draft into another rep's view.
export function buildLocalDraftKey(params: {
  userId: string;
  dealId?: string | null;
  contactId?: string | null;
}): string {
  const user = params.userId;
  if (params.dealId) return `${user}.deal:${params.dealId}`;
  if (params.contactId) return `${user}.contact:${params.contactId}`;
  return `${user}.new`;
}

export function loadLocalDraft(key: string): Partial<QuoteWorkspaceDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_DRAFT_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: Partial<QuoteWorkspaceDraft> };
    return parsed?.draft ?? null;
  } catch {
    return null;
  }
}

export function saveLocalDraft(key: string, draft: QuoteWorkspaceDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${LOCAL_DRAFT_PREFIX}${key}`,
      JSON.stringify({ draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Quota exceeded or serialization error — drop silently so a failed
    // persist never blocks the rep from entering data.
  }
}

export function clearLocalDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${LOCAL_DRAFT_PREFIX}${key}`);
  } catch {
    // ignore
  }
}

// A draft counts as "empty" when it contains nothing the rep entered —
// used to avoid overwriting a real stored draft with the builder's
// default initial state on first render.
export function isDraftEmpty(draft: Partial<QuoteWorkspaceDraft> | null): boolean {
  if (!draft) return true;
  if (draft.customerName?.trim()) return false;
  if (draft.customerCompany?.trim()) return false;
  if (draft.customerEmail?.trim()) return false;
  if (draft.customerPhone?.trim()) return false;
  if (draft.contactId) return false;
  if (draft.companyId) return false;
  if (draft.equipment && draft.equipment.length > 0) return false;
  if (draft.attachments && draft.attachments.length > 0) return false;
  if (draft.recommendation) return false;
  if (draft.voiceSummary) return false;
  if (draft.tradeAllowance && draft.tradeAllowance > 0) return false;
  if (draft.tradeValuationId) return false;
  return true;
}

export interface LocalDraftRecord {
  key: string;
  dealId: string | null;
  contactId: string | null;
  savedAt: string;
  draft: Partial<QuoteWorkspaceDraft>;
}

// Returns every non-empty local draft stored for the given user, newest
// first. Used by the Quotes list to surface "Unsaved on this device"
// drafts that never made it to the server.
export function listLocalDraftsForUser(userId: string): LocalDraftRecord[] {
  if (typeof window === "undefined" || !userId) return [];
  const prefix = `${LOCAL_DRAFT_PREFIX}${userId}.`;
  const records: LocalDraftRecord[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const storageKey = window.localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) continue;
      let parsed: { draft?: Partial<QuoteWorkspaceDraft>; savedAt?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const draft = parsed?.draft;
      if (!draft || isDraftEmpty(draft)) continue;
      const suffix = storageKey.slice(prefix.length);
      let dealId: string | null = null;
      let contactId: string | null = null;
      if (suffix.startsWith("deal:")) dealId = suffix.slice("deal:".length);
      else if (suffix.startsWith("contact:")) contactId = suffix.slice("contact:".length);
      records.push({
        key: suffix,
        dealId,
        contactId,
        savedAt: typeof parsed?.savedAt === "string" ? parsed.savedAt : "",
        draft,
      });
    }
  } catch {
    return [];
  }
  records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return records;
}
