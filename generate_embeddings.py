#!/usr/bin/env python3
"""
Generate embeddings for all products by calling the Supabase Edge Function.
Processes 100 products per call, loops until all are done.

Usage:
    export OPENAI_API_KEY="sk-..."
    python generate_embeddings.py
"""

import os
import sys
import time
import requests

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://wvlqjpmphfhkctupwvvd.supabase.co')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')

if not OPENAI_API_KEY:
    print("ERROR: Set OPENAI_API_KEY environment variable")
    print("  export OPENAI_API_KEY='sk-...'")
    sys.exit(1)

url = f"{SUPABASE_URL}/functions/v1/generate-embeddings"
total_processed = 0
iteration = 0

print("Generating embeddings for all products...")
print(f"Endpoint: {url}\n")

while True:
    iteration += 1
    try:
        resp = requests.post(url, json={
            "openai_api_key": OPENAI_API_KEY,
            "limit": 100,
        }, timeout=120)

        if resp.status_code != 200:
            print(f"ERROR: HTTP {resp.status_code} - {resp.text[:300]}")
            break

        result = resp.json()
        processed = result.get("processed", 0)
        remaining = result.get("remaining", 0)
        total_processed += processed

        print(f"  Round {iteration}: +{processed} (total: {total_processed}, remaining: {remaining})")

        if result.get("errors"):
            for e in result["errors"][:3]:
                print(f"    ⚠ {e}")

        if remaining == 0 or processed == 0:
            print(f"\n✅ Done! Total embeddings generated: {total_processed}")
            break

        # Small pause to avoid rate limits
        time.sleep(1)

    except requests.exceptions.Timeout:
        print(f"  Round {iteration}: timeout, retrying...")
        time.sleep(5)
    except Exception as e:
        print(f"ERROR: {e}")
        break
