/**
 * Two-Layer Knowledge System
 *
 * Layer 1: Personal Memory (PostgreSQL DB)
 *   - User profile (name, interests, preferences)
 *   - Image descriptions/features
 *   - Conversation summaries
 *   - Cross-session persistence
 *
 * Layer 2: Knowledge RAG (LightRAG)
 *   - Company financial data
 *   - External documents
 *   - Domain knowledge
 *
 * Flow: Query Memory first -> If no results, query RAG
 */

import { db } from './db/index.js';
import { chatMemories } from './db/schema.js';
import { eq, and, or, ilike, desc } from 'drizzle-orm';
import { queryRAG, isRAGAvailable, type RAGQueryOptions } from './rag.js';

// ============ Types ============

export interface KnowledgeQueryResult {
	source: 'memory' | 'rag' | 'none';
	found: boolean;
	data: any;
	confidence: number;
	context?: string;
}

export interface MemorySearchResult {
	key: string;
	value: any;
	memoryType: string;
	relevance: number;
	updatedAt: Date;
}

export interface KnowledgeContext {
	memoryContext: string | null;
	ragContext: string | null;
	source: 'memory' | 'rag' | 'both' | 'none';
}

// ============ Layer 1: Personal Memory API ============

/**
 * Search user's personal memory for relevant information
 * Uses keyword matching and semantic similarity
 */
export async function searchPersonalMemory(
	userId: string,
	query: string
): Promise<MemorySearchResult[]> {
	// Extract keywords from query for search
	const keywords = extractKeywords(query);

	if (keywords.length === 0) {
		return [];
	}

	// Search in long_term and entity memories (cross-session)
	const conditions = [
		eq(chatMemories.userId, userId),
		or(
			eq(chatMemories.memoryType, 'long_term'),
			eq(chatMemories.memoryType, 'entity')
		)
	];

	const memories = await db
		.select()
		.from(chatMemories)
		.where(and(...conditions))
		.orderBy(desc(chatMemories.updatedAt));

	// Score and filter memories by relevance
	const scoredMemories: MemorySearchResult[] = [];

	for (const memory of memories) {
		const relevance = calculateRelevance(memory.key, memory.value, keywords);
		if (relevance > 0) {
			scoredMemories.push({
				key: memory.key,
				value: memory.value,
				memoryType: memory.memoryType,
				relevance,
				updatedAt: memory.updatedAt
			});
		}
	}

	// Sort by relevance
	scoredMemories.sort((a, b) => b.relevance - a.relevance);

	return scoredMemories.slice(0, 10); // Return top 10 results
}

// Memory API endpoint configuration
const MEMORY_API_URL = process.env.MEMORY_API_URL || 'http://localhost:8021';

/**
 * Get all user profile memories via Memory API (Layer 1)
 * Uses the independent Memory API service on port 8021
 */
export async function getUserProfile(userId: string): Promise<Record<string, any>> {
	try {
		const response = await fetch(`${MEMORY_API_URL}/memory/profile/${userId}`);

		if (!response.ok) {
			console.error(`[Knowledge L1] Memory API error: ${response.status}`);
			return {};
		}

		const result = await response.json();

		if (result.success && result.data) {
			console.log(`[Knowledge L1] Got ${result.count} profile items from Memory API`);
			return result.data;
		}

		return {};
	} catch (error) {
		console.error('[Knowledge L1] Failed to connect to Memory API:', error);
		// Fallback to direct DB query if Memory API is unavailable
		return await getUserProfileFromDB(userId);
	}
}

/**
 * Fallback: Get user profile directly from database (if Memory API unavailable)
 */
async function getUserProfileFromDB(userId: string): Promise<Record<string, any>> {
	const profileKeys = [
		'user_name', 'name', 'username',
		'user_interests', 'interests',
		'user_hobbies', 'hobby',
		'favorite_food', 'favorite_drink', 'favorite_cake',
		'occupation', 'location', 'age',
		'image_description', 'profile_image'
	];

	const memories = await db
		.select()
		.from(chatMemories)
		.where(
			and(
				eq(chatMemories.userId, userId),
				eq(chatMemories.memoryType, 'long_term')
			)
		);

	const profile: Record<string, any> = {};

	for (const memory of memories) {
		// Check if this is a profile-related key
		const isProfileKey = profileKeys.some(pk =>
			memory.key.toLowerCase().includes(pk.toLowerCase())
		);

		if (isProfileKey) {
			profile[memory.key] = memory.value;
		}
	}

	console.log('[Knowledge L1] Fallback: Got profile from direct DB');
	return profile;
}

