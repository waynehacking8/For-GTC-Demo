"""
LightRAG Service - 解耦的 RAG 服務模組

這是一個獨立的 Python 模組，可以直接 import 使用，無需透過 HTTP API。
直接連接到已存在的 LightRAG 儲存和 vLLM 服務。

使用方式：
    from src.lib.rag.service import RAGService

    # 初始化（單例模式）
    rag = await RAGService.get_instance()

    # 查詢
    result = await rag.query("正崴2024年的EPS是多少？")

    # 串流查詢
    async for token in rag.query_stream("正崴2024年的EPS是多少？"):
        print(token, end="", flush=True)
"""

import os
import sys
import json
import asyncio
from typing import Optional, Dict, Any, AsyncGenerator
from pathlib import Path

# 添加 phase3-rag 到 Python path
PHASE3_RAG_PATH = "/home/wayne/Desktop/LocalMind/phase3-rag"
if PHASE3_RAG_PATH not in sys.path:
    sys.path.insert(0, PHASE3_RAG_PATH)


class RAGService:
    """
    LightRAG 服務封裝類

    提供單例模式的 RAG 服務，可以直接在 Python 中使用，
    無需透過 HTTP API 呼叫。
    """

    _instance: Optional['RAGService'] = None
    _initialized: bool = False

    def __init__(self):
        self.rag_system = None
        self.working_dir = "/home/wayne/Desktop/LocalMind/phase3-rag/api_rag_storage"
        self.workspace = "api_workspace"
        self.llm_model = "Qwen/Qwen3-VL-32B-Instruct"
        self.vllm_url = "http://localhost:8002/v1/chat/completions"
        self.embedding_url = "http://localhost:8003/v1/embeddings"

    @classmethod
    async def get_instance(cls) -> 'RAGService':
        """
        獲取 RAGService 單例實例

        Returns:
            RAGService: 初始化完成的 RAG 服務實例
        """
        if cls._instance is None:
            cls._instance = RAGService()

        if not cls._initialized:
            await cls._instance._initialize()
            cls._initialized = True

        return cls._instance

    async def _initialize(self):
        """初始化 LightRAG 系統"""
        try:
            # 設定環境變數
            os.environ['LIGHTRAG_LLM_MODEL'] = self.llm_model

            # Import LightRAG 相關模組
            from src.rag.multimodal_system import create_multimodal_rag

            print(f"🔧 初始化 RAG 服務...")
            print(f"   工作目錄: {self.working_dir}")
            print(f"   LLM 模型: {self.llm_model}")

            self.rag_system = await create_multimodal_rag(
                working_dir=self.working_dir,
                workspace=self.workspace,
                llm_model_name=self.llm_model,
                embedding_model_name="BAAI/bge-m3",
                chunk_token_size=1200,
                chunk_overlap_token_size=100,
                llm_model_max_async=32,
                entity_extract_max_gleaning=0,
                max_parallel_insert=8,
                enable_monitoring=True,
                enable_logging=True,
            )

            print("✅ RAG 服務初始化完成")

        except Exception as e:
            print(f"❌ RAG 服務初始化失敗: {e}")
            raise

    async def query(
        self,
        query_text: str,
        mode: str = "naive",
        top_k: int = 20,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        執行 RAG 查詢

        Args:
            query_text: 查詢文字
            mode: 查詢模式 (naive, local, global, hybrid)
            top_k: 返回結果數量
            system_prompt: 自定義系統提示詞

        Returns:
            包含 answer, success, sources 等的字典
        """
        if self.rag_system is None:
            raise RuntimeError("RAG 服務尚未初始化，請先呼叫 get_instance()")

        try:
            result = await self.rag_system.query(
                query_text=query_text,
                mode=mode,
                top_k=top_k,
                return_sources=True,
                use_cache=True,
                system_prompt=system_prompt,
            )
            return result
        except Exception as e:
            return {
                "answer": f"查詢錯誤: {str(e)}",
                "success": False,
                "sources": [],
                "error": str(e)
            }

    async def query_stream(
        self,
        query_text: str,
        mode: str = "naive",
        top_k: int = 20,
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        串流 RAG 查詢 - 逐 token 返回

        Args:
            query_text: 查詢文字
            mode: 查詢模式 (naive, local, global, hybrid)
            top_k: 返回結果數量
            system_prompt: 自定義系統提示詞

        Yields:
            str: 每個生成的 token
        """
        if self.rag_system is None:
            raise RuntimeError("RAG 服務尚未初始化，請先呼叫 get_instance()")

        try:
            async for token in self.rag_system.query_stream(
                query_text=query_text,
                mode=mode,
                top_k=top_k,
                system_prompt=system_prompt,
            ):
                yield token
        except Exception as e:
            yield f"\n\n[錯誤: {str(e)}]"

    async def get_context(
        self,
        query_text: str,
        mode: str = "naive",
        top_k: int = 20
    ) -> str:
        """
        只獲取知識庫上下文，不生成回答

        用於需要自行處理上下文的場景

        Args:
            query_text: 查詢文字
            mode: 查詢模式
            top_k: 返回結果數量

        Returns:
            str: 知識庫上下文
        """
        if self.rag_system is None:
            raise RuntimeError("RAG 服務尚未初始化，請先呼叫 get_instance()")

        try:
            from lightrag import QueryParam

            query_param = QueryParam(
                mode=mode,
                top_k=top_k,
                only_need_context=True,
            )

            context = await self.rag_system.rag.aquery(query_text, param=query_param)
            return context
        except Exception as e:
            return f"獲取上下文錯誤: {str(e)}"

    def is_initialized(self) -> bool:
        """檢查服務是否已初始化"""
        return self.rag_system is not None


# 便捷函數 - 可以直接 import 使用
async def query(query_text: str, **kwargs) -> Dict[str, Any]:
    """
    便捷查詢函數

    使用方式:
        from src.lib.rag.service import query
        result = await query("正崴2024年的EPS是多少？")
    """
    rag = await RAGService.get_instance()
    return await rag.query(query_text, **kwargs)


async def query_stream(query_text: str, **kwargs) -> AsyncGenerator[str, None]:
    """
    便捷串流查詢函數

    使用方式:
        from src.lib.rag.service import query_stream
        async for token in query_stream("正崴2024年的EPS是多少？"):
            print(token, end="")
    """
    rag = await RAGService.get_instance()
    async for token in rag.query_stream(query_text, **kwargs):
        yield token


async def get_context(query_text: str, **kwargs) -> str:
    """
    便捷獲取上下文函數

    使用方式:
        from src.lib.rag.service import get_context
        context = await get_context("正崴營收")
    """
    rag = await RAGService.get_instance()
    return await rag.get_context(query_text, **kwargs)


# 測試用主程式
if __name__ == "__main__":
    async def test():
        print("=" * 50)
        print("RAG 服務測試")
        print("=" * 50)

        # 測試查詢
        rag = await RAGService.get_instance()

        query_text = "正崴2024年的每股盈餘EPS是多少？"
        print(f"\n查詢: {query_text}")
        print("-" * 50)

        # 串流輸出
        async for token in rag.query_stream(query_text, mode="naive"):
            print(token, end="", flush=True)

        print("\n")
        print("=" * 50)

    asyncio.run(test())
