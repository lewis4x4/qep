export function isMissingSummaryBulletsColumnError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  return message.includes("summary_bullets") && (
    code === "PGRST204" ||
    code === "42703" ||
    /schema cache|column|does not exist/i.test(message)
  );
}