/**
 * Save or update user memory via Memory API (Layer 1)
 * Uses the independent Memory API service on port 8021
 */
export async function saveUserMemory(
	userId: string,
	key: string,
	value: any,
	memoryType: 'long_term' | 'entity' = 'long_term'
): Promise<void> {
	try {
		const response = await fetch(`${MEMORY_API_URL}/memory`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId,
				key,
				value,
				memoryType
			})
		});

		if (!response.ok) {
			console.error(`[Knowledge L1] Memory API save error: ${response.status}`);
			// Fallback to direct DB save
			await saveUserMemoryToDB(userId, key, value, memoryType);
			return;
		}

		const result = await response.json();
		console.log(`[Knowledge L1] ${result.message}`);
	} catch (error) {
		console.error('[Knowledge L1] Failed to save via Memory API:', error);
		// Fallback to direct DB save
		await saveUserMemoryToDB(userId, key, value, memoryType);
	}
}

/**
 * Fallback: Save user memory directly to database (if Memory API unavailable)
 */
async function saveUserMemoryToDB(
	userId: string,
	key: string,
	value: any,
	memoryType: 'long_term' | 'entity' = 'long_term'
): Promise<void> {
	// Check if exists
	const existing = await db
		.select()
		.from(chatMemories)
		.where(
			and(
				eq(chatMemories.userId, userId),
				eq(chatMemories.key, key),
				eq(chatMemories.memoryType, memoryType)
			)
		)
		.limit(1);

	if (existing.length > 0) {
		// Update
		await db
			.update(chatMemories)
			.set({
				value,
				metadata: {
					...existing[0].metadata as object,
					lastAccessed: new Date().toISOString(),
					previousValue: existing[0].value,
					updatedAt: new Date().toISOString()
				},
				updatedAt: new Date()
			})
			.where(eq(chatMemories.id, existing[0].id));

		console.log(`[Knowledge L1] Fallback: Updated memory: ${key}`);
	} else {
		// Insert
		await db.insert(chatMemories).values({
			userId,
			key,
			value,
			memoryType,
			metadata: {
				importance: 5,
				lastAccessed: new Date().toISOString(),
				accessCount: 1
			}
		});

		console.log(`[Knowledge L1] Fallback: Created memory: ${key}`);
	}
}

// ============ Layer 2: RAG API ============

/**
 * Query external knowledge base (RAG)
 */
export async function queryKnowledgeBase(
	query: string,
	options?: Partial<RAGQueryOptions>
): Promise<{ answer: string; sources?: string[] } | null> {
	const available = await isRAGAvailable();
	if (!available) {
		console.log('[Knowledge L2] RAG system not available');
		return null;
	}

	try {
		const result = await queryRAG({
			query,
			mode: options?.mode || 'hybrid',
			topK: options?.topK || 10,
			returnSources: true,
			useCache: options?.useCache ?? true,
			systemPrompt: options?.systemPrompt
		});

		if (result.error || !result.answer || result.answer.trim().length === 0) {
			return null;
		}

		console.log(`[Knowledge L2] RAG returned answer (${result.answer.length} chars)`);
		return {
			answer: result.answer,
			sources: result.sources
		};
	} catch (error) {
		console.error('[Knowledge L2] RAG query error:', error);
		return null;
	}
}

// ============ Unified Query Interface ============

/**
 * Main entry point: Query both layers intelligently
 *
 * Flow:
 * 1. Always get user profile from Memory (for identity/preference questions)
 * 2. Check if query is about personal info -> Use Memory only
 * 3. Check if query is about external knowledge -> Use RAG
 * 4. For ambiguous queries -> Try Memory first, then RAG if no results
 */
