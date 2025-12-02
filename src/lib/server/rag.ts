/**
 * LightRAG Integration Service
 *
 * This service provides integration with the LightRAG knowledge graph system
 * for document retrieval and question answering.
 */

const LIGHTRAG_API_URL = 'http://localhost:8020';

// Default system prompt for RAG queries to ensure accurate data presentation
const RAG_DEFAULT_SYSTEM_PROMPT = `你是一個專業的財務數據分析助手。知識庫中的所有數據都來自已發布的正式財務報告。

重要規則：
1. 所有數據都是已確認的財報數據，不是預測或預估值
2. 回答時直接陳述數據，不要使用「預計」、「估計」、「預測」等詞彙
3. 使用精確的數字和年份
4. 如果數據來自特定年度的財報，直接說明是該年度的數據
5. 【最重要】各年度財務數據請優先參考「營業計畫實施成果」表格，此表格包含營業收入、營業成本、營業毛利等關鍵數據
6. 當用戶詢問「近幾年」或「最新」數據時，務必包含最新年度（民國113年/2024年）的數據
7. 使用合併報表（Consolidated）數據，忽略個體報表數據
8. 如果「營業計畫實施成果」表格與「合併損益表」數據不一致，以「營業計畫實施成果」為準
9. 【嚴格禁止推導歷史數據】引用已存在的財報數據時，絕對禁止展示計算過程。錯誤示範：「營業收入增加7,846,697仟元，即達98,397,461仟元」。正確示範：「2024年營業收入為98,397,461仟元」。每一年的財報都直接記載該年度的數字，不需要從前一年推算
10. 【區分引用與分析】引用歷史數據時只能直接陳述數字；只有在用戶明確要求「計算」、「推斷」、「預測」未來數據時，才可進行數學運算和趨勢分析

🚨【2024年/民國113年數據處理規則】🚨
11. 【絕對禁止說沒有2024資料】知識庫包含2024年（民國113年）的財報數據。絕對禁止說「2024年沒有資料」或「知識庫中沒有這項資料」
12. 【必須計算可推導的指標】如果用戶詢問的指標沒有直接數據，但有相關數據可以計算：
    a. 負債比率 = 負債總額 / 資產總額 × 100%
    b. 毛利率 = 營業毛利 / 營業收入 × 100%
    c. 淨利率 = 稅後淨利 / 營業收入 × 100%
    d. EPS = 歸屬於母公司業主之淨利 / 普通股加權平均流通在外股數
    e. 【必須呈現計算結果】例如：「2024年負債比率 = 90,208,545 / 130,511,628 = 69.12%」
    f. 不要只說「可推斷上升」，要給出具體計算結果
13. 【不能直接計算時的處理】如果確實無法計算用戶要的指標，說「知識庫中有XX和YY的數據，但沒有直接列出ZZ」，不要只說「沒有資料」
14. 【禁止在財務回答中提及用戶個人資訊】回答財務數據問題時，絕對禁止提及用戶的姓名、興趣、喜好等個人資訊。用戶問的是公司財報數據，不要回應「XX您好」或「根據您的記憶」等無關內容。直接回答財務問題即可`;

export interface RAGQueryOptions {
	query: string;
	mode?: 'naive' | 'local' | 'global' | 'hybrid';
	topK?: number;
	returnSources?: boolean;
	useCache?: boolean;
	systemPrompt?: string;
}

export interface RAGResponse {
	answer: string;
	sources?: string[];
	mode?: string;
	error?: string;
}

/**
 * Query the LightRAG system
 */
