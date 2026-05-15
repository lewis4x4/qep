#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCE_TAG_DEFAULT = "intellidealer_snapshot_2026-05-14"


def load_local_env(root: Path) -> None:
    for name in (".env.local", ".env"):
        env_path = root / name
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def to_snake_case(name: str) -> str:
    value = name.strip().replace("/", " ").replace("-", " ")
    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return value.strip("_").lower()


def parse_row(row: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, raw_value in row.items():
        column = to_snake_case(key)
        value = raw_value.strip() if isinstance(raw_value, str) else raw_value
        out[column] = value if value != "" else None
    return out


GENERIC_STAGE_TABLES = {
    "equipment_master",
    "quotes_history",
    "parts_master",
    "service_history",
}


@dataclass
class SupabaseRest:
    url: str
    service_key: str

    def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        req = urllib.request.Request(
            f"{self.url.rstrip('/')}/rest/v1/{table}",
            data=json.dumps(rows).encode("utf-8"),
            headers={
                "apikey": self.service_key,
                "authorization": f"Bearer {self.service_key}",
                "content-type": "application/json",
                "prefer": "return=minimal",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=1200):
                return
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase insert failed ({exc.code}): {detail}") from exc


def chunked(rows: list[dict[str, Any]], size: int):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def build_parser(dataset_name: str, description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("input", help="CSV export from IntelliDealer")
    parser.add_argument("--workspace", default="default")
    parser.add_argument("--source", default=SOURCE_TAG_DEFAULT)
    parser.add_argument("--out", default=f"tmp/intellidealer-stage/{dataset_name}.jsonl")
    parser.add_argument("--commit", action="store_true", help="Write to Supabase table via REST")
    parser.add_argument("--table", default=f"qrm_intellidealer_{dataset_name}_stage")
    parser.add_argument("--batch-size", type=int, default=500)
    return parser


def run_stage(
    *,
    parser: argparse.ArgumentParser,
    dataset_name: str,
    extra_metadata: dict[str, Any] | None = None,
) -> int:
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    load_local_env(root)

    input_path = Path(args.input)
    if not input_path.is_absolute():
        input_path = root / input_path
    if not input_path.exists():
        print(f"Input file not found: {input_path}")
        return 2

    rows: list[dict[str, Any]] = []
    with input_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for idx, raw in enumerate(reader, start=2):
            normalized = parse_row(raw)
            normalized.update({
                "workspace_id": args.workspace,
                "source": args.source,
                "source_dataset": dataset_name,
                "source_row_number": idx,
                "source_file_name": input_path.name,
                "snapshot_loaded_at": datetime.now(timezone.utc).isoformat(),
            })
            if extra_metadata:
                normalized["stage_metadata"] = extra_metadata
            if dataset_name in GENERIC_STAGE_TABLES:
                normalized = {
                    "workspace_id": args.workspace,
                    "source": args.source,
                    "source_dataset": dataset_name,
                    "source_row_number": idx,
                    "source_file_name": input_path.name,
                    "snapshot_loaded_at": normalized["snapshot_loaded_at"],
                    "payload": normalized,
                    "stage_metadata": extra_metadata or {},
                }
            rows.append(normalized)

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as out:
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=True) + "\n")

    print(
        json.dumps(
            {
                "dataset": dataset_name,
                "input_file": str(input_path),
                "rows": len(rows),
                "jsonl_output": str(out_path),
                "commit": bool(args.commit),
                "target_table": args.table if args.commit else None,
            },
            indent=2,
        )
    )

    if not args.commit:
        print("Dry run complete. Re-run with --commit to insert into Supabase staging table.")
        return 0

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        return 3

    client = SupabaseRest(url=url, service_key=key)
    inserted = 0
    for batch in chunked(rows, max(1, args.batch_size)):
        client.insert(args.table, batch)
        inserted += len(batch)
        print(f"  inserted {inserted}/{len(rows)} rows into {args.table}")

    print(f"Commit complete: {inserted} rows -> {args.table}")
    return 0
