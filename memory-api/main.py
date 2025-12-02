"""
Layer 1: Personal Memory API Service

獨立的 HTTP API 服務，運行在 port 8021
連接 PostgreSQL 資料庫存取用戶記憶
使用 LLM 來智能提取記憶更新（取代硬編碼的 regex）
"""

import os
import re
import json
import uuid
import httpx
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============ Configuration ============

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://localmind:localmind_password@localhost:5432/syncai_db"
)

# LLM API for memory extraction
LLM_API_URL = os.environ.get("LLM_API_URL", "http://localhost:8002/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "./Qwen3-VL-32B-Instruct")

# ============ Models ============

class MemoryCreate(BaseModel):
    userId: str
    key: str
    value: Any
    memoryType: str = "long_term"

class MemorySearch(BaseModel):
    userId: str
    query: str
    limit: int = 10

class MemoryDetect(BaseModel):
    userId: str
    message: str
    apply: bool = True

class MemoryResponse(BaseModel):
    success: bool
    data: Any = None
    message: str = ""
    count: int = 0

# ============ Database ============

db_pool: Optional[asyncpg.Pool] = None

async def get_db_pool():
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return db_pool

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    print(f"✅ Memory API connected to PostgreSQL")
    yield
    # Shutdown
    if db_pool:
        await db_pool.close()
        print("Memory API disconnected from PostgreSQL")

# ============ App ============

app = FastAPI(
    title="Memory API (Layer 1)",
    description="Personal Memory Storage Service",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ LLM-based Memory Extraction ============

MEMORY_EXTRACTION_PROMPT = """你是一個記憶管理助手。分析用戶的訊息，判斷是否需要「新增/更新」或「刪除」記憶。

## 操作類型
1. **update** - 新增或更新記憶（用戶告訴你新的資訊）
2. **delete** - 刪除記憶（用戶要求忘記某些資訊）

## 可管理的記憶類型
- user_name: 用戶的真實名字（正式名字）
- user_nickname: 用戶的綽號/暱稱/外號
- user_age: 用戶的年齡
- favorite_food: 喜歡的食物
- favorite_drink: 喜歡的飲料
- user_interests: 興趣愛好
- occupation: 職業
- location: 居住地
- 其他自定義 key（如 methodology, github_repo 等）

## 回覆格式（JSON array）
- 更新記憶：[{"action": "update", "key": "類型", "value": "值"}]
- 刪除記憶：[{"action": "delete", "key": "要刪除的關鍵字或值"}]
- 無操作：[]

## 重要規則
1. 「忘記X」「刪除X」「不要記住X」「把X忘掉」→ action: "delete"
2. 「我叫X」「我喜歡Y」「我的興趣是Z」→ action: "update"
3. 問句（如「我叫什麼」「我是誰」）→ 不提取，回覆 []
4. **【重要】delete 的 key 應該是用戶想要刪除的實際內容**
   - 如果用戶說「忘記草莓蛋糕」，key 應該是 "草莓蛋糕"（實際值），而不是 "favorite_food"（欄位名）
   - 如果用戶說「把我的名字刪掉」，key 應該是 "user_name"（欄位名）或實際名字
5. **【重要】對於 delete 操作，如果內容可能有中英文版本，請同時輸出中文和英文的 delete 操作**
   - 例如「滑雪」也可能存為「Skiing」或「ski」
   - 例如「火鍋」也可能存為「Hot pot」或「hotpot」
6. 只回覆 JSON，不要其他文字

## 範例
用戶：「叫我夏天」
回覆：[{"action": "update", "key": "user_name", "value": "夏天"}]

用戶：「我叫秋天，小金城武是我的綽號」
回覆：[{"action": "update", "key": "user_name", "value": "秋天"}, {"action": "update", "key": "user_nickname", "value": "小金城武"}]

用戶：「我今年29歲」
回覆：[{"action": "update", "key": "user_age", "value": "29"}]

用戶：「忘記AsFT相關資料」
回覆：[{"action": "delete", "key": "AsFT"}]

用戶：「把我的名字刪掉」
回覆：[{"action": "delete", "key": "user_name"}]

用戶：「忘記我喜歡吃草莓蛋糕」
回覆：[{"action": "delete", "key": "草莓蛋糕"}, {"action": "delete", "key": "strawberry cake"}]

用戶：「忘記我喜歡吃草莓蛋糕，我喜歡的是千層蛋糕」
回覆：[{"action": "delete", "key": "草莓蛋糕"}, {"action": "delete", "key": "strawberry cake"}, {"action": "update", "key": "favorite_food", "value": "千層蛋糕"}]

用戶：「忘記我愛滑雪」
回覆：[{"action": "delete", "key": "滑雪"}, {"action": "delete", "key": "skiing"}, {"action": "delete", "key": "ski"}]

用戶：「我不喜歡披薩了，我喜歡牛排」
回覆：[{"action": "delete", "key": "披薩"}, {"action": "delete", "key": "pizza"}, {"action": "update", "key": "favorite_food", "value": "牛排"}]

用戶：「我是誰？」
回覆：[]
"""

async def extract_memories_with_llm(message: str) -> List[Dict[str, str]]:
    """Use LLM to intelligently extract memory operations (update/delete) from user message"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{LLM_API_URL}/chat/completions",
                json={
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
                        {"role": "user", "content": f"用戶訊息：「{message}」"}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 200
                }
            )

            if response.status_code != 200:
                print(f"[Memory API] LLM error: {response.status_code}")
                return []

            result = response.json()
            content = result["choices"][0]["message"]["content"].strip()

            # Handle Qwen3's /think tags
            if "</think>" in content:
                content = content.split("</think>")[-1].strip()

            # Parse JSON response
            # Find JSON array in response
            start = content.find('[')
            end = content.rfind(']') + 1
            if start >= 0 and end > start:
                json_str = content[start:end]
                operations = json.loads(json_str)

                # Validate operations
                valid_ops = []
                for op in operations:
                    if not isinstance(op, dict) or "key" not in op:
                        continue

                    action = op.get("action", "update")  # Default to update for backwards compatibility
                    key = op["key"]

                    if action == "delete":
                        # Delete operation - no value needed
                        valid_ops.append({
                            "action": "delete",
                            "key": key
                        })
                        print(f"[Memory API] LLM detected DELETE: {key}")
                    elif action == "update" and "value" in op:
                        # Update operation - value required
                        value = op["value"]
                        if value and len(str(value)) < 100 and value not in ['什麼', '誰', '哪']:
                            valid_ops.append({
                                "action": "update",
                                "key": key,
                                "value": value
                            })
                            print(f"[Memory API] LLM detected UPDATE: {key} = {value}")

                return valid_ops

            return []

    except Exception as e:
        print(f"[Memory API] LLM extraction error: {e}")
        return []

def detect_memory_updates(message: str) -> List[Dict[str, str]]:
    """Synchronous wrapper - for backwards compatibility only"""
    # This is kept for backwards compatibility but should not be used
    # Use extract_memories_with_llm instead
    return []

# ============ Routes ============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM chat_memory")
        return {
            "status": "healthy",
            "service": "Memory API (Layer 1)",
            "port": 8021,
            "database": "PostgreSQL",
            "totalMemories": count,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

@app.get("/memory")
async def get_memories(
    userId: str = Query(..., description="User ID"),
    key: Optional[str] = Query(None, description="Specific memory key"),
    type: Optional[str] = Query(None, description="Memory type: profile, long_term, entity, all")
):
    """Get user memories"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if type == "profile":
                # Get profile keys
                rows = await conn.fetch(
                    """
                    SELECT key, value, "memoryType", "updatedAt"
                    FROM chat_memory
                    WHERE "userId" = $1 AND "memoryType" = 'long_term'
                    AND (key LIKE '%name%' OR key LIKE '%interest%' OR key LIKE '%hobby%'
                         OR key LIKE '%favorite%' OR key LIKE '%occupation%' OR key LIKE '%age%')
                    """,
                    userId
                )
                profile = {}
                for row in rows:
                    profile[row['key']] = row['value']
                return MemoryResponse(success=True, data=profile, count=len(profile))

            elif key:
                # Get specific key
                row = await conn.fetchrow(
                    'SELECT * FROM chat_memory WHERE "userId" = $1 AND key = $2',
                    userId, key
                )
                if row:
                    return MemoryResponse(success=True, data=dict(row), count=1)
                return MemoryResponse(success=True, data=None, count=0)

            else:
                # Get all memories
                query = 'SELECT * FROM chat_memory WHERE "userId" = $1'
                params = [userId]

                if type and type != "all":
                    query += ' AND "memoryType" = $2'
                    params.append(type)

                rows = await conn.fetch(query, *params)
                memories = [dict(row) for row in rows]
                return MemoryResponse(success=True, data=memories, count=len(memories))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memory")
async def save_memory(data: MemoryCreate):
    """Save or update memory"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Check if exists
            existing = await conn.fetchrow(
                '''SELECT id, value FROM chat_memory
                   WHERE "userId" = $1 AND key = $2 AND "memoryType" = $3''',
                data.userId, data.key, data.memoryType
            )

            value_json = json.dumps(data.value) if not isinstance(data.value, str) else json.dumps(data.value)

            if existing:
                # Update
                await conn.execute(
                    '''UPDATE chat_memory
                       SET value = $1::json, "updatedAt" = NOW()
                       WHERE id = $2''',
                    value_json, existing['id']
                )
                action = "updated"
            else:
                # Insert with UUID
                new_id = str(uuid.uuid4())
                await conn.execute(
                    '''INSERT INTO chat_memory (id, "userId", key, value, "memoryType", "createdAt", "updatedAt")
                       VALUES ($1, $2, $3, $4::json, $5, NOW(), NOW())''',
                    new_id, data.userId, data.key, value_json, data.memoryType
                )
                action = "created"

            return MemoryResponse(
                success=True,
                message=f"Memory '{data.key}' {action} successfully",
                data={"key": data.key, "value": data.value}
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/memory")
async def delete_memory(
    userId: str = Query(...),
    key: Optional[str] = Query(None),
    id: Optional[str] = Query(None)
):
    """Delete memory"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if id:
                await conn.execute(
                    'DELETE FROM chat_memory WHERE "userId" = $1 AND id = $2',
                    userId, id
                )
            elif key:
                await conn.execute(
                    'DELETE FROM chat_memory WHERE "userId" = $1 AND key = $2',
                    userId, key
                )
            else:
                raise HTTPException(status_code=400, detail="Either key or id is required")

            return MemoryResponse(success=True, message="Memory deleted successfully")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memory/search")
async def search_memories(data: MemorySearch):
    """Search memories by keywords"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Simple keyword search
            rows = await conn.fetch(
                '''SELECT key, value, "memoryType", "updatedAt"
                   FROM chat_memory
                   WHERE "userId" = $1
                   AND (key ILIKE $2 OR value::text ILIKE $2)
                   AND "memoryType" IN ('long_term', 'entity')
                   ORDER BY "updatedAt" DESC
                   LIMIT $3''',
                data.userId, f"%{data.query}%", data.limit
            )

            results = [dict(row) for row in rows]
            return MemoryResponse(
                success=True,
                data=results,
                count=len(results),
                message=f"Found {len(results)} memories matching '{data.query}'"
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/memory/detect")
async def detect_and_apply(data: MemoryDetect):
    """Detect memory operations (update/delete) from message using LLM and optionally apply them"""
    try:
        # Use LLM for intelligent memory extraction
        detected = await extract_memories_with_llm(data.message)

        if not detected:
            return MemoryResponse(
                success=True,
                message="No memory operations detected",
                data={"detected": [], "applied": [], "deleted": []}
            )

        applied = []
        deleted = []
        if data.apply:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                for op in detected:
                    action = op.get("action", "update")
                    key = op["key"]

                    if action == "delete":
                        # Delete operation - fuzzy match by key
                        # Delete all memories where key or value contains the search term
                        result = await conn.fetch(
                            '''DELETE FROM chat_memory
                               WHERE "userId" = $1
                               AND (key ILIKE $2 OR value::text ILIKE $2)
                               RETURNING id, key''',
                            data.userId, f"%{key}%"
                        )
                        for row in result:
                            deleted.append(row['key'])
                            print(f"[Memory API] Deleted: {row['key']}")

                    elif action == "update" and "value" in op:
                        # Update operation
                        existing = await conn.fetchrow(
                            '''SELECT id FROM chat_memory
                               WHERE "userId" = $1 AND key = $2 AND "memoryType" = 'long_term' ''',
                            data.userId, key
                        )

                        value_json = json.dumps(op["value"])

                        if existing:
                            await conn.execute(
                                '''UPDATE chat_memory
                                   SET value = $1::json, "updatedAt" = NOW()
                                   WHERE id = $2''',
                                value_json, existing['id']
                            )
                        else:
                            new_id = str(uuid.uuid4())
                            await conn.execute(
                                '''INSERT INTO chat_memory (id, "userId", key, value, "memoryType", "createdAt", "updatedAt")
                                   VALUES ($1, $2, $3, $4::json, 'long_term', NOW(), NOW())''',
                                new_id, data.userId, key, value_json
                            )

                        applied.append(key)
                        print(f"[Memory API] Applied: {key} = {op['value']}")

        # Build response message
        msg_parts = []
        if applied:
            msg_parts.append(f"更新了 {len(applied)} 筆記憶")
        if deleted:
            msg_parts.append(f"刪除了 {len(deleted)} 筆記憶")
        if not msg_parts:
            msg_parts.append("沒有執行任何操作")

        return MemoryResponse(
            success=True,
            message="; ".join(msg_parts),
            data={"detected": detected, "applied": applied, "deleted": deleted},
            count=len(detected)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/memory/profile/{userId}")
async def get_user_profile(userId: str):
    """Get user profile (convenient endpoint)"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT key, value FROM chat_memory
                   WHERE "userId" = $1 AND "memoryType" = 'long_term' ''',
                userId
            )

            profile = {}
            profile_keys = ['name', 'interest', 'hobby', 'favorite', 'occupation', 'age', 'location']

            for row in rows:
                key_lower = row['key'].lower()
                if any(pk in key_lower for pk in profile_keys):
                    profile[row['key']] = row['value']

            return MemoryResponse(success=True, data=profile, count=len(profile))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============ Main ============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8021)