export async function queryKnowledge(
	userId: string,
	query: string,
	options?: {
		forceMemory?: boolean;
		forceRAG?: boolean;
		systemPrompt?: string;
	}
): Promise<KnowledgeContext> {
	const result: KnowledgeContext = {
		memoryContext: null,
		ragContext: null,
		source: 'none'
	};

	// Step 1: Get user profile (always)
	const userProfile = await getUserProfile(userId);
	const hasProfile = Object.keys(userProfile).length > 0;

	// Step 2: Determine query type
	const queryType = classifyQuery(query);
	console.log(`[Knowledge] Query type: ${queryType} for: "${query.substring(0, 50)}..."`);

	// Step 3: Query appropriate layer(s)
	if (options?.forceRAG) {
		// Force RAG only
		const ragResult = await queryKnowledgeBase(query, { systemPrompt: options.systemPrompt });
		if (ragResult) {
			result.ragContext = ragResult.answer;
			result.source = 'rag';
		}
	} else if (options?.forceMemory || queryType === 'personal') {
		// Personal query - use Memory only
		result.memoryContext = formatMemoryContext(userProfile, query);
		if (result.memoryContext) {
			result.source = 'memory';
		}
	} else if (queryType === 'knowledge') {
		// Knowledge query - use RAG primarily, but include profile for context
		const ragResult = await queryKnowledgeBase(query, { systemPrompt: options?.systemPrompt });
		if (ragResult) {
			result.ragContext = ragResult.answer;
			result.source = 'rag';
		}
		// Also include basic profile if available
		if (hasProfile) {
			result.memoryContext = formatMemoryContext(userProfile, query);
			if (result.ragContext) {
				result.source = 'both';
			}
		}
	} else {
		// Ambiguous - try Memory first, then RAG
		const memoryResults = await searchPersonalMemory(userId, query);

		if (memoryResults.length > 0 && memoryResults[0].relevance > 0.5) {
			// Memory has relevant results
			result.memoryContext = formatMemoryContext(userProfile, query);
			result.source = 'memory';
		} else {
			// Try RAG
			const ragResult = await queryKnowledgeBase(query, { systemPrompt: options?.systemPrompt });
			if (ragResult) {
				result.ragContext = ragResult.answer;
				result.source = 'rag';
			}
			// Include profile context too
			if (hasProfile) {
				result.memoryContext = formatMemoryContext(userProfile, query);
				if (result.source === 'rag') {
					result.source = 'both';
				} else if (result.memoryContext) {
					result.source = 'memory';
				}
			}
		}
	}

	console.log(`[Knowledge] Result source: ${result.source}`);
	return result;
}

// ============ Helper Functions ============

/**
 * Extract keywords from query for search
 */
function extractKeywords(query: string): string[] {
	// Remove common Chinese stop words and punctuation
	const stopWords = [
		'的', '是', '在', '我', '你', '他', '她', '它', '們',
		'這', '那', '有', '了', '嗎', '呢', '啊', '吧', '呀',
		'什麼', '怎麼', '為什麼', '哪', '誰', '幾', '多少',
		'和', '與', '或', '但', '而', '也', '都', '就', '還',
		'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be',
		'what', 'who', 'how', 'why', 'when', 'where', 'which'
	];

	// Split by common delimiters
	const tokens = query
		.replace(/[，。！？、；：""''（）【】\s]+/g, ' ')
		.split(' ')
		.filter(t => t.length > 0);

	// Filter out stop words
	const keywords = tokens.filter(t => !stopWords.includes(t.toLowerCase()));

	return keywords;
}

/**
 * Calculate relevance score between memory and keywords
 */
function calculateRelevance(key: string, value: any, keywords: string[]): number {
	const keyLower = key.toLowerCase();
	const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
	const valueLower = valueStr.toLowerCase();

	let score = 0;

	for (const keyword of keywords) {
		const kwLower = keyword.toLowerCase();

		// Exact match in key
		if (keyLower.includes(kwLower)) {
			score += 1.0;
		}

		// Exact match in value
		if (valueLower.includes(kwLower)) {
			score += 0.8;
		}
	}

	// Normalize by number of keywords
	return keywords.length > 0 ? score / keywords.length : 0;
}

/**
 * Classify query type
 */
function classifyQuery(query: string): 'personal' | 'knowledge' | 'ambiguous' {
	// Personal patterns (about the user themselves)
	const personalPatterns = [
		/我(叫|是)什麼/,
		/我的(名字|興趣|愛好|喜好|偏好)/,
		/你(知道|記得|認識)我/,
		/我是誰/,
		/我(喜歡|愛|討厭)(吃|喝|玩|做|看)/,
		/關於我/,
		/(本大爺|老子|在下|鄙人)(是誰|叫什麼)/,
		/我的(工作|職業|年齡|地址)/,
		/my name/i,
		/who am i/i,
		/what do i like/i
	];

	// Knowledge patterns (about external facts/data)
	const knowledgePatterns = [
		/營業(成本|收入|毛利)/,
		/財報|財務報告/,
		/EPS|每股盈餘/,
		/(正崴|鴻海|台積電|Foxlink|TSMC)/,
		/\d{4}年/,
		/民國\d+年/,
		/公司|企業|股票/,
		/research|report|data|statistics/i
	];

	// Check patterns
	const isPersonal = personalPatterns.some(p => p.test(query));
	const isKnowledge = knowledgePatterns.some(p => p.test(query));

	if (isPersonal && !isKnowledge) {
		return 'personal';
	} else if (isKnowledge && !isPersonal) {
		return 'knowledge';
	} else {
		return 'ambiguous';
	}
}

