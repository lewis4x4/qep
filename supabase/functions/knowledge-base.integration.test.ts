function loadLocalEnv() {
  const envFiles = [
    `${Deno.cwd()}/.env.local`,
    `${Deno.cwd()}/.secrets`,
  ];

  for (const filePath of envFiles) {
    try {
      const raw = Deno.readTextFileSync(filePath);
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        if (!key || Deno.env.get(key)) continue;
        Deno.env.set(key, value);
      }
    } catch {
      // Local env files are optional in CI and remote environments.
    }
  }

  if (!Deno.env.get("SUPABASE_URL")) {
    Deno.env.set("SUPABASE_URL", Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "");
  }
  if (!Deno.env.get("SUPABASE_ANON_KEY")) {
    Deno.env.set("SUPABASE_ANON_KEY", Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "");
  }
}

loadLocalEnv();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const EXPLICIT_ADMIN_TOKEN = Deno.env.get("KB_TEST_ADMIN_TOKEN") ?? "";
const EXPLICIT_REP_TOKEN = Deno.env.get("KB_TEST_REP_TOKEN") ?? "";
const DEMO_PASSWORD = Deno.env.get("QEP_DEMO_PASSWORD") ?? "QepDemo!2026";
const strictMode =
  (Deno.env.get("KB_INTEGRATION_REQUIRED") ?? "") === "true" ||
  (Deno.env.get("CI") ?? "") === "true";

async function signInForTest(email: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: DEMO_PASSWORD,
    }),
  });

  if (!response.ok) {
    return "";
  }

  const payload = await response.json().catch(() => ({}));
  return typeof payload?.access_token === "string" ? payload.access_token : "";
}

const ADMIN_TOKEN = EXPLICIT_ADMIN_TOKEN || await signInForTest("demo.admin@qep-demo.local");
const REP_TOKEN = EXPLICIT_REP_TOKEN || await signInForTest("demo.rep@qep-demo.local");

const canRunLive =
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0 &&
  ADMIN_TOKEN.length > 0 &&
  REP_TOKEN.length > 0;

const missingEnv = [
  ["SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
  ["KB_TEST_ADMIN_TOKEN", ADMIN_TOKEN],
  ["KB_TEST_REP_TOKEN", REP_TOKEN],
].filter(([, value]) => value.length === 0).map(([name]) => name);

type UploadedDocument = {
  documentId: string;
  title: string;
};

type ChatResult = {
  text: string;
  sources: Array<{
    id: string;
    title: string;
    confidence: number;
    kind: string;
    excerpt?: string;
    sectionTitle?: string;
    pageNumber?: number;
    contextExcerpt?: string;
  }>;
};

async function uploadTextDocument(
  token: string,
  input: {
    title: string;
    content: string;
    audience?: string;
    status?: string;
  },
): Promise<Response> {
  const file = new File([input.content], `${input.title}.txt`, { type: "text/plain" });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", input.title);
  if (input.audience) formData.append("audience", input.audience);
  if (input.status) formData.append("status", input.status);

  return fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: formData,
  });
}

async function deleteDocument(token: string, documentId: string): Promise<void> {
  await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/document-admin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "delete",
      documentId,
    }),
  });
}

async function chat(token: string, message: string): Promise<ChatResult> {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, history: [] }),
  });

  if (!response.ok) {
    throw new Error(`chat failed (${response.status})`);
  }

  const body = await response.text();
  let text = "";
  let sources: ChatResult["sources"] = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const payload = trimmed.slice(6);
    if (payload === "[DONE]") continue;
    const parsed = JSON.parse(payload) as {
      text?: string;
      sources?: ChatResult["sources"];
    };
    if (parsed.text) text += parsed.text;
    if (parsed.sources) sources = parsed.sources;
  }

  return { text, sources };
}

async function supportsTier1ChunkSchema(token: string): Promise<boolean> {
  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/chunks?select=chunk_kind,parent_chunk_id&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    },
  );

  return response.ok;
}

function liveTest(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    ignore: !canRunLive,
    sanitizeResources: false,
    sanitizeOps: false,
    fn,
  });
}

if (strictMode && !canRunLive) {
  Deno.test("knowledge base integration env is configured", () => {
    throw new Error(
      `KB integration tests require live credentials. Missing: ${missingEnv.join(", ")}`,
    );
  });
}

liveTest("rep cannot upload KB documents", async () => {
  const response = await uploadTextDocument(REP_TOKEN, {
    title: `kb-rep-denied-${crypto.randomUUID().slice(0, 8)}`,
    content: "This should be rejected for rep uploads.",
    audience: "company_wide",
    status: "published",
  });

  if (response.status !== 403) {
    throw new Error(`Expected 403 for rep upload, got ${response.status}`);
  }
});

