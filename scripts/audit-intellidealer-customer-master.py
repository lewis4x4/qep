#!/usr/bin/env python3
"""
Audit the delivered IntelliDealer customer workbook before any database import.

This intentionally uses only Python standard-library modules so it can run on a
clean machine without Excel, LibreOffice, pandas, openpyxl, or SheetJS.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

EXPECTED_SHEETS = {
    "MAST": 5136,
    "Cust Contact Memos": 1179,
    "AR AGENCY": 19466,
    "CONTACTS": 4657,
    "PROFITABILITY": 9894,
}

AREA_LABELS = {
    "L": "labor sales",
    "S": "parts on work orders",
    "P": "parts invoicing",
    "R": "rental",
    "E": "equipment",
    "T": "total sales",
}


@dataclass
class Sheet:
    name: str
    headers: list[str]
    rows: list[dict[str, str]]
    duplicate_headers: dict[str, int]


def col_to_num(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    num = 0
    for ch in letters:
        num = num * 26 + ord(ch.upper()) - 64
    return num


def unique_headers(headers: list[str]) -> tuple[list[str], dict[str, int]]:
    seen: dict[str, int] = {}
    duplicates: dict[str, int] = {}
    output: list[str] = []
    for index, header in enumerate(headers, start=1):
        base = header.strip() or f"__blank_{index}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        if count > 1:
            duplicates[base] = count
            output.append(f"{base}__{count}")
        else:
            output.append(base)
    return output, duplicates


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.findall(".//m:t", NS))
        for item in root.findall("m:si", NS)
    ]


def read_sheet_paths(zf: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rels = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root}
    paths: dict[str, str] = {}
    for sheet in workbook.findall(".//m:sheet", NS):
        paths[sheet.attrib["name"]] = "xl/" + rels[sheet.attrib[REL]].lstrip("/")
    return paths


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value_node = cell.find("m:v", NS)
    value = "" if value_node is None else value_node.text or ""
    if cell.attrib.get("t") == "s" and value:
        return shared_strings[int(value)].strip()
    return value.strip()


def read_sheet(zf: zipfile.ZipFile, shared_strings: list[str], name: str, path: str) -> Sheet:
    headers: list[str] | None = None
    rows: list[dict[str, str]] = []
    duplicates: dict[str, int] = {}

    for _event, element in ET.iterparse(zf.open(path), events=("end",)):
        if element.tag.rsplit("}", 1)[-1] != "row":
            continue

        values = {
            col_to_num(cell.attrib.get("r", "A")): cell_value(cell, shared_strings)
            for cell in element.findall("m:c", NS)
        }
        if headers is None:
            max_col = max(values.keys()) if values else 0
            headers, duplicates = unique_headers([values.get(i, "") for i in range(1, max_col + 1)])
        else:
            rows.append({header: values.get(i, "") for i, header in enumerate(headers, start=1)})
        element.clear()

    return Sheet(name=name, headers=headers or [], rows=rows, duplicate_headers=duplicates)


def key(*parts: str) -> str:
    return "|".join(str(part).strip() for part in parts)


def boolish(value: str) -> bool | None:
    normalized = value.strip().upper()
    if normalized in {"Y", "YES", "TRUE", "1"}:
        return True
    if normalized in {"N", "NO", "FALSE", "0", ""}:
        return False
    return None


def require(condition: bool, errors: list[str], message: str) -> None:
    if not condition:
        errors.append(message)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def audit(path: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    with zipfile.ZipFile(path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_paths = read_sheet_paths(zf)
        missing = sorted(set(EXPECTED_SHEETS) - set(sheet_paths))
        require(not missing, errors, f"Missing expected sheets: {', '.join(missing)}")
        sheets = {
            name: read_sheet(zf, shared_strings, name, sheet_paths[name])
            for name in EXPECTED_SHEETS
            if name in sheet_paths
        }

    for name, expected_rows in EXPECTED_SHEETS.items():
        if name not in sheets:
            continue
        actual = len(sheets[name].rows)
        require(actual == expected_rows, errors, f"{name}: expected {expected_rows} data rows, found {actual}")
        if sheets[name].duplicate_headers:
            warnings.append(f"{name}: duplicate headers {sheets[name].duplicate_headers}")

    mast = sheets["MAST"].rows
    master_keys = [key(row["Company"], row["Division"], row["Customer Number:"]) for row in mast]
    master_key_set = set(master_keys)
    require(len(master_keys) == len(master_key_set), errors, "MAST: duplicate Company/Division/Customer Number keys found")

    contact_rows = sheets["CONTACTS"].rows
    contact_keys = [
        key(row["Company"], row["Division"], row["Customer #"], row["Contact #"])
        for row in contact_rows
    ]
    contact_key_set = set(contact_keys)
    require(len(contact_keys) == len(contact_key_set), errors, "CONTACTS: duplicate contact keys found")

    memo_rows = sheets["Cust Contact Memos"].rows
    ar_rows = sheets["AR AGENCY"].rows
    profitability_rows = sheets["PROFITABILITY"].rows

    child_specs = [
        ("CONTACTS", contact_rows, ("Company", "Division", "Customer #")),
        ("Cust Contact Memos", memo_rows, ("Company", "Division", "Customer #")),
        ("AR AGENCY", ar_rows, ("Co", "Div", "Cus#")),
        ("PROFITABILITY", profitability_rows, ("Company", "Division", "Customer Number")),
    ]
    child_fk_failures: dict[str, list[str]] = {}
    for sheet_name, rows, cols in child_specs:
        misses = [
            key(row[cols[0]], row[cols[1]], row[cols[2]])
            for row in rows
            if key(row[cols[0]], row[cols[1]], row[cols[2]]) not in master_key_set
        ]
        child_fk_failures[sheet_name] = sorted(set(misses))[:20]
        require(not misses, errors, f"{sheet_name}: {len(misses)} rows do not match a MAST customer key")

    memo_contact_misses = [
        key(row["Company"], row["Division"], row["Customer #"], row["Contact #"])
        for row in memo_rows
        if key(row["Company"], row["Division"], row["Customer #"], row["Contact #"]) not in contact_key_set
    ]
    require(not memo_contact_misses, errors, f"Cust Contact Memos: {len(memo_contact_misses)} rows do not match a CONTACTS key")

    ar_keys = [key(row["Co"], row["Div"], row["Cus#"], row["Agency Code"], row["Card#"]) for row in ar_rows]
    require(len(ar_keys) == len(set(ar_keys)), errors, "AR AGENCY: duplicate customer/agency/card keys found")

    profitability_keys = [
        key(row["Company"], row["Division"], row["Customer Number"], row["Area"])
        for row in profitability_rows
    ]
    require(
        len(profitability_keys) == len(set(profitability_keys)),
        errors,
        "PROFITABILITY: duplicate customer/area keys found",
    )

    unexpected_payments = collections.Counter(
        row["MyDealer Allow Payments On Account"]
        for row in contact_rows
        if boolish(row["MyDealer Allow Payments On Account"]) is None
    )
    if unexpected_payments:
        warnings.append(f"CONTACTS: unexpected MyDealer Allow Payments values {dict(unexpected_payments)}")

    po_values = collections.Counter(row["PO Number/ Required"].strip() for row in mast if row["PO Number/ Required"].strip())
    non_boolean_po = {
        value: count
        for value, count in po_values.items()
        if boolish(value) is None and not re.fullmatch(r"[A-Za-z0-9 /._-]+", value)
    }
    if non_boolean_po:
        warnings.append(f"MAST: unusual PO Number/ Required values {non_boolean_po}")

    area_counts = collections.Counter(row["Area"] for row in profitability_rows)
    unknown_areas = sorted(set(area_counts) - set(AREA_LABELS))
    require(not unknown_areas, errors, f"PROFITABILITY: unknown area codes {unknown_areas}")

    cards = [row["Card#"].strip() for row in ar_rows]
    placeholder_cards = sum(1 for value in cards if value in {"*", "?"})
    real_cards = len(cards) - placeholder_cards

    status_counts = collections.Counter(row["Status"].strip() or "active_blank" for row in mast)
    coverage = {
        "contacts_customers": len({key(row["Company"], row["Division"], row["Customer #"]) for row in contact_rows}),
        "ar_agency_customers": len({key(row["Co"], row["Div"], row["Cus#"]) for row in ar_rows}),
        "profitability_customers": len({key(row["Company"], row["Division"], row["Customer Number"]) for row in profitability_rows}),
        "memo_customers": len({key(row["Company"], row["Division"], row["Customer #"]) for row in memo_rows}),
    }

    return {
        "file": str(path),
        "sha256": sha256(path),
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "sheets": {
            name: {
                "rows": len(sheet.rows),
                "columns": len(sheet.headers),
                "duplicate_headers": sheet.duplicate_headers,
            }
            for name, sheet in sheets.items()
        },
        "key_integrity": {
            "master_unique_customers": len(master_key_set),
            "child_fk_failures": child_fk_failures,
            "memo_contact_fk_failures_sample": sorted(set(memo_contact_misses))[:20],
        },
        "data_profile": {
            "master_status_counts": dict(status_counts),
            "blank_master_address_1": sum(1 for row in mast if not row["Sold To Address 1"]),
            "blank_master_city": sum(1 for row in mast if not row["City"]),
            "blank_master_state": sum(1 for row in mast if not row["Prv/St"]),
            "blank_contact_business_email": sum(1 for row in contact_rows if not row["Business Email Address"]),
            "primary_contact_placeholders": sum(
                1
                for row in contact_rows
                if row["First Name"].strip().lower() == "primary"
                and row["Last Name"].strip().lower() == "contact"
            ),
            "ar_placeholder_cards": placeholder_cards,
            "ar_non_placeholder_cards": real_cards,
            "ar_default_agency_rows": sum(1 for row in ar_rows if row["Default Agency"].strip().upper() == "Y"),
            "profitability_area_counts": dict(area_counts),
            "profitability_area_labels": AREA_LABELS,
            **coverage,
        },
    }


def print_text(report: dict[str, Any]) -> None:
    print(f"File: {report['file']}")
    print(f"SHA-256: {report['sha256']}")
    print(f"Status: {'PASS' if report['ok'] else 'FAIL'}")
    print("")
    print("Sheets:")
    for name, info in report["sheets"].items():
        dupes = f", duplicate headers={info['duplicate_headers']}" if info["duplicate_headers"] else ""
        print(f"  - {name}: {info['rows']} rows, {info['columns']} columns{dupes}")
    print("")
    print("Key Integrity:")
    print(f"  - MAST unique customers: {report['key_integrity']['master_unique_customers']}")
    for name, misses in report["key_integrity"]["child_fk_failures"].items():
        print(f"  - {name} customer FK misses: {len(misses)} sample entries")
    print("")
    print("Data Profile:")
    for key_name, value in report["data_profile"].items():
        print(f"  - {key_name}: {value}")
    if report["warnings"]:
        print("")
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")
    if report["errors"]:
        print("")
        print("Errors:")
        for error in report["errors"]:
            print(f"  - {error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "workbook",
        nargs="?",
        default="docs/IntelliDealer/Customer Master.xlsx",
        help="Path to the IntelliDealer Customer Master workbook.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    path = Path(args.workbook)
    if not path.exists():
        print(f"Workbook not found: {path}", file=sys.stderr)
        return 2

    report = audit(path)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_text(report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
