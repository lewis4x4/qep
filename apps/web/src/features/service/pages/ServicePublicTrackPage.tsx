import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPublicJobStatus } from "../lib/api";

/**
 * Customer-facing status lookup using job UUID + opaque tracking token.
 *
 * Supports shareable links: `/service/track?job_id=<uuid>&token=<token>` (also accepts `id`).
 */
export function ServicePublicTrackPage() {
  const [searchParams] = useSearchParams();
  const autoFetchKey = useRef<string | null>(null);

  const [jobId, setJobId] = useState("");
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const jid = (searchParams.get("job_id") ?? searchParams.get("id") ?? "").trim();
    const tok = (searchParams.get("token") ?? "").trim();
    if (jid) setJobId(jid);
    if (tok) setSecret(tok);
  }, [searchParams]);

  const runLookup = useCallback(async (jid: string, sec: string) => {
    setErr(null);
    setLoading(true);
    try {
      const data = await fetchPublicJobStatus(jid.trim(), sec.trim());
      setResult(data);
    } catch (e) {
      setErr((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const jid = (searchParams.get("job_id") ?? searchParams.get("id") ?? "").trim();
    const tok = (searchParams.get("token") ?? "").trim();
    if (!jid || tok.length < 32) return;
    const key = `${jid}:${tok}`;
    if (autoFetchKey.current === key) return;
    autoFetchKey.current = key;
    void runLookup(jid, tok);
  }, [searchParams, runLookup]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runLookup(jobId, secret);
  };

  const job = result && typeof result === "object" && result !== null && "job" in result
    ? (result as { job: Record<string, unknown> }).job
    : null;

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <h1 className="text-xl font-semibold mb-2">Track service job</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter the full job ID and the tracking token from your confirmation message. If you opened a shared link, status loads automatically.
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
          placeholder="Tracking token"
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
        <div className="mt-6 rounded-lg border p-4 text-sm space-y-2">
          {job.public_status && typeof job.public_status === "object" && job.public_status !== null ? (
            <>
              <p className="text-base font-semibold">
                {String((job.public_status as { headline?: string }).headline ?? "")}
              </p>
              <p className="text-muted-foreground">
                {String((job.public_status as { detail?: string }).detail ?? "")}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Milestone:</span>{" "}
                {String((job.public_status as { friendly_stage?: string }).friendly_stage ?? "")}
              </p>
            </>
          ) : (
            <p><span className="font-medium">Stage:</span> {String(job.current_stage)}</p>
          )}
          {job.scheduled_start_at != null && String(job.scheduled_start_at).length > 0 ? (
            <p><span className="font-medium">Scheduled:</span> {String(job.scheduled_start_at)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
