const PARTS_IMPORT_BUCKET = "parts-imports";

export type PartsImportStoragePathResult =
  | { ok: true; bucket: string; path: string }
  | { ok: false; error: string };

export function validatePartsImportStoragePath(
  storagePath: string,
  actorId: string,
): PartsImportStoragePathResult {
  const [bucket, ...rest] = storagePath.split("/");
  const path = rest.join("/");
  if (bucket !== PARTS_IMPORT_BUCKET || !path) {
    return { ok: false, error: "storage_path must be in parts-imports" };
  }
  if (!actorId || !path.startsWith(`${actorId}/`)) {
    return { ok: false, error: "storage_path must belong to the caller" };
  }
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return { ok: false, error: "storage_path contains invalid path segments" };
  }
  if (path.split("/").some((segment) => segment.startsWith(".plan-"))) {
    return { ok: false, error: "storage_path cannot reference internal import plans" };
  }
  return { ok: true, bucket, path };
}
