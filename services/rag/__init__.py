"""
LightRAG Service Module - 解耦的 RAG 服務

直接 import 使用 RAG 服務，無需 HTTP API。

使用方式：

    # 方式1: 使用單例服務
    from services.rag import RAGService
    rag = await RAGService.get_instance()
    result = await rag.query("問題")

    # 方式2: 使用便捷函數
    from services.rag import query, query_stream, get_context
    result = await query("問題")

    # 方式3: 串流輸出
    async for token in query_stream("問題"):
        print(token, end="")

注意：使用前需要確保以下服務已啟動：
- vLLM Qwen3-VL-32B: port 8002
- vLLM BGE-M3 (embedding): port 8003
"""

from .service import (
    RAGService,
    query,
    query_stream,
    get_context,
)

__all__ = [
    "RAGService",
    "query",
    "query_stream",
    "get_context",
]
