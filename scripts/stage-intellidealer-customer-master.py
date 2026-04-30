#!/usr/bin/env python3
"""
Stage IntelliDealer Customer Master.xlsx into QEP import staging tables.

Default mode is dry-run. Use --commit to write through Supabase REST with:

  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "scripts" / "audit-intellidealer-customer-master.py"


def load_audit_module():
    spec = importlib.util.spec_from_file_location("intellidealer_customer_audit", AUDIT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load audit module from {AUDIT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


AUDIT = load_audit_module()


def load_local_env(root: Path) -> None:
    for name in (".env.local", ".env"):
        path = root / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def read_sheets(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as zf:
        shared_strings = AUDIT.read_shared_strings(zf)
        sheet_paths = AUDIT.read_sheet_paths(zf)
        return {
            name: AUDIT.read_sheet(zf, shared_strings, name, sheet_paths[name])
            for name in AUDIT.EXPECTED_SHEETS
        }


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_bool(value: Any) -> bool | None:
    text = clean(value)
    if text is None:
        return None
    normalized = text.upper()
    if normalized in {"Y", "YES", "TRUE", "1"}:
        return True
    if normalized in {"N", "NO", "FALSE", "0"}:
        return False
    return None


def parse_int(value: Any) -> int | None:
    text = clean(value)
    if text is None:
        return None
    try:
        return int(Decimal(text.replace(",", "")))
    except (InvalidOperation, ValueError):
        return None


def parse_decimal(value: Any) -> str | None:
    text = clean(value)
    if text is None:
        return None
    try:
        return str(Decimal(text.replace("$", "").replace(",", "")))
    except InvalidOperation:
        return None


def amount_to_cents(value: Any) -> int | None:
    parsed = parse_decimal(value)
    if parsed is None:
        return None
    return int((Decimal(parsed) * 100).quantize(Decimal("1")))


def row_at(rows: list[dict[str, str]], index: int) -> tuple[int, dict[str, str]]:
    return index + 2, rows[index]


def map_master(rows: list[dict[str, str]], run_id: str, workspace_id: str) -> list[dict[str, Any]]:
    output = []
    for index in range(len(rows)):
        row_number, row = row_at(rows, index)
        output.append({
            "run_id": run_id,
            "workspace_id": workspace_id,
            "row_number": row_number,
            "company_code": clean(row["Company"]),
            "division_code": clean(row["Division"]),
            "customer_number": clean(row["Customer Number:"]),
            "status_code": clean(row["Status"]),
            "branch_code": clean(row["Branch"]),
            "ar_type_code": clean(row["A/R Type"]),
            "category_code": clean(row["Category"]),
            "business_class_code": clean(row["Bus Cls"]),
            "customer_name": clean(row["Sold To Customer Name"]) or "Unknown customer",
            "sold_to_address_1": clean(row["Sold To Address 1"]),
            "sold_to_address_2": clean(row["Sold To Address 2"]),
            "city": clean(row["City"]),
            "state": clean(row["Prv/St"]),
            "postal_code": clean(row["Sold To Postal/Zip Code"]),
            "country": clean(row["Country"]),
            "phone": clean(row["Phone #"]),
            "fax": clean(row["Fax Number"]),
            "cell": clean(row["Cell Phone Number"]),
            "terms_code": clean(row["Terms Code"]),
            "county_code": clean(row["County"]),
            "territory_code": clean(row["Territory"]),
            "salesperson_code": clean(row["Salesman"]),
            "search_1": clean(row["Search 1"]),
            "search_2": clean(row["Search 2"]),
            "pricing_level": parse_int(row["Pricing Level"]),
            "pricing_group_code": clean(row["Pricing Group"]),
            "opt_out_pi": parse_bool(row["Opt Out PI"]),
            "do_not_call": parse_bool(row["Do Not Call"]),
            "date_added_raw": clean(row["Date Added"]),
            "date_last_modified_raw": clean(row["Date Last Modified"]),
            "date_last_billed_raw": clean(row["Date Last Billed"]),
            "last_payment_date_raw": clean(row["Last Payment Date"]),
            "raw_row": row,
        })
    return output


def map_contacts(rows: list[dict[str, str]], run_id: str, workspace_id: str) -> list[dict[str, Any]]:
    output = []
    for index in range(len(rows)):
        row_number, row = row_at(rows, index)
        output.append({
            "run_id": run_id,
            "workspace_id": workspace_id,
            "row_number": row_number,
            "company_code": clean(row["Company"]),
            "division_code": clean(row["Division"]),
            "customer_number": clean(row["Customer #"]),
            "contact_number": clean(row["Contact #"]),
            "job_title": clean(row["Job Title"]),
            "first_name": clean(row["First Name"]) or "Unknown",
            "middle_initial": clean(row["Middle Initial"]),
            "last_name": clean(row["Last Name"]) or "Contact",
            "comment": clean(row["Comment"]),
            "business_address_1": clean(row["Business Address 1"]),
            "business_address_2": clean(row["Business Address 2"]),
            "business_address_3": clean(row["Business Address 3"]),
            "business_postal_code": clean(row["Business Postal/ Zip Code"]),
            "business_phone": clean(row["Business Phone #"]),
            "business_phone_extension": clean(row["Business Phone Extension"]),
            "business_fax": clean(row["Business Fax #"]),
            "business_cell": clean(row["Business Cell Phone #"]),
            "business_email": clean(row["Business Email Address"]),
            "business_web_address": clean(row["Business Web Address"]),
            "home_phone": clean(row["Home Phone #"]),
            "home_cell": clean(row["Home Cell Phone #"]),
            "home_email": clean(row["Home Email Address"]),
            "user_id": clean(row["User ID"]),
            "birth_date_raw": clean(row["Birth Date"]),
            "status_code": clean(row["Status"]),
            "salesperson_code": clean(row["Salesperson"]),
            "mydealer_user": parse_bool(row["MyDealer User"]),
            "raw_row": row,
        })
    return output


def map_memos(rows: list[dict[str, str]], run_id: str, workspace_id: str) -> list[dict[str, Any]]:
    output = []
    for index in range(len(rows)):
        row_number, row = row_at(rows, index)
        output.append({
            "run_id": run_id,
            "workspace_id": workspace_id,
            "row_number": row_number,
            "company_code": clean(row["Company"]),
            "division_code": clean(row["Division"]),
            "customer_number": clean(row["Customer #"]),
            "contact_number": clean(row["Contact #"]),
            "sequence_number": parse_int(row["Sequence #"]) or 0,
            "memo": clean(row["Memo"]),
            "raw_row": row,
        })
    return output


def map_ar_agencies(rows: list[dict[str, str]], run_id: str, workspace_id: str) -> list[dict[str, Any]]:
    output = []
    for index in range(len(rows)):
        row_number, row = row_at(rows, index)
        output.append({
            "run_id": run_id,
            "workspace_id": workspace_id,
            "row_number": row_number,
            "company_code": clean(row["Co"]),
            "division_code": clean(row["Div"]),
            "customer_number": clean(row["Cus#"]),
            "agency_code": clean(row["Agency Code"]),
            "card_number": clean(row["Card#"]),
            "expiration_date_raw": clean(row["Exp Date"]),
            "status_code": clean(row["Sta"]),
            "is_default_agency": parse_bool(row["Default Agency"]) is True,
            "credit_rating": clean(row["Credit Rating"]),
            "default_promotion_code": clean(row["Default Promotion Code"]),
            "credit_limit": parse_decimal(row["Credit Limit"]),
            "transaction_limit": parse_decimal(row["Trans Limit"]),
            "raw_row": row,
        })
    return output


def map_profitability(rows: list[dict[str, str]], run_id: str, workspace_id: str) -> list[dict[str, Any]]:
    output = []
    for index in range(len(rows)):
        row_number, row = row_at(rows, index)
        output.append({
            "run_id": run_id,
            "workspace_id": workspace_id,
            "row_number": row_number,
            "company_code": clean(row["Company"]),
            "division_code": clean(row["Division"]),
            "customer_number": clean(row["Customer Number"]),
            "area_code": clean(row["Area"]),
            "ytd_sales_last_month_end": parse_decimal(row["YTD Sales Last Month End"]),
            "ytd_costs_last_month_end": parse_decimal(row["YTD Costs Last Month End"]),
            "current_month_sales": parse_decimal(row["Current Month Sales"]),
            "current_month_costs": parse_decimal(row["Current Month Costs"]),
            "ytd_margin": parse_decimal(row["YTD Margin $"]),
            "ytd_margin_pct": parse_decimal(row["YTD Margin %"]),
            "current_month_margin": parse_decimal(row["Current Month Margin $"]),
            "current_month_margin_pct": parse_decimal(row["Current Month Margin %"]),
            "last_11_sales_last_month_end": parse_decimal(row["L11 Sales Last Month End"]),
            "last_11_costs_last_month_end": parse_decimal(row["L11 Costs Last Month End"]),
            "last_12_margin": parse_decimal(row["L12 Margin $"]),
            "last_12_margin_pct": parse_decimal(row["L12 Margin %"]),
            "last_ytd_sales_last_month_end": parse_decimal(row["LYTD Sales Last Month End"]),
            "last_ytd_costs_last_month_end": parse_decimal(row["LYTD Costs Last Month End"]),
            "current_month_sales_last_year": parse_decimal(row["Current Month Sales Last Year"]),
            "current_month_costs_last_year": parse_decimal(row["Current Month Costs Last Year"]),
            "last_ytd_margin": parse_decimal(row["LYTD Margin $"]),
            "last_ytd_margin_pct": parse_decimal(row["LYTD Margin %"]),
            "fiscal_last_year_sales": parse_decimal(row["Fiscal Last Year Sal es"]),
            "fiscal_last_year_costs": parse_decimal(row["Fiscal Last Year Cos ts"]),
            "fiscal_last_year_margin": parse_decimal(row["Fiscal Last Year Mar gin $"]),
            "fiscal_last_year_margin_pct": parse_decimal(row["Fiscal Last Year Mar gin %"]),
            "territory_code": clean(row["Territory"]),
            "salesperson_code": clean(row["Salesperson"]),
            "county_code": clean(row["County"]),
            "business_class_code": clean(row["Business Class"]),
            "type_code": clean(row["Type"]),
            "owner_code": clean(row["Owner"]),
            "equipment_code": clean(row["Equipment"]),
            "dunn_bradstreet": clean(row["Dunn & Bradstreet"]),
            "location_code": clean(row["Location"]),
            "country": clean(row["Country"]),
            "raw_row": row,
        })
    return output


class SupabaseRest:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.headers = {
            "apikey": service_key,
            "authorization": f"Bearer {service_key}",
            "content-type": "application/json",
            "prefer": "return=representation",
        }

    def request(self, method: str, table: str, payload: Any = None, query: str = "") -> Any:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{table}{query}",
            data=body,
            headers=self.headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                text = response.read().decode("utf-8")
                return json.loads(text) if text else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {table} failed: HTTP {exc.code} {detail}") from exc

    def insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        return self.request("POST", table, rows)

    def patch_by_id(self, table: str, row_id: str, values: dict[str, Any]) -> Any:
        encoded = urllib.parse.quote(row_id)
        return self.request("PATCH", table, values, query=f"?id=eq.{encoded}")

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        return self.request("POST", f"rpc/{name}", payload)


def chunks(rows: list[dict[str, Any]], size: int):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def insert_batches(client: SupabaseRest, table: str, rows: list[dict[str, Any]], batch_size: int) -> int:
    inserted = 0
    for batch in chunks(rows, batch_size):
        client.insert(table, batch)
        inserted += len(batch)
        print(f"  staged {inserted}/{len(rows)} into {table}")
    return inserted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", nargs="?", default="docs/IntelliDealer/Customer Master.xlsx")
    parser.add_argument("--workspace", default="default")
    parser.add_argument("--commit", action="store_true", help="Write rows to Supabase staging tables.")
    parser.add_argument("--commit-canonical", action="store_true", help="After staging, call commit_intellidealer_customer_import.")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()

    load_local_env(ROOT)
    workbook = Path(args.workbook)
    if not workbook.is_absolute():
        workbook = ROOT / workbook
    report = AUDIT.audit(workbook)
    if not report["ok"]:
        print(json.dumps(report["errors"], indent=2), file=sys.stderr)
        return 1

    sheets = read_sheets(workbook)
    summary = {
        "master_rows": len(sheets["MAST"].rows),
        "contact_rows": len(sheets["CONTACTS"].rows),
        "contact_memo_rows": len(sheets["Cust Contact Memos"].rows),
        "ar_agency_rows": len(sheets["AR AGENCY"].rows),
        "profitability_rows": len(sheets["PROFITABILITY"].rows),
    }
    print(f"Workbook audit passed: {summary}")

    if not args.commit:
        print("Dry run only. Re-run with --commit to stage rows in Supabase.")
        return 0

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 2

    client = SupabaseRest(url, key)
    run = client.insert("qrm_intellidealer_customer_import_runs", [{
        "workspace_id": args.workspace,
        "source_file_name": workbook.name,
        "source_file_hash": report["sha256"],
        "status": "staged",
        **summary,
        "warning_count": len(report["warnings"]),
        "metadata": {
            "audit": report,
            "script": "scripts/stage-intellidealer-customer-master.py",
        },
    }])[0]
    run_id = run["id"]
    print(f"Created staging run {run_id}")

    tables = [
        ("qrm_intellidealer_customer_master_stage", map_master(sheets["MAST"].rows, run_id, args.workspace)),
        ("qrm_intellidealer_customer_contacts_stage", map_contacts(sheets["CONTACTS"].rows, run_id, args.workspace)),
        ("qrm_intellidealer_customer_contact_memos_stage", map_memos(sheets["Cust Contact Memos"].rows, run_id, args.workspace)),
        ("qrm_intellidealer_customer_ar_agency_stage", map_ar_agencies(sheets["AR AGENCY"].rows, run_id, args.workspace)),
        ("qrm_intellidealer_customer_profitability_stage", map_profitability(sheets["PROFITABILITY"].rows, run_id, args.workspace)),
    ]
    try:
        for table, rows in tables:
            insert_batches(client, table, rows, args.batch_size)
        client.patch_by_id("qrm_intellidealer_customer_import_runs", run_id, {
            "status": "staged",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        client.patch_by_id("qrm_intellidealer_customer_import_runs", run_id, {"status": "failed"})
        raise

    print(f"Staging complete for run {run_id}")
    if args.commit_canonical:
        result = client.rpc("commit_intellidealer_customer_import", {"p_run_id": run_id})
        print(f"Canonical commit complete: {json.dumps(result, sort_keys=True)}")
    else:
        print(f"Canonical commit not run. Run RPC commit_intellidealer_customer_import('{run_id}') after review, or re-run with --commit-canonical.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