/**
 * Format memory context for LLM
 */
function formatMemoryContext(profile: Record<string, any>, query: string): string | null {
	if (Object.keys(profile).length === 0) {
		return null;
	}

	const lines: string[] = ['【用戶個人記憶】'];

	// Format known fields with Chinese labels
	const fieldMap: Record<string, string> = {
		'user_name': '👤 用戶名字',
		'name': '👤 用戶名字',
		'username': '👤 用戶名字',
		'user_interests': '💡 興趣',
		'interests': '💡 興趣',
		'user_hobbies': '🎯 愛好',
		'hobby': '🎯 愛好',
		'favorite_food': '🍽️ 喜歡的食物',
		'favorite_drink': '🥤 喜歡的飲料',
		'favorite_cake': '🍰 喜歡的蛋糕',
		'occupation': '💼 職業',
		'location': '📍 地點',
		'age': '🎂 年齡',
		'image_description': '🖼️ 圖片描述',
		'profile_image': '🖼️ 個人照片'
	};

	for (const [key, value] of Object.entries(profile)) {
		// Find matching label
		let label = key;
		for (const [pattern, chineseLabel] of Object.entries(fieldMap)) {
			if (key.toLowerCase().includes(pattern.toLowerCase())) {
				label = chineseLabel;
				break;
			}
		}

		// Parse value - handle double-encoded JSON strings
		let valueStr: string;
		if (typeof value === 'string') {
			// Try to parse if it looks like a JSON string (starts and ends with quotes)
			if (value.startsWith('"') && value.endsWith('"')) {
				try {
					valueStr = JSON.parse(value);
				} catch {
					valueStr = value;
				}
			} else {
				valueStr = value;
			}
		} else {
			valueStr = JSON.stringify(value);
		}
		lines.push(`${label}: ${valueStr}`);
	}

	return lines.join('\n');
}

// ============ LLM-based Memory Detection via Memory API ============

export interface DetectedMemoryUpdate {
	action: 'update' | 'delete';
	key: string;
	value?: string;
	pattern: string;
}

export interface MemoryOperationResult {
	detected: DetectedMemoryUpdate[];
	applied: string[];
	deleted: string[];
}

/**
 * Detect and apply memory operations from user message using LLM via Memory API
 * Supports both update and delete operations
 *
 * @param userId - User ID to apply operations for
 * @param message - User message to analyze
 * @param apply - Whether to apply the operations (default: true)
 */
export async function detectMemoryUpdatesAsync(
	userId: string,
	message: string,
	apply: boolean = true
): Promise<MemoryOperationResult> {
	try {
		const response = await fetch(`${MEMORY_API_URL}/memory/detect`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId,
				message,
				apply
			})
		});

		if (!response.ok) {
			console.error(`[Knowledge] Memory API detect error: ${response.status}`);
			return { detected: [], applied: [], deleted: [] };
		}

		const result = await response.json();

		if (result.success && result.data) {
			const detected = (result.data.detected || []).map((d: { action?: string; key: string; value?: string }) => ({
				action: d.action || 'update',
				key: d.key,
				value: d.value,
				pattern: 'llm'
			}));

			return {
				detected,
				applied: result.data.applied || [],
				deleted: result.data.deleted || []
			};
		}

		return { detected: [], applied: [], deleted: [] };
	} catch (error) {
		console.error('[Knowledge] Failed to detect via Memory API:', error);
		return { detected: [], applied: [], deleted: [] };
	}
}

/**
 * Synchronous wrapper for backwards compatibility
 * Note: This always returns empty array - use detectMemoryUpdatesAsync instead
 * @deprecated Use detectMemoryUpdatesAsync instead
 */
export function detectMemoryUpdates(message: string): DetectedMemoryUpdate[] {
	// Return empty - caller should use async version
	console.warn('[Knowledge] detectMemoryUpdates is deprecated, use detectMemoryUpdatesAsync');
	return [];
}

/**
 * Apply detected memory updates to database
 */
export async function applyMemoryUpdates(
	userId: string,
	updates: DetectedMemoryUpdate[]
): Promise<string[]> {
	const applied: string[] = [];

	for (const update of updates) {
		await saveUserMemory(userId, update.key, update.value, 'long_term');
		applied.push(update.key);
		console.log(`[Knowledge] Applied instant update: ${update.key} = "${update.value}"`);
	}

	return applied;
}