export async function queryRAG(options: RAGQueryOptions): Promise<RAGResponse> {
	const {
		query,
		mode = 'hybrid',
		topK = 5,
		returnSources = true,
		useCache = true,
		systemPrompt
	} = options;

	try {
		const response = await fetch(`${LIGHTRAG_API_URL}/query`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query,
				mode,
				top_k: topK,
				return_sources: returnSources,
				use_cache: useCache,
				system_prompt: systemPrompt
					? `${RAG_DEFAULT_SYSTEM_PROMPT}\n\n${systemPrompt}`
					: RAG_DEFAULT_SYSTEM_PROMPT
			})
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(errorData.error || `RAG query failed: ${response.statusText}`);
		}

		const data = await response.json();
		return {
			answer: data.answer || '',
			sources: data.sources || [],
			mode: data.mode
		};
	} catch (error) {
		console.error('[RAG] Query error:', error);
		return {
			answer: '',
			error: error instanceof Error ? error.message : 'Unknown error querying RAG system'
		};
	}
}

/**
 * Check if RAG system is available
 */
export async function isRAGAvailable(): Promise<boolean> {
	try {
		const response = await fetch(`${LIGHTRAG_API_URL}/health`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			return false;
		}

		const data = await response.json();
		return data.status === 'healthy' && data.system_initialized === true;
	} catch (error) {
		console.error('[RAG] Health check error:', error);
		return false;
	}
}

/**
 * Get RAG context for a user query
 * This function checks if RAG can provide useful context for the query
 */
export async function getRAGContext(query: string): Promise<string | null> {
	// Check if RAG is available
	const available = await isRAGAvailable();
	if (!available) {
		console.log('[RAG] System not available, skipping context retrieval');
		return null;
	}

	try {
		// Query RAG system
		const result = await queryRAG({
			query,
			mode: 'hybrid',
			topK: 5,
			returnSources: true,
			useCache: true
		});

		if (result.error) {
			console.error('[RAG] Error retrieving context:', result.error);
			return null;
		}

		if (!result.answer || result.answer.trim().length === 0) {
			console.log('[RAG] No relevant context found');
			return null;
		}

		// Format the RAG context for inclusion in the conversation
		let context = `[Knowledge Base Context]\n${result.answer}`;

		if (result.sources && result.sources.length > 0) {
			context += `\n\nSources: ${result.sources.slice(0, 3).join(', ')}`;
		}

		console.log('[RAG] Retrieved context successfully');
		return context;
	} catch (error) {
		console.error('[RAG] Error in getRAGContext:', error);
		return null;
	}
}

/**
 * Smart RAG Router - uses LLM to determine if query needs RAG
 * Returns: true if should use RAG, false if casual chat or personal memory questions
 */
