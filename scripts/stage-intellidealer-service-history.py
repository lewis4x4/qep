#!/usr/bin/env python3
"""
Stage IntelliDealer service history snapshot export (CSV) to JSONL/Supabase.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts._shared.intellidealer_snapshot_stage import build_parser, run_stage  # noqa: E402


def main() -> int:
    parser = build_parser(
        dataset_name="service_history",
        description="Stage IntelliDealer service history snapshot CSV",
    )
    return run_stage(
        parser=parser,
        dataset_name="service_history",
        extra_metadata={"pipeline": "intellidealer_snapshot", "domain": "service"},
    )


if __name__ == "__main__":
    raise SystemExit(main())
