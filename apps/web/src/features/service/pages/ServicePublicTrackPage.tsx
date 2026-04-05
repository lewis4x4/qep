import { useState } from "react";
import { fetchPublicJobStatus } from "../lib/api";

/**
 * Customer-facing status lookup using job UUID + opaque tracking token (preferred)
 * or legacy 4-char PIN (last hex chars of UUID without dashes).
 */
export function ServicePublicTrackPage() {
  const [jobId, setJobId] = useState("");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const data = await fetchPublicJobStatus(jobId.trim(), secret.trim());
      setResult(data);
    } catch (e) {
      setErr((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const job = result && typeof result === "object" && result !== null && "job" in result
    ? (result as { job: Record<string, unknown> }).job
    : null;

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h1 className="text-xl font-semibold mb-2">Track service job</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter the full job ID and the tracking token from your confirmation message (32-character code), or the legacy 4-character PIN.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="Job UUID"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Tracking token or PIN"
          className="w-full rounded border px-3 py-2 text-sm font-mono"
          maxLength={64}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-primary text-primary-foreground py-2 text-sm font-medium"
        >
          {loading ? "Loading…" : "View status"}
        </button>
      </form>
      {err && <p className="text-sm text-destructive mt-4">{err}</p>}
      {job && (
        <div className="mt-6 rounded-lg border p-4 text-sm space-y-1">
          <p><span className="font-medium">Stage:</span> {String(job.current_stage)}</p>
          {job.quote_total != null && (
            <p><span className="font-medium">Quote:</span> ${Number(job.quote_total).toLocaleString()}</p>
          )}
          {job.scheduled_start_at != null && String(job.scheduled_start_at).length > 0 ? (
            <p><span className="font-medium">Scheduled:</span> {String(job.scheduled_start_at)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
