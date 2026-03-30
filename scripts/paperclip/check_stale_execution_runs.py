#!/usr/bin/env python3
"""
Detect Paperclip issues whose executionRunId points to a heartbeat run still in
`running` longer than a configurable threshold.

Uses only the local Paperclip HTTP API and the standard library.

Environment:
  PAPERCLIP_API_URL       Base URL (e.g. http://127.0.0.1:3100)
  PAPERCLIP_API_KEY       Bearer token (agent JWT or board API key)
  PAPERCLIP_COMPANY_ID    Company UUID

Optional:
  STALE_RUN_THRESHOLD_SEC   Seconds; default 3600 (2× typical 1800s heartbeat interval)
  PAPERCLIP_ISSUE_PREFIX    Company URL prefix for markdown links (default: derived from first issue id)
  PAPERCLIP_RUN_ID          If set, sent as X-Paperclip-Run-Id on mutating calls

Exit codes: 0 = no stale runs, 1 = one or more stale runs, 2 = usage/config error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def http_json(
    method: str,
    url: str,
    *,
    data: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    body = None
    h = {"Authorization": f"Bearer {os.environ['PAPERCLIP_API_KEY']}", **(headers or {})}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    run_id = os.environ.get("PAPERCLIP_RUN_ID")
    if run_id and method.upper() != "GET":
        h["X-Paperclip-Run-Id"] = run_id
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {method} {url}: {err_body}") from e


def company_prefix_from_identifier(identifier: str | None) -> str:
    if not identifier or "-" not in identifier:
        return "ISSUE"
    head, tail = identifier.rsplit("-", 1)
    return head if tail.isdigit() else identifier.split("-", 1)[0]


def run_ui_path(prefix: str, agent_id: str | None, run_id: str) -> str:
    """Paperclip UI accepts agent id or url-key in /agents/:id/runs/:runId."""
    if not agent_id:
        return ""
    return f"/{prefix}/agents/{agent_id}/runs/{run_id}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect stale Paperclip heartbeat runs locked on issues.")
    parser.add_argument(
        "--threshold-sec",
        type=int,
        default=int(os.environ.get("STALE_RUN_THRESHOLD_SEC", "3600")),
        help="Run age in seconds to treat as stale (default: env STALE_RUN_THRESHOLD_SEC or 3600).",
    )
    parser.add_argument(
        "--issue-statuses",
        default="todo,in_progress,blocked",
        help="Comma-separated issue statuses to scan.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Max issues to fetch from the list endpoint.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print one JSON object per stale finding to stdout.",
    )
    parser.add_argument(
        "--post-issue-comments",
        action="store_true",
        help="Post a comment on each affected issue (uses PAPERCLIP_API_KEY).",
    )
    parser.add_argument(
        "--notify-parent",
        metavar="ISSUE_UUID",
        help="Post one rollup comment on this issue (e.g. parent epic).",
    )
    parser.add_argument(
        "--create-escalation",
        action="store_true",
        help="Create one medium-priority child under --notify-parent with CEO assignee (requires --notify-parent).",
    )
    parser.add_argument(
        "--ceo-agent-id",
        default=os.environ.get("PAPERCLIP_CEO_AGENT_ID", ""),
        help="CEO agent UUID for escalation subtask (default: env PAPERCLIP_CEO_AGENT_ID).",
    )
    args = parser.parse_args()

    base = os.environ.get("PAPERCLIP_API_URL", "").rstrip("/")
    company = os.environ.get("PAPERCLIP_COMPANY_ID", "").strip()
    if not base or not company:
        print("Missing PAPERCLIP_API_URL or PAPERCLIP_COMPANY_ID", file=sys.stderr)
        return 2

    statuses = args.issue_statuses.strip()
    list_url = f"{base}/api/companies/{company}/issues?{urllib.parse.urlencode({'status': statuses, 'limit': str(args.limit)})}"

    issues: list[dict[str, Any]] = http_json("GET", list_url)
    prefix = os.environ.get("PAPERCLIP_ISSUE_PREFIX", "").strip()
    if not prefix:
        for row in issues:
            ident = row.get("identifier")
            if ident:
                prefix = company_prefix_from_identifier(ident)
                break
        else:
            prefix = "QUA"

    now = datetime.now(timezone.utc)
    stale: list[dict[str, Any]] = []

    for issue in issues:
        run_id = issue.get("executionRunId")
        if not run_id:
            continue
        ident = issue.get("identifier") or issue.get("id")
        try:
            run = http_json("GET", f"{base}/api/heartbeat-runs/{run_id}")
        except RuntimeError as e:
            stale.append(
                {
                    "issueId": issue.get("id"),
                    "identifier": ident,
                    "executionRunId": run_id,
                    "agentId": issue.get("assigneeAgentId"),
                    "reason": "run_fetch_failed",
                    "detail": str(e),
                }
            )
            continue

        status = run.get("status")
        started = _parse_iso(run.get("startedAt"))
        if status != "running" or started is None:
            continue
        age_sec = (now - started).total_seconds()
        if age_sec <= args.threshold_sec:
            continue

        pid = run.get("processPid")
        stale.append(
            {
                "issueId": issue.get("id"),
                "identifier": ident,
                "executionRunId": run_id,
                "runStatus": status,
                "startedAt": run.get("startedAt"),
                "ageSeconds": int(age_sec),
                "processPid": pid,
                "agentId": run.get("agentId"),
                "reason": "running_over_threshold",
            }
        )

    if args.json:
        for row in stale:
            print(json.dumps(row, separators=(",", ":")))

    if not stale:
        if not args.json:
            print("No stale execution runs detected.")
        return 0

    if not args.json:
        print(f"Stale execution runs: {len(stale)}", file=sys.stderr)
        for row in stale:
            print(
                f"  {row.get('identifier')} run={row.get('executionRunId')} "
                f"reason={row.get('reason')} ageSec={row.get('ageSeconds', 'n/a')}",
                file=sys.stderr,
            )

    if args.post_issue_comments:
        for row in stale:
            iid = row.get("issueId")
            if not iid:
                continue
            ident = row.get("identifier") or str(iid)
            rid = row.get("executionRunId")
            agent_id = row.get("agentId")
            rpath = run_ui_path(prefix, agent_id, str(rid)) if rid else ""
            run_line = (
                f"- Heartbeat run: [`{rid}`]({rpath})\n"
                if rpath
                else f"- Heartbeat run id: `{rid}` (open from Paperclip UI)\n"
            )
            issue_link = f"[{ident}](/{prefix}/issues/{ident})"
            if row.get("reason") == "run_fetch_failed":
                extra = f"- API error: `{row.get('detail')}`\n"
                age_line = ""
            else:
                extra = ""
                age_line = f"- Age (approx): **{row.get('ageSeconds', '?')}s** over threshold {args.threshold_sec}s\n"
            body = (
                "## Stale Paperclip execution run (automated check)\n\n"
                f"- Issue: {issue_link}\n"
                f"{run_line}"
                f"{age_line}"
                f"{extra}"
                "\nNext: confirm whether the Cursor session is still active; if not, follow "
                f"[runbook](https://github.com/lewis4x4/qep/blob/main/docs/paperclip-stale-runs-runbook.md) "
                "for human remediation (no auto-cancel in this build)."
            )
            http_json("POST", f"{base}/api/issues/{iid}/comments", data={"body": body})

    if args.notify_parent:
        lines = [
            "## Stale Paperclip execution runs (rollup)",
            "",
            f"Threshold: **{args.threshold_sec}s**; findings: **{len(stale)}**",
            "",
        ]
        for row in stale:
            ident = row.get("identifier")
            rid = row.get("executionRunId")
            il = f"[{ident}](/{prefix}/issues/{ident})"
            rpath = run_ui_path(prefix, row.get("agentId"), str(rid)) if rid else ""
            label = (rid[:8] + "…") if rid and len(str(rid)) > 8 else str(rid)
            rl = f"[run:{label}]({rpath})" if rpath else f"`{rid}`"
            lines.append(f"- {il} — {rl} — age **{row.get('ageSeconds', '?')}s**")
        lines.append("")
        lines.append("@CEO Board-visible rollup from `scripts/paperclip/check_stale_execution_runs.py`.")
        http_json(
            "POST",
            f"{base}/api/issues/{args.notify_parent}/comments",
            data={"body": "\n".join(lines)},
        )

    if args.create_escalation:
        if not args.notify_parent:
            print("--create-escalation requires --notify-parent", file=sys.stderr)
            return 2
        ceo = args.ceo_agent_id.strip()
        if not ceo:
            print("Missing --ceo-agent-id or PAPERCLIP_CEO_AGENT_ID", file=sys.stderr)
            return 2
        parent = http_json("GET", f"{base}/api/issues/{args.notify_parent}")
        goal_id = parent.get("goalId")
        project_id = parent.get("projectId")
        if not goal_id or not project_id:
            print("Parent issue missing goalId or projectId", file=sys.stderr)
            return 2
        titles = ", ".join(str(r.get("identifier")) for r in stale[:5])
        more = f" (+{len(stale) - 5} more)" if len(stale) > 5 else ""
        desc_lines = [
            "Automated escalation: issues appear to hold a `running` heartbeat run past threshold.",
            "",
            "See runbook: `docs/paperclip-stale-runs-runbook.md` in repo `qep`.",
            "",
            "Findings:",
        ]
        for row in stale:
            ident = row.get("identifier")
            rid = row.get("executionRunId")
            age = row.get("ageSeconds")
            age_note = f"{age}s over threshold" if age is not None else row.get("reason", "unknown")
            desc_lines.append(f"- [{ident}](/{prefix}/issues/{ident}) — run `{rid}` — {age_note}")
        http_json(
            "POST",
            f"{base}/api/companies/{company}/issues",
            data={
                "title": f"Stale Paperclip execution runs: {titles}{more}",
                "description": "\n".join(desc_lines),
                "status": "todo",
                "priority": "medium",
                "parentId": args.notify_parent,
                "goalId": goal_id,
                "projectId": project_id,
                "assigneeAgentId": ceo,
            },
        )

    return 1


if __name__ == "__main__":
    sys.exit(main())
