const encoder = new TextEncoder();

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  signedUrlTtlSeconds: number;
  uploadUrlTtlSeconds: number;
}

export interface R2PresignedUrlResult {
  url: string;
  expiresAt: string;
  bucket: string;
  key: string;
}

export interface R2HeadObjectResult {
  ok: boolean;
  status: number;
  contentLength: number | null;
  contentType: string | null;
  etag: string | null;
  error?: string;
}

export class R2StorageConfigurationError extends Error {
  constructor(message = "R2 quote PDF storage is not configured") {
    super(message);
    this.name = "R2StorageConfigurationError";
  }
}

function integerEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readR2StorageConfig(): R2StorageConfig {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")?.trim() ?? "";
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")?.trim() ?? "";
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")?.trim() ?? "";
  const bucket = Deno.env.get("R2_BUCKET_QUOTE_PDFS")?.trim() ?? "";
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new R2StorageConfigurationError();
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    signedUrlTtlSeconds: integerEnv("R2_SIGNED_URL_TTL_SECONDS", 300),
    uploadUrlTtlSeconds: integerEnv("R2_UPLOAD_URL_TTL_SECONDS", 600),
  };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: string | ArrayBuffer,
  value: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

async function signingKey(
  secretAccessKey: string,
  dateStamp: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function amzDate(date: Date): { amz: string; stamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, stamp: iso.slice(0, 8) };
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodePathSegment).join("/");
}

function canonicalQuery(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    )
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
}

async function presignR2ObjectUrl(input: {
  config: R2StorageConfig;
  method: "GET" | "PUT" | "HEAD";
  key: string;
  ttlSeconds: number;
  now?: Date;
}): Promise<R2PresignedUrlResult> {
  const now = input.now ?? new Date();
  const { amz, stamp } = amzDate(now);
  const host = `${input.config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePathSegment(input.config.bucket)}/${
    encodeObjectKey(input.key)
  }`;
  const credentialScope = `${stamp}/auto/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(Math.max(1, Math.floor(input.ttlSeconds))),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery(params),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const canonicalRequestHash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(canonicalRequest),
  ).then(toHex);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");
  const signature = await hmacSha256(
    await signingKey(input.config.secretAccessKey, stamp),
    stringToSign,
  ).then(toHex);
  params.set("X-Amz-Signature", signature);

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery(params)}`,
    expiresAt: new Date(
      now.getTime() + Math.max(1, Math.floor(input.ttlSeconds)) * 1000,
    ).toISOString(),
    bucket: input.config.bucket,
    key: input.key,
  };
}

export async function createR2PutUrl(
  key: string,
  config = readR2StorageConfig(),
): Promise<R2PresignedUrlResult> {
  return presignR2ObjectUrl({
    config,
    method: "PUT",
    key,
    ttlSeconds: config.uploadUrlTtlSeconds,
  });
}

export async function createR2GetUrl(
  key: string,
  config = readR2StorageConfig(),
): Promise<R2PresignedUrlResult> {
  return presignR2ObjectUrl({
    config,
    method: "GET",
    key,
    ttlSeconds: config.signedUrlTtlSeconds,
  });
}

export async function headR2Object(
  key: string,
  config = readR2StorageConfig(),
): Promise<R2HeadObjectResult> {
  const signed = await presignR2ObjectUrl({
    config,
    method: "HEAD",
    key,
    ttlSeconds: Math.min(config.signedUrlTtlSeconds, 120),
  });
  try {
    const response = await fetch(signed.url, { method: "HEAD" });
    return {
      ok: response.ok,
      status: response.status,
      contentLength:
        Number.isFinite(Number(response.headers.get("content-length")))
          ? Number(response.headers.get("content-length"))
          : null,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      error: response.ok
        ? undefined
        : `R2 HEAD returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentLength: null,
      contentType: null,
      etag: null,
      error: error instanceof Error ? error.message : "R2 HEAD failed",
    };
  }
}

export async function readR2ObjectBytes(
  key: string,
  config = readR2StorageConfig(),
): Promise<Uint8Array> {
  const signed = await presignR2ObjectUrl({
    config,
    method: "GET",
    key,
    ttlSeconds: Math.min(config.signedUrlTtlSeconds, 120),
  });
  const response = await fetch(signed.url);
  if (!response.ok) {
    throw new Error(`R2 GET returned HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