export async function shouldQueryRAG(query: string): Promise<boolean> {
	try {
		// Quick check: personal preference/memory questions should NOT use RAG
		const personalPatterns = [
			/我(愛|喜歡|討厭|不愛|不喜歡)(吃|喝|玩|做|看)/,
			/我(叫|是|的名字)/,
			/我的(興趣|愛好|喜好|偏好|名字)/,
			/(你|妳)(知道|記得|還記得)我/,
			/關於我/,
			/(我|自己)(有什麼|有哪些|是什麼)/,
			/(本大爺|老子|小弟|在下|鄙人|本人)(是誰|叫什麼|的名字)/,  // Casual/slang identity questions
			/你(認識|知道|記得)(我|本大爺|老子)/,  // "Do you know me" variations
			/我(是|不是).*你(記得|知道)/,  // "Am I someone you remember"
			/忘了.*嗎/,  // "Did you forget?" patterns
			/你忘記我/,  // "You forgot me"
		];

		const isPersonalQuestion = personalPatterns.some(pattern => pattern.test(query));
		if (isPersonalQuestion) {
			console.log(`[RAG Router] Personal question detected, skipping RAG: "${query.substring(0, 50)}..."`);
			return false;
		}

		// Quick check: financial keywords should ALWAYS use RAG
		const financialKeywords = [
			'營業成本', '營業收入', '營收', '毛利', '營業毛利', '淨利', '稅後淨利',
			'EPS', '每股盈餘', '財報', '財務報告', '損益表', '資產負債表',
			'正崴', '鴻海', 'Foxlink', '台積電', 'TSMC',
			'合併報表', '個體報表', '年報', '季報',
			'股利', '配息', '股價', '本益比', 'ROE', 'ROA',
			'負債比', '流動比率', '速動比率'
		];

		const hasFinancialKeyword = financialKeywords.some(keyword => query.includes(keyword));
		if (hasFinancialKeyword) {
			console.log(`[RAG Router] Financial keyword detected, using RAG: "${query.substring(0, 50)}..."`);
			return true;
		}

		// Use a fast, lightweight model for routing decision
		const { getModelProvider } = await import('$lib/ai/index.js');
		const provider = getModelProvider('google/gemma-3-27b-it:free');

		if (!provider) {
			console.warn('[RAG Router] No provider available, defaulting to false');
			return false; // Default to NOT using RAG if we can't determine
		}

		const routingPrompt = `You are a query router. Determine if the user's query requires data from a FINANCIAL KNOWLEDGE BASE.

User Query: "${query}"

Knowledge Base Contains ONLY:
- Company financial reports (revenue, costs, profits, EPS, 營業成本, 營收, 毛利, etc.)
- Taiwan company information (正崴精密, 鴻海, Foxlink, etc.)
- Historical financial data and statistics

The Knowledge Base does NOT contain:
- Personal user information (name, preferences, hobbies)
- General knowledge or facts
- Casual conversation topics

Return ONLY "RAG" or "MEMORY":
- RAG: ONLY for queries about specific company financial data (e.g., "正崴營業成本", "鴻海財報", "EPS多少")
- MEMORY: For personal questions (我叫什麼, 我愛吃什麼, 我的興趣), casual chat, or general questions`;

		const response = await provider.chat({
			model: 'google/gemma-3-27b-it:free',
			messages: [{ role: 'user', content: routingPrompt }],
			maxTokens: 10,
			temperature: 0.1
		});

		if (!response || typeof response !== 'object' || !('content' in response)) {
			console.warn('[RAG Router] Invalid response, defaulting to false');
			return false;
		}

		const decision = (response.content as string).trim().toUpperCase();
		const shouldUseRAG = decision.includes('RAG');

		console.log(`[RAG Router] Query: "${query.substring(0, 50)}..." → Decision: ${decision} → Use RAG: ${shouldUseRAG}`);
		return shouldUseRAG;
	} catch (error) {
		console.error('[RAG Router] Error:', error);
		// On error, check if query contains financial keywords as fallback
		const financialKeywords = ['營業', '營收', '毛利', '淨利', 'EPS', '財報', '正崴', '鴻海'];
		const hasFinancialKeyword = financialKeywords.some(keyword => query.includes(keyword));
		if (hasFinancialKeyword) {
			console.log(`[RAG Router] Error occurred but financial keyword detected, using RAG as fallback`);
			return true;
		}
		return false; // Default to NOT using RAG on error
	}
}

/**
 * Expand query to improve retrieval coverage for recent years
 * Adds year keywords to ensure 2024 (民國113年) data is included in search
 */
function expandQueryForRecentYears(query: string): string {
	// Check if query already contains explicit year references
	const hasExplicitYear = /20\d{2}|民國\d{2,3}年|11[0-3]年/.test(query);

	// Patterns that indicate user wants recent/multiple years data
	const recentYearPatterns = [
		/近幾年|近年|最近幾年|這幾年/,
		/最新|最近/,
		/發展|趨勢|變化|比較/,
		/歷年|歷史/
	];

	const needsYearExpansion = recentYearPatterns.some(pattern => pattern.test(query));

	// If no explicit year AND query implies recent data interest, expand the query
	if (!hasExplicitYear && needsYearExpansion) {
		// Add multiple year references to improve retrieval coverage
		const expandedQuery = `${query} (包含2024年/民國113年、2023年/民國112年、2022年/民國111年的資料)`;
		console.log(`[RAG Query Expansion] Expanded: "${query}" → "${expandedQuery}"`);
		return expandedQuery;
	}

	// For financial queries without year context, add latest year hint
	const financialKeywords = ['營業', '營收', '毛利', '淨利', '成本', 'EPS', '財報', '研發', '費用'];
	const hasFinancialKeyword = financialKeywords.some(kw => query.includes(kw));

	if (!hasExplicitYear && hasFinancialKeyword) {
		const expandedQuery = `${query} (優先搜尋2024年/民國113年最新資料，同時包含歷年數據)`;
		console.log(`[RAG Query Expansion] Financial query expanded: "${query}" → "${expandedQuery}"`);
		return expandedQuery;
	}

	return query;
}

