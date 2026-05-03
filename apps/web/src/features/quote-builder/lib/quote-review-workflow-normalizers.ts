export function firstMutationErrorMessage(
  errors: unknown[],
  fallback = "Action failed",
): string | null {
  for (const error of errors) {
    if (!error) continue;
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error.trim();
    if (
      typeof error === "object"
      && error !== null
      && "message" in error
      && typeof error.message === "string"
      && error.message.trim()
    ) {
      return error.message;
    }
    return fallback;
  }
  return null;
}
