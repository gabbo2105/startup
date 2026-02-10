#!/usr/bin/env python3
"""
Import products from JSON into Supabase.

Two modes:
  1. From JSON file (default, no extra dependencies)
  2. From Excel file (requires: pip install pandas openpyxl)

Usage:
    # Mode 1: JSON (recommended - no extra deps)
    export SUPABASE_SERVICE_KEY="your-service-role-key"
    python import_products.py

    # Mode 2: Excel
    python import_products.py --from-excel Sansepolcro_Borgo_Palace_Hotel__2025_04_05.xlsx

Environment variables:
    SUPABASE_URL         - Project URL (default: https://wvlqjpmphfhkctupwvvd.supabase.co)
    SUPABASE_SERVICE_KEY - Your service role key (NOT anon key)
                           Get it from: Supabase Dashboard > Settings > API > service_role
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' is required. Install with: pip install requests")
    sys.exit(1)

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://wvlqjpmphfhkctupwvvd.supabase.co')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bHFqcG1waGZoa2N0dXB3dnZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDczMzA2MiwiZXhwIjoyMDg2MzA5MDYyfQ.bPBFX3tTbf9rZz6kF7SpDLcTvyximcz8HpHV3FNthgc')
BATCH_SIZE = 500

# Supplier mapping (UUIDs assigned during migration)
SUPPLIERS = {
    'Bindi': '00000000-0000-0000-0001-000000000001',
    'Centrofarc S.p.A.': '00000000-0000-0000-0001-000000000002',
    'MARR SPA': '00000000-0000-0000-0001-000000000003',
    'DORECA ITALIA S.P.A.': '00000000-0000-0000-0001-000000000004',
    'DAC SPA': '00000000-0000-0000-0001-000000000005',
    "Forno d'Asolo": '00000000-0000-0000-0001-000000000006',
}
PRICE_LIST_ID = '00000000-0000-0000-0000-000000000001'


def load_from_json(path: str) -> list[dict]:
    """Load products from pre-generated JSON file."""
    print(f"Loading products from {path}...")
    with open(path, 'r', encoding='utf-8') as f:
        products = json.load(f)
    print(f"  Loaded {len(products)} products")
    return products


def load_from_excel(path: str) -> list[dict]:
    """Parse Excel file and return list of product dicts."""
    try:
        import pandas as pd
    except ImportError:
        print("ERROR: Excel mode requires pandas. Install with: pip install pandas openpyxl")
        sys.exit(1)

    print(f"Parsing Excel file {path}...")
    products = []
    for sheet_name, supplier_id in SUPPLIERS.items():
        try:
            df = pd.read_excel(path, sheet_name=sheet_name, header=None, skiprows=7)
        except Exception as e:
            print(f"  WARNING: Could not read sheet '{sheet_name}': {e}")
            continue

        df = df.dropna(subset=[1])
        count = 0

        for _, row in df.iterrows():
            code = str(row[0]).strip() if pd.notna(row[0]) else ''
            desc = str(row[1]).strip() if pd.notna(row[1]) else ''
            selling_uom = str(row[2]).strip() if pd.notna(row[2]) else None
            pricing_uom = str(row[3]).strip() if pd.notna(row[3]) else None
            price = row[4] if pd.notna(row[4]) else None

            if not code or not desc:
                continue

            try:
                price = float(price) if price is not None else None
            except (ValueError, TypeError):
                price = None

            products.append({
                'price_list_id': PRICE_LIST_ID,
                'supplier_id': supplier_id,
                'supplier_code': code,
                'description': desc,
                'selling_uom': selling_uom,
                'pricing_uom': pricing_uom,
                'price': price,
            })
            count += 1

        print(f"  {sheet_name}: {count} products")

    return products


def insert_products(products: list[dict]) -> int:
    """Insert products via Supabase REST API in batches."""
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }

    total = len(products)
    inserted = 0
    errors = 0

    for i in range(0, total, BATCH_SIZE):
        batch = products[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        try:
            resp = requests.post(
                f'{SUPABASE_URL}/rest/v1/products',
                headers=headers,
                json=batch,
                timeout=30,
            )

            if resp.status_code in (200, 201):
                inserted += len(batch)
                pct = inserted * 100 // total
                print(f"  Batch {batch_num}/{total_batches}: +{len(batch)} rows ({inserted}/{total} = {pct}%)")
            else:
                errors += 1
                print(f"  ERROR batch {batch_num}: HTTP {resp.status_code} - {resp.text[:200]}")
                if resp.status_code == 401:
                    print("  → Check your SUPABASE_SERVICE_KEY")
                    return inserted
                if resp.status_code == 409:
                    print("  → Duplicate key conflict. Products may already be imported.")
                    # Continue with next batch
        except requests.exceptions.RequestException as e:
            errors += 1
            print(f"  ERROR batch {batch_num}: {e}")

        time.sleep(0.1)  # Rate limiting

    if errors:
        print(f"\n  Completed with {errors} error(s)")
    return inserted


def main():
    parser = argparse.ArgumentParser(description='Import hotel supplier products into Supabase')
    parser.add_argument('--from-excel', type=str, help='Path to Excel file (default: use JSON)')
    parser.add_argument('--json-file', type=str, default='all_products.json', help='Path to JSON file')
    parser.add_argument('--dry-run', action='store_true', help='Parse data without inserting')
    args = parser.parse_args()

    # Validate service key
    if not args.dry_run and not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_SERVICE_KEY environment variable")
        print("  Get it from: Supabase Dashboard > Settings > API > service_role key")
        print("  export SUPABASE_SERVICE_KEY='eyJhbGciOi...'")
        sys.exit(1)

    # Load products
    if args.from_excel:
        if not Path(args.from_excel).exists():
            print(f"ERROR: File not found: {args.from_excel}")
            print(f"  Current directory: {os.getcwd()}")
            print(f"  Files here: {', '.join(os.listdir('.'))}")
            sys.exit(1)
        products = load_from_excel(args.from_excel)
    else:
        json_path = args.json_file
        if not Path(json_path).exists():
            # Try data/ subdirectory
            alt_path = Path('data') / json_path
            if alt_path.exists():
                json_path = str(alt_path)
            else:
                print(f"ERROR: JSON file not found: {json_path}")
                print(f"  Current directory: {os.getcwd()}")
                print(f"  Tip: Place all_products.json in the project root or data/ folder")
                sys.exit(1)
        products = load_from_json(json_path)

    print(f"\nTotal products to import: {len(products)}")

    # Summary by supplier
    supplier_counts = {}
    for p in products:
        sid = p['supplier_id']
        supplier_counts[sid] = supplier_counts.get(sid, 0) + 1
    rev_suppliers = {v: k for k, v in SUPPLIERS.items()}
    for sid, count in sorted(supplier_counts.items(), key=lambda x: -x[1]):
        name = rev_suppliers.get(sid, sid)
        print(f"  {name}: {count}")

    if args.dry_run:
        print("\n[DRY RUN] No data inserted.")
        return

    # Insert
    print(f"\nInserting into {SUPABASE_URL}...")
    inserted = insert_products(products)
    print(f"\nDone! Inserted {inserted}/{len(products)} products.")


if __name__ == '__main__':
    main()
