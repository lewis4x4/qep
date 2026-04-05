/**
 * Optional transactional email via Resend. No-op when RESEND_API_KEY is unset.
 */
export async function sendResendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; skipped: boolean }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "QEP Service <onboarding@resend.dev>";
  if (!key || !opts.to?.includes("@")) {
    return { ok: false, skipped: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to.trim()],
      subject: opts.subject,
      text: opts.text,
    }),
  });
  return { ok: res.ok, skipped: false };
}
