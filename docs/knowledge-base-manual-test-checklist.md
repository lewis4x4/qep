# Knowledge base and chat — manual test checklist

Use this after migrations (including `042_hybrid_retrieve_document_evidence.sql`) are applied and edge functions `chat`, `ingest`, and `document-admin` are deployed.

Record pass/fail, notes, and **trace IDs** from chat errors or the footer (`Trace: …`) when filing issues.

---

## 1. Reliability and retrieval

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | As **admin** or **owner**, upload an HR-style handbook (PDF/DOCX with real text). Set **audience** `company_wide`, **status** `published`. | Document appears as published; ingest completes without `ingest_failed`. |
| 1.2 | Sign in as **rep**. Open **Knowledge Chat** (no QRM query params). Ask: *What are our core values?* | Grounded answer from the handbook; at least one **Document** source in the source list; no generic “connection” error. |
| 1.3 | Repeat with a paraphrased question (e.g. *core values policy*) | Still grounded if content supports it; sources remain **Document** where appropriate. |
| 1.4 | **Embedding failure (strict)** — set Edge Function secret/env `CHAT_FAIL_CLOSED_ON_EMBEDDING` = `true` on **chat**, redeploy, send any message. | HTTP **503**, JSON `error.code` = `EMBEDDING_FAILED`, message mentions embedding; UI shows that message + **Reference: &lt;trace_id&gt;**. |
| 1.5 | Remove `CHAT_FAIL_CLOSED_ON_EMBEDDING` (or set not `true`), redeploy. Break or revoke OpenAI key **or** simulate API failure. | Chat may still respond using keyword/FTS; **amber banner**: semantic search unavailable / text matching only; trace id in banner. |
| 1.6 | Restore normal embedding config. | Handbook question again returns semantic + citation as in 1.2. |

---

## 2. Access control (audience + no leakage)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | As **admin**, upload or classify a document as **audience** `finance`, **published**, with obvious finance-only wording in the body. | Document saved and published. |
| 2.2 | As **rep**, ask a question that should only be answered from that finance doc. | Answer does **not** expose finance content; assistant should say it does not have that in the **accessible** knowledge base; **no** hint that restricted docs exist. |
| 2.3 | As **manager** or **owner**, ask the same finance question. | Grounded answer with **Document** citation(s) to the finance doc (manager allowed for `finance` per policy). |

---

## 3. Upload and classification workflow

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | As **manager**, upload a document via Admin knowledge panel. | **Audience** forced to company-wide messaging; upload completes with **status** `pending_review` (not published). |
| 3.2 | As **manager**, confirm UI does not offer publish / arbitrary audience (only admin copy). | No way for manager to publish or set non–company-wide audience. |
| 3.3 | As **admin** or **owner**, open document list, filter **pending review**, publish the manager upload (via edit / governance actions calling **document-admin**). | Status becomes **published**; document visible to reps per audience rules. |
| 3.4 | As **admin** or **owner**, **reclassify** audience and/or **archive** a doc. | Changes persist; list badges reflect audience/status. |
| 3.5 | (Optional DB) Inspect `document_audit_events` for the document. | Rows for `uploaded`, and after governance actions `published` / `approved` / `archived` / `reclassified` / `status_changed` as applicable. |

---

## 4. Contextual QRM knowledge

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Open a **contact**, **deal**, or **company** that has QRM history and use **Open chat** / link to `/chat?...` with the matching ids. | **Context banner** indicates customer context; chat subtitle mentions documents + this context. |
| 4.2 | Ask something customer-specific (e.g. recent deals, follow-ups, profile summary). | Answer uses **QRM** sources where applicable and **Document** for policy; citations distinguish **QRM** vs **Document**. |
| 4.3 | Ask a policy question in the same contextual session. | **Document** evidence can dominate where appropriate; if QRM and docs conflict, model instruction is to state which source it used. |
| 4.4 | As **rep**, open contextual chat for a customer **outside** their linked QRM scope (if your data model allows). | No disclosure of restricted QRM facts; no fabricated customer data. |

---

## 5. Regression quick checks

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Rate limit: send many chat messages quickly (or lower limit in dev). | **429** / `RATE_LIMITED` or rate-limit check message; not a generic network error. |
| 5.2 | Signed out or expired session → chat. | **401** / `AUTH_REQUIRED`; clear sign-in message. |
| 5.3 | Main `/chat` with **no** query params → ask product question. | Document-only grounding; no QRM sources unless user pasted context. |

---

## Reference — Edge Function env

| Variable | Purpose |
|----------|---------|
| `CHAT_FAIL_CLOSED_ON_EMBEDDING=true` | Return **503** + `EMBEDDING_FAILED` when OpenAI embeddings fail (test 1.4). Leave unset/false in production for keyword/FTS fallback + UI warning. |
