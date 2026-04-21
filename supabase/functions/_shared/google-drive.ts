/**
 * Minimal Google Drive helpers for the Stakeholder Build Hub.
 *
 * Zero-blocking: when GOOGLE_SERVICE_ACCOUNT_KEY or HUB_DRIVE_FOLDER_ID is
 * unset, `loadDriveConfig()` returns null and callers should skip the push
 * step. NotebookLM mirror is optional — the Supabase pgvector mirror is the
 * load-bearing path for Ask-the-Brain.
 *
 * Auth: service-account JWT (RS256) → token endpoint exchange → Bearer token.
 * Deno's Web Crypto subtle API supports RSASSA-PKCS1-v1_5 natively, so we
 * don't need a third-party JWT lib.
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveConfig {
  /** Parsed service-account JSON (client_email + private_key). */
  serviceAccount: {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  /** Drive folder ID that NotebookLM also watches. */
  folderId: string;
}

export function loadDriveConfig(): DriveConfig | null {
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  const folderId = Deno.env.get("HUB_DRIVE_FOLDER_ID");
  if (!rawKey || !folderId) return null;
  try {
    const parsed = JSON.parse(rawKey) as {
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      serviceAccount: {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        token_uri: parsed.token_uri,
      },
      folderId,
    };
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeJsonB64Url(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * PKCS#8 → CryptoKey. Google service-account private_keys ship as PEM
 * `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function mintAccessToken(cfg: DriveConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = cfg.serviceAccount.token_uri ?? OAUTH_TOKEN_URL;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: cfg.serviceAccount.client_email,
    scope: DRIVE_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${encodeJsonB64Url(header)}.${encodeJsonB64Url(claim)}`;
  const key = await importPrivateKey(cfg.serviceAccount.private_key);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(sig))}`;

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`google token ${resp.status}: ${text.slice(0, 300)}`);
  }
  const body = (await resp.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("google token: missing access_token");
  return body.access_token;
}

/**
 * List markdown files currently in the configured folder.
 *
 * Used by hub-knowledge-sync so we can idempotently upsert:
 *   - existing-with-same-name → update content via files.update
 *   - new name               → create via files.create (multipart)
 */
export async function listFolderMarkdown(
  cfg: DriveConfig,
  accessToken: string,
): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
  const params = new URLSearchParams({
    q: `'${cfg.folderId}' in parents and trashed = false and mimeType = 'text/markdown'`,
    fields: "files(id, name, modifiedTime)",
    pageSize: "1000",
  });
  const resp = await fetch(`${DRIVE_API}/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`drive list ${resp.status}: ${text.slice(0, 300)}`);
  }
  const body = (await resp.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime: string }>;
  };
  return body.files ?? [];
}

/**
 * Upsert a markdown file in the configured folder.
 *
 * Returns the Drive file ID. Idempotency: if `existingId` is provided we
 * PATCH; otherwise we POST multipart to create.
 */
export async function upsertMarkdownFile(
  cfg: DriveConfig,
  accessToken: string,
  opts: { name: string; content: string; existingId?: string | null },
): Promise<string> {
  const boundary = "qep-hub-" + crypto.randomUUID();
  const metadata = opts.existingId
    ? { name: opts.name }
    : { name: opts.name, parents: [cfg.folderId], mimeType: "text/markdown" };

  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/markdown; charset=UTF-8",
    "",
    opts.content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const url = opts.existingId
    ? `${DRIVE_API}/upload/drive/v3/files/${opts.existingId}?uploadType=multipart`
    : `${DRIVE_API}/upload/drive/v3/files?uploadType=multipart`;

  const resp = await fetch(url, {
    method: opts.existingId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`drive upsert ${resp.status}: ${text.slice(0, 300)}`);
  }
  const parsed = (await resp.json()) as { id?: string };
  if (!parsed.id) throw new Error("drive upsert: missing id in response");
  return parsed.id;
}

export async function issueAccessToken(cfg: DriveConfig): Promise<string> {
  return await mintAccessToken(cfg);
}