liveTest("published upload is retrievable by rep chat", async () => {
  const uniquePhrase = `QEP_TEST_CORE_VALUE_${crypto.randomUUID().slice(0, 8)}`;
  const title = `kb-public-${crypto.randomUUID().slice(0, 8)}`;
  const uploaded: UploadedDocument[] = [];

  try {
    const uploadResponse = await uploadTextDocument(ADMIN_TOKEN, {
      title,
      content: `Our testing principle is ${uniquePhrase}. Always return to the source of truth before acting.`,
      audience: "company_wide",
      status: "published",
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with ${uploadResponse.status}`);
    }

    const payload = await uploadResponse.json();
    uploaded.push({ documentId: payload.documentId, title });

    const result = await chat(REP_TOKEN, `What is ${uniquePhrase}?`);
    if (!result.sources.some((source) => source.title.includes(title))) {
      throw new Error(`Expected source list to include ${title}`);
    }
  } finally {
    await Promise.all(uploaded.map((doc) => deleteDocument(ADMIN_TOKEN, doc.documentId)));
  }
});

liveTest("finance audience document does not leak to rep chat", async () => {
  const secretPhrase = `QEP_FINANCE_SECRET_${crypto.randomUUID().slice(0, 8)}`;
  const title = `kb-finance-${crypto.randomUUID().slice(0, 8)}`;
  const uploaded: UploadedDocument[] = [];

  try {
    const uploadResponse = await uploadTextDocument(ADMIN_TOKEN, {
      title,
      content: `Restricted finance-only policy marker: ${secretPhrase}.`,
      audience: "finance",
      status: "published",
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with ${uploadResponse.status}`);
    }

    const payload = await uploadResponse.json();
    uploaded.push({ documentId: payload.documentId, title });

    const result = await chat(REP_TOKEN, `What is ${secretPhrase}?`);
    if (result.sources.some((source) => source.title.includes(title))) {
      throw new Error(`Rep should not receive finance document source ${title}`);
    }
    if (result.text.includes(secretPhrase)) {
      throw new Error("Rep chat leaked the finance-only secret phrase");
    }
  } finally {
    await Promise.all(uploaded.map((doc) => deleteDocument(ADMIN_TOKEN, doc.documentId)));
  }
});

liveTest("structured uploads surface section context for paragraph hits", async () => {
  if (!await supportsTier1ChunkSchema(REP_TOKEN)) {
    return;
  }

  const uniquePhrase = `maple relief shutdown sequence ${crypto.randomUUID().slice(0, 8)}`;
  const title = `kb-structured-${crypto.randomUUID().slice(0, 8)}`;
  const uploaded: UploadedDocument[] = [];

  try {
    const uploadResponse = await uploadTextDocument(ADMIN_TOKEN, {
      title,
      content: [
        "# Startup Procedure",
        "",
        "Always verify the service board before energizing the machine.",
        "",
        "## Shutdown Procedure",
        "",
        `Before shutdown, follow the ${uniquePhrase}, release hydraulic pressure, and inspect the valve block for trapped heat.`,
      ].join("\n"),
      audience: "company_wide",
      status: "published",
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with ${uploadResponse.status}`);
    }

    const payload = await uploadResponse.json();
    uploaded.push({ documentId: payload.documentId, title });

    const result = await chat(REP_TOKEN, `What does the ${uniquePhrase} say?`);
    const source = result.sources.find((item) => item.title.includes(title));
    if (!source) {
      throw new Error(`Expected source list to include ${title}`);
    }
    if (source.sectionTitle !== "Shutdown Procedure") {
      throw new Error(`Expected Shutdown Procedure section, got ${source.sectionTitle ?? "missing"}`);
    }
    if (!source.contextExcerpt?.includes("release hydraulic pressure")) {
      throw new Error("Expected context excerpt to include the parent section content");
    }
  } finally {
    await Promise.all(uploaded.map((doc) => deleteDocument(ADMIN_TOKEN, doc.documentId)));
  }
});

Deno.test("rerank fallback preserves SQL order when model output is invalid", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{bad-json" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;

  try {
    const ranked = await rerankKbEvidence(
      "shutdown procedure",
      [
        {
          source_type: "document",
          source_id: "doc-1",
          source_title: "Hydraulic Shutdown",
          excerpt: "release hydraulic pressure",
          confidence: 0.93,
          access_class: "company_wide",
        },
        {
          source_type: "document",
          source_id: "doc-2",
          source_title: "Startup Notes",
          excerpt: "power on",
          confidence: 0.62,
          access_class: "company_wide",
        },
      ] satisfies KbEvidenceRow[],
      { loggerTag: "kb.integration" },
    );

    assertEquals(ranked.map((row) => row.source_id), ["doc-1", "doc-2"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", originalKey);
  }
});
import { assertEquals } from "jsr:@std/assert@1";

import { rerankKbEvidence, type KbEvidenceRow } from "./_shared/kb-retrieval.ts";