/**
 * Stream RAG answer - returns tokens one by one for better UX
 * Use this for streaming output where first token appears faster
 */
export async function* streamRAGAnswer(
	query: string,
	systemPrompt?: string
): AsyncGenerator<string, void, unknown> {
	// Check if RAG is available
	const available = await isRAGAvailable();
	if (!available) {
		console.log('[RAG] System not available for streaming');
		return;
	}

	// Expand query for better year coverage
	const expandedQuery = expandQueryForRecentYears(query);

	// Combine default RAG prompt with user-provided system prompt
	let effectiveSystemPrompt = RAG_DEFAULT_SYSTEM_PROMPT;
	if (systemPrompt && systemPrompt.trim()) {
		effectiveSystemPrompt = `${RAG_DEFAULT_SYSTEM_PROMPT}\n\n[用戶自定義角色]\n${systemPrompt}`;
	}

	try {
		const response = await fetch(`${LIGHTRAG_API_URL}/query/stream`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query: expandedQuery,
				mode: 'hybrid',
				top_k: 10,
				return_sources: true,
				use_cache: false, // Streaming doesn't use cache
				system_prompt: effectiveSystemPrompt
			})
		});

		if (!response.ok) {
			console.error('[RAG Stream] Failed to connect:', response.statusText);
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			console.error('[RAG Stream] No response body');
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Parse SSE events
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // Keep incomplete line in buffer

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					try {
						const data = JSON.parse(line.slice(6));
						if (data.type === 'token' && data.content) {
							yield data.content;
						} else if (data.type === 'done') {
							console.log('[RAG Stream] Completed');
							return;
						} else if (data.type === 'error') {
							console.error('[RAG Stream] Error:', data.message);
							return;
						}
					} catch {
						// Ignore parse errors for incomplete JSON
					}
				}
			}
		}

		console.log('[RAG Stream] Stream ended');
	} catch (error) {
		console.error('[RAG Stream] Error:', error);
	}
}

/**
 * Get direct RAG answer - returns the RAG system's answer directly
 * Use this when you want to bypass the LLM and return RAG's answer directly
 */
export async function getRAGAnswer(query: string, systemPrompt?: string): Promise<{ answer: string; sources?: string[] } | null> {
	// Check if RAG is available
	const available = await isRAGAvailable();
	if (!available) {
		console.log('[RAG] System not available');
		return null;
	}

	// Expand query to improve coverage for recent years (2024/民國113年)
	const expandedQuery = expandQueryForRecentYears(query);

	// Combine default RAG prompt with any user-provided system prompt
	let effectiveSystemPrompt = RAG_DEFAULT_SYSTEM_PROMPT;
	if (systemPrompt && systemPrompt.trim()) {
		effectiveSystemPrompt = `${RAG_DEFAULT_SYSTEM_PROMPT}\n\n[用戶自定義角色]\n${systemPrompt}`;
	}

	try {
		const result = await queryRAG({
			query: expandedQuery,  // Use expanded query for better year coverage
			mode: 'hybrid',
			topK: 10,  // Optimized: reduced from 15 to 10 for faster retrieval
			returnSources: true,
			useCache: true,  // Enable cache for repeated queries (major speed boost)
			systemPrompt: effectiveSystemPrompt
		});

		if (result.error || !result.answer || result.answer.trim().length === 0) {
			return null;
		}

		console.log('[RAG] Got direct answer from knowledge base');
		return {
			answer: result.answer,
			sources: result.sources
		};
	} catch (error) {
		console.error('[RAG] Error getting RAG answer:', error);
		return null;
	}
}
