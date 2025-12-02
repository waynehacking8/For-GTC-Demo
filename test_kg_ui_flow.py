#!/usr/bin/env python3
"""Test KG extraction and UI display workflow"""

import asyncio
import sys
from pathlib import Path
import requests
import time

# Test PDF path (use a small PDF for quick testing)
TEST_PDF = "/home/wayne/Desktop/HGP/2506.08473v2.pdf"

async def test_kg_workflow():
    print("=== Testing KG Extraction and UI Display Workflow ===\n")

    # 1. Check API health
    print("1️⃣ Checking LightRAG API health...")
    try:
        response = requests.get("http://localhost:8020/health", timeout=5)
        if response.status_code == 200:
            print(f"   ✅ API is healthy: {response.json()}")
        else:
            print(f"   ❌ API error: {response.status_code}")
            return
    except Exception as e:
        print(f"   ❌ Cannot connect to API: {e}")
        return

    # 2. Check initial KG stats (should be empty)
    print("\n2️⃣ Checking initial KG stats...")
    try:
        response = requests.get("http://localhost:8020/graph/stats", timeout=5)
        if response.status_code == 200:
            stats = response.json()
            print(f"   Current stats: {stats}")
        else:
            print(f"   ❌ Stats error: {response.status_code}")
    except Exception as e:
        print(f"   ❌ Cannot get stats: {e}")

    # 3. Upload and ingest PDF
    print(f"\n3️⃣ Uploading and ingesting PDF: {Path(TEST_PDF).name}...")
    try:
        # Upload file
        with open(TEST_PDF, 'rb') as f:
            files = {'file': (Path(TEST_PDF).name, f, 'application/pdf')}

            print(f"   Sending request to http://localhost:8020/documents/upload...")
            start_time = time.time()

            response = requests.post(
                "http://localhost:8020/documents/upload?process_now=true",
                files=files,
                timeout=600  # 10 minutes timeout for KG extraction
            )

            elapsed = time.time() - start_time

            if response.status_code == 200:
                result = response.json()
                print(f"   ✅ Ingestion completed in {elapsed:.1f}s")
                print(f"   Success: {result.get('success')}")
                print(f"   Chunks: {result.get('chunks', 'N/A')}")
                print(f"   Content length: {result.get('content_length', 'N/A')}")
            else:
                print(f"   ❌ Ingestion failed: {response.status_code}")
                print(f"   Response: {response.text[:500]}")
                return

    except Exception as e:
        print(f"   ❌ Upload error: {e}")
        import traceback
        traceback.print_exc()
        return

    # 4. Wait a moment for KG to be indexed
    print("\n4️⃣ Waiting for KG indexing...")
    await asyncio.sleep(2)

    # 5. Check updated KG stats
    print("\n5️⃣ Checking updated KG stats...")
    try:
        response = requests.get("http://localhost:8020/graph/stats", timeout=5)
        if response.status_code == 200:
            stats = response.json()
            print(f"   ✅ Updated stats:")
            if stats.get('success'):
                graph_stats = stats.get('stats', {})
                print(f"      - 總節點數: {graph_stats.get('總節點數', 0)}")
                print(f"      - 總邊數: {graph_stats.get('總邊數', 0)}")
                print(f"      - 連通分量: {graph_stats.get('連通分量', 0)}")
                print(f"      - 平均度數: {graph_stats.get('平均度數', 0):.2f}")
            else:
                print(f"   Stats: {stats}")
        else:
            print(f"   ❌ Stats error: {response.status_code}")
    except Exception as e:
        print(f"   ❌ Cannot get stats: {e}")

    # 6. Test UI endpoint
    print("\n6️⃣ Testing SvelteKit UI endpoint...")
    try:
        response = requests.get("http://localhost:5173/api/rag/graph/stats", timeout=5)
        if response.status_code == 200:
            stats = response.json()
            print(f"   ✅ UI endpoint working:")
            if stats.get('success'):
                graph_stats = stats.get('stats', {})
                print(f"      - 總節點數: {graph_stats.get('總節點數', 0)}")
                print(f"      - 總邊數: {graph_stats.get('總邊數', 0)}")
            else:
                print(f"   Stats: {stats}")
        else:
            print(f"   ❌ UI endpoint error: {response.status_code}")
    except Exception as e:
        print(f"   ❌ Cannot connect to UI: {e}")

    # 7. Test query
    print("\n7️⃣ Testing query with extracted knowledge...")
    try:
        payload = {
            "query": "What is this paper about?",
            "mode": "hybrid",
            "workspace": "default"
        }
        response = requests.post(
            "http://localhost:8020/query",
            json=payload,
            timeout=60
        )

        if response.status_code == 200:
            result = response.json()
            print(f"   ✅ Query successful:")
            print(f"      Answer (first 200 chars): {result.get('answer', '')[:200]}...")
        else:
            print(f"   ❌ Query failed: {response.status_code}")
    except Exception as e:
        print(f"   ❌ Query error: {e}")

    print("\n=== Test Complete ===")
    print("\n📊 Next steps:")
    print("   1. Open browser: http://localhost:5173/admin/rag")
    print("   2. Click on 'Graph' tab")
    print("   3. Verify that node/edge counts are displayed")
    print("   4. Test search and visualization features")

if __name__ == "__main__":
    asyncio.run(test_kg_workflow())
