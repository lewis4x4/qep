import { safeJsonError } from "./safe-cors.ts";

export async function parseJsonBody(
  req: Request,
  origin: string | null,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await req.text();
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, response: safeJsonError("Invalid JSON body", 400, origin) };
  }
}
