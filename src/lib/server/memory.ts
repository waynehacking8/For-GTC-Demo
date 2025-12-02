// Memory Management Service for LangChain Integration
// Provides persistent conversation memory across sessions

import { db } from './db/index.js';
import { chatMemories, entityMemories } from './db/schema.js';
import { eq, and, desc, lt, or } from 'drizzle-orm';

// Types
export interface MemoryEntry {
	key: string;
	value: any;
	memoryType?: 'short_term' | 'long_term' | 'summary' | 'entity';
	importance?: number;
	tags?: string[];
	expiresAt?: Date;
}

export interface EntityInfo {
	name: string;
	type: 'person' | 'place' | 'organization' | 'concept' | 'other';
	description?: string;
	facts?: Array<{
		fact: string;
		source?: string;
		confidence?: number;
		timestamp?: string;
	}>;
	relations?: Array<{
		relatedEntity: string;
		relationType: string;
	}>;
}

// Memory Service Class
export class ConversationMemoryService {
	private userId: string;
	private chatId?: string;

	constructor(userId: string, chatId?: string) {
		this.userId = userId;
		this.chatId = chatId;
	}

	// ============ Short-term Memory (current conversation) ============

	/**
	 * Save a memory entry
	 */
	async saveMemory(entry: MemoryEntry): Promise<void> {
		const { key, value, memoryType = 'short_term', importance, tags, expiresAt } = entry;

		await db.insert(chatMemories).values({
			userId: this.userId,
			chatId: this.chatId || null,
			key,
			value,
			memoryType,
			metadata: {
				importance,
				tags,
				lastAccessed: new Date().toISOString(),
				accessCount: 1
			},
			expiresAt: expiresAt || null
		});

		console.log(`[Memory] Saved ${memoryType} memory: ${key} for user ${this.userId}`);
	}

	/**
	 * Get a specific memory by key
	 */
	async getMemory(key: string): Promise<any | null> {
		const memory = await db
			.select()
			.from(chatMemories)
			.where(
				and(
					eq(chatMemories.userId, this.userId),
					eq(chatMemories.key, key),
					this.chatId ? eq(chatMemories.chatId, this.chatId) : undefined
				)
			)
			.limit(1);

		if (memory.length === 0) return null;

		// Update last accessed
		await db
			.update(chatMemories)
			.set({
				metadata: {
					...memory[0].metadata,
					lastAccessed: new Date().toISOString(),
					accessCount: ((memory[0].metadata as any)?.accessCount || 0) + 1
				},
				updatedAt: new Date()
			})
			.where(eq(chatMemories.id, memory[0].id));

		return memory[0].value;
	}

	/**
	 * Get all memories for the current user/chat
	 * Note: long_term and entity memories are NOT filtered by chatId
	 */
	async getAllMemories(
		memoryType?: 'short_term' | 'long_term' | 'summary' | 'entity'
	): Promise<Array<{ key: string; value: any; type: string }>> {
		const conditions = [eq(chatMemories.userId, this.userId)];

		// Only filter by chatId for short_term and summary memories
		// long_term and entity memories should be accessible across all chats
		if (this.chatId && memoryType !== 'long_term' && memoryType !== 'entity') {
			conditions.push(eq(chatMemories.chatId, this.chatId));
		}

		if (memoryType) {
			conditions.push(eq(chatMemories.memoryType, memoryType));
		}

		const memories = await db
			.select()
			.from(chatMemories)
			.where(and(...conditions))
			.orderBy(desc(chatMemories.createdAt));

		return memories.map((m) => ({
			key: m.key,
			value: m.value,
			type: m.memoryType
		}));
	}

	/**
	 * Delete expired memories
	 */
	async cleanupExpiredMemories(): Promise<number> {
		const result = await db
			.delete(chatMemories)
			.where(
				and(
					eq(chatMemories.userId, this.userId),
					lt(chatMemories.expiresAt, new Date())
				)
			);

		console.log(`[Memory] Cleaned up expired memories for user ${this.userId}`);
		return 0; // Drizzle doesn't return affected rows count directly
	}

	// ============ Long-term Memory (cross-session) ============

	/**
	 * Save a long-term memory (persists across sessions)
	 * Long-term memories are NOT bound to chatId - they persist across all chats
	 * For key user profile fields (user_name, interests, etc.), this will UPDATE existing records
	 */
	async saveLongTermMemory(key: string, value: any, importance: number = 5): Promise<void> {
		// Define keys that should be unique per user (upsert behavior)
		const uniqueKeys = [
			'user_name', 'username', 'name',
			'user_interests', 'interests',
			'user_hobbies', 'user_hobby', 'hobby',
			'favorite_food', 'food_preference', 'food_preferences',
			'favorite_drink', 'favorite_cake',
			'occupation', 'location', 'age'
		];

		const shouldUpsert = uniqueKeys.some(uk => key.toLowerCase().includes(uk.toLowerCase()));

		if (shouldUpsert) {
			// Check if this key already exists for this user
			const existing = await db
				.select()
				.from(chatMemories)
				.where(
					and(
						eq(chatMemories.userId, this.userId),
						eq(chatMemories.key, key),
						eq(chatMemories.memoryType, 'long_term')
					)
				)
				.limit(1);

			if (existing.length > 0) {
				// Update existing record
				await db
					.update(chatMemories)
					.set({
						value,
						metadata: {
							importance,
							lastAccessed: new Date().toISOString(),
							accessCount: ((existing[0].metadata as any)?.accessCount || 0) + 1,
							previousValue: existing[0].value, // Keep track of previous value
							updatedAt: new Date().toISOString()
						},
						updatedAt: new Date()
					})
					.where(eq(chatMemories.id, existing[0].id));

				console.log(`[Memory] UPDATED long_term memory: ${key} = "${value}" (was: "${existing[0].value}") for user ${this.userId}`);
				return;
			}
		}

		// Insert new record (default behavior)
		await db.insert(chatMemories).values({
			userId: this.userId,
			chatId: null, // Long-term memories are not bound to specific chats
			key,
			value,
			memoryType: 'long_term',
			metadata: {
				importance,
				lastAccessed: new Date().toISOString(),
				accessCount: 1
			}
		});

		console.log(`[Memory] Saved long_term memory: ${key} for user ${this.userId}`);
	}

	/**
	 * Get long-term memories
	 */
	async getLongTermMemories(): Promise<Array<{ key: string; value: any }>> {
		const memories = await this.getAllMemories('long_term');
		return memories.map((m) => ({ key: m.key, value: m.value }));
	}

	// ============ Conversation Summary ============

	/**
	 * Save a conversation summary
	 */
	async saveSummary(summary: string, chatId?: string): Promise<void> {
		await db.insert(chatMemories).values({
			userId: this.userId,
			chatId: chatId || this.chatId || null,
			key: 'conversation_summary',
			value: { summary, timestamp: new Date().toISOString() },
			memoryType: 'summary',
			metadata: {
				importance: 8
			}
		});

		console.log(`[Memory] Saved conversation summary for user ${this.userId}`);
	}

	/**
	 * Get the latest conversation summary
	 */
	async getSummary(chatId?: string): Promise<string | null> {
		const summaries = await db
			.select()
			.from(chatMemories)
			.where(
				and(
					eq(chatMemories.userId, this.userId),
					eq(chatMemories.memoryType, 'summary'),
					chatId ? eq(chatMemories.chatId, chatId) : undefined
				)
			)
			.orderBy(desc(chatMemories.createdAt))
			.limit(1);

		if (summaries.length === 0) return null;

		return summaries[0].value.summary;
	}

	// ============ Entity Memory ============

	/**
	 * Save or update an entity
	 */
	async saveEntity(entity: EntityInfo): Promise<void> {
		const { name, type, description, facts = [], relations = [] } = entity;

		// Check if entity already exists
		const existing = await db
			.select()
			.from(entityMemories)
			.where(
				and(eq(entityMemories.userId, this.userId), eq(entityMemories.entityName, name))
			)
			.limit(1);

		if (existing.length > 0) {
			// Update existing entity
			const existingEntity = existing[0];
			const mergedFacts = [...(existingEntity.facts || []), ...facts];
			const mergedRelations = [...(existingEntity.relations || []), ...relations];

			await db
				.update(entityMemories)
				.set({
					description: description || existingEntity.description,
					facts: mergedFacts,
					relations: mergedRelations,
					mentionCount: existingEntity.mentionCount + 1,
					lastMentioned: new Date(),
					updatedAt: new Date()
				})
				.where(eq(entityMemories.id, existingEntity.id));

			console.log(`[Memory] Updated entity: ${name} for user ${this.userId}`);
		} else {
			// Create new entity
			await db.insert(entityMemories).values({
				userId: this.userId,
				entityName: name,
				entityType: type,
				description: description || null,
				facts,
				relations,
				mentionCount: 1,
				lastMentioned: new Date()
			});

			console.log(`[Memory] Created new entity: ${name} for user ${this.userId}`);
		}
	}

	/**
	 * Get an entity by name
	 */
	async getEntity(entityName: string): Promise<EntityInfo | null> {
		const entities = await db
			.select()
			.from(entityMemories)
			.where(
				and(eq(entityMemories.userId, this.userId), eq(entityMemories.entityName, entityName))
			)
			.limit(1);

		if (entities.length === 0) return null;

		const entity = entities[0];
		return {
			name: entity.entityName,
			type: entity.entityType,
			description: entity.description || undefined,
			facts: entity.facts || [],
			relations: entity.relations || []
		};
	}

	/**
	 * Get all entities
	 */
	async getAllEntities(): Promise<EntityInfo[]> {
		const entities = await db
			.select()
			.from(entityMemories)
			.where(eq(entityMemories.userId, this.userId))
			.orderBy(desc(entityMemories.lastMentioned));

		return entities.map((e) => ({
			name: e.entityName,
			type: e.entityType,
			description: e.description || undefined,
			facts: e.facts || [],
			relations: e.relations || []
		}));
	}

	/**
	 * Search entities by type
	 */
	async getEntitiesByType(
		type: 'person' | 'place' | 'organization' | 'concept' | 'other'
	): Promise<EntityInfo[]> {
		const entities = await db
			.select()
			.from(entityMemories)
			.where(and(eq(entityMemories.userId, this.userId), eq(entityMemories.entityType, type)))
			.orderBy(desc(entityMemories.mentionCount));

		return entities.map((e) => ({
			name: e.entityName,
			type: e.entityType,
			description: e.description || undefined,
			facts: e.facts || [],
			relations: e.relations || []
		}));
	}

	// ============ Context Building ============

	/**
	 * Build a context string from memories for the LLM
	 * Deduplicates by key and limits to most recent entries
	 */
	async buildContext(): Promise<string> {
		const contextParts: string[] = [];

		// Get long-term memories and deduplicate by key (keep most recent)
		const longTermMemories = await this.getLongTermMemories();
		if (longTermMemories.length > 0) {
			// Deduplicate: keep only the first (most recent) entry for each key
			const deduped = new Map<string, any>();
			for (const m of longTermMemories) {
				if (!deduped.has(m.key)) {
					deduped.set(m.key, m.value);
				}
			}

			// Key translation map for Chinese display
			const keyTranslations: Record<string, string> = {
				'user_name': '👤 用戶名字',
				'username': '👤 用戶名字',
				'name': '👤 名字',
				'user_interests': '💡 興趣',
				'user_hobbies': '🎯 愛好',
				'user_hobby': '🎯 愛好',
				'hobby': '🎯 愛好',
				'interests': '💡 興趣',
				'favorite_drink': '🥤 喜歡的飲料',
				'favorite_food': '🍔 喜歡的食物',
				'food_preference': '🍽️ 食物偏好',
				'food_preferences': '🍽️ 食物偏好',
				'desired_food': '🍽️ 想吃的食物',
				'occupation': '💼 職業',
				'favorite_cake': '🍰 喜歡的蛋糕',
			};

			// Prioritize user-related memories
			const priorityKeys = ['user_name', 'username', 'name', 'user_interests', 'interests', 'user_hobbies', 'user_hobby', 'hobby', 'favorite_drink', 'food_preference', 'food_preferences', 'favorite_food', 'desired_food', 'occupation', 'favorite_cake'];
			const priorityMemories: string[] = [];
			const otherMemories: string[] = [];

			deduped.forEach((value, key) => {
				const formattedValue = typeof value === 'string' ? value : JSON.stringify(value);
				// Translate key to Chinese if available
				const displayKey = keyTranslations[key.toLowerCase()] || key;
				const memoryLine = `- ${displayKey}: ${formattedValue}`;
				if (priorityKeys.some(pk => key.toLowerCase().includes(pk.toLowerCase().replace('_', '')))) {
					priorityMemories.push(memoryLine);
				} else {
					otherMemories.push(memoryLine);
				}
			});

			// Combine: priority first, then others (limit total to 30)
			const allMemories = [...priorityMemories, ...otherMemories].slice(0, 30);

			if (allMemories.length > 0) {
				// Put priority memories in a highlighted section
				if (priorityMemories.length > 0) {
					contextParts.push('🔴【重要：用戶基本資料 - 你必須記住這些】🔴');
					contextParts.push(...priorityMemories);
					contextParts.push('');
				}
				if (otherMemories.length > 0) {
					contextParts.push('=== 其他記憶 ===');
					contextParts.push(...otherMemories.slice(0, 20));
					contextParts.push('');
				}
			}

			console.log(`[Memory] buildContext: ${longTermMemories.length} raw → ${deduped.size} deduped → ${allMemories.length} used`);
		}

		// Get conversation summary
		const summary = await this.getSummary();
		if (summary) {
			contextParts.push('=== Previous Conversation Summary ===');
			contextParts.push(summary);
			contextParts.push('');
		}

		// Get important entities
		const entities = await this.getAllEntities();
		if (entities.length > 0) {
			contextParts.push('=== Known Entities ===');
			entities.slice(0, 10).forEach((entity) => {
				// Limit to top 10
				let entityInfo = `- ${entity.name} (${entity.type})`;
				if (entity.description) {
					entityInfo += `: ${entity.description}`;
				}
				if (entity.facts && entity.facts.length > 0) {
					entityInfo += `\n  Facts: ${entity.facts.map((f) => f.fact).join('; ')}`;
				}
				contextParts.push(entityInfo);
			});
		}

		const result = contextParts.join('\n');
		console.log(`[Memory] Built context with ${result.length} characters`);
		return result;
	}

	/**
	 * Get context as system message for LLM
	 */
	async getContextMessage(): Promise<string> {
		const context = await this.buildContext();
		if (!context) return '';

		return `You have access to the following context about the user and previous conversations:\n\n${context}\n\nUse this information to provide more personalized and contextual responses.`;
	}
}

// Factory function to create memory service
export function createMemoryService(userId: string, chatId?: string): ConversationMemoryService {
	return new ConversationMemoryService(userId, chatId);
}

// LLM-based memory extraction and promotion
// Uses a lightweight model to analyze conversation and extract important information

interface LongTermMemoryCandidate {
	key: string;
	value: any;
	importance: number;
	reason: string;
}

/**
 * Use LLM to analyze conversation and extract important information that should be promoted to long-term memory
 */
export async function extractLongTermMemories(
	userMessage: string,
	assistantMessage: string
): Promise<LongTermMemoryCandidate[]> {
	try {
		// Import AI provider dynamically to avoid circular dependencies
		const { getModelProvider } = await import('$lib/ai/index.js');

		// Use a fast, lightweight model for memory extraction
		const provider = getModelProvider('google/gemma-3-27b-it:free');
		if (!provider) {
			console.warn('[Memory] No provider available for memory extraction');
			return [];
		}

		const prompt = `Analyze this conversation and extract any important personal information that should be remembered long-term.

User: ${userMessage}
Assistant: ${assistantMessage}

Extract information like:
- Personal details (name, age, location, occupation, etc.)
- Preferences and interests
- Important facts about the user
- Goals or plans mentioned
- Relationships with people or organizations

🚨 IMPORTANT: Detect UPDATE intent! 🚨
If the user says things like:
- "我改名了" / "我不叫X了" / "我現在叫Y" / "叫我Y" → Extract the NEW name as user_name
- "我改變喜好了" / "我不再喜歡X" / "我現在喜歡Y" → Extract the NEW preference
- "我換工作了" / "我現在在Y公司" → Extract the NEW occupation

Return a JSON array of objects with this structure:
[
  {
    "key": "user_name",
    "value": "夏天",
    "importance": 10,
    "reason": "用戶表示改名，需要更新姓名"
  }
]

Key naming rules:
- Name: use "user_name" (not "name" or "username")
- Interests: use "user_interests"
- Hobbies: use "user_hobby"
- Food preferences: use "favorite_food"
- Drink preferences: use "favorite_drink"

Rules:
- Only extract factual, important information worth remembering
- importance: 1-10 (10 = most important, use 10 for name/identity updates)
- If nothing important to remember, return []
- DO NOT extract trivial conversational details
- Focus on persistent facts about the user
- When user indicates an UPDATE, use high importance (9-10)

Return ONLY the JSON array, no explanation.`;

		const response = await provider.chat({
			model: 'google/gemma-3-27b-it:free',
			messages: [{ role: 'user', content: prompt }],
			maxTokens: 1000,
			temperature: 0.3, // Low temperature for consistency
		});

		if (!response || typeof response !== 'object' || !('content' in response)) {
			console.warn('[Memory] Invalid LLM response for memory extraction');
			return [];
		}

		// Parse LLM response
		const content = response.content as string;
		const jsonMatch = content.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			console.warn('[Memory] No JSON array found in LLM response');
			return [];
		}

		const memories = JSON.parse(jsonMatch[0]) as LongTermMemoryCandidate[];
		console.log(`[Memory] Extracted ${memories.length} long-term memory candidates`);
		return memories;
	} catch (error) {
		console.error('[Memory] Error extracting long-term memories:', error);
		return [];
	}
}

/**
 * Generate a summary of recent conversation for long-term storage
 */
export async function generateConversationSummary(
	messages: Array<{ role: string; content: string }>
): Promise<string | null> {
	try {
		const { getModelProvider } = await import('$lib/ai/index.js');
		const provider = getModelProvider('google/gemma-3-27b-it:free');
		if (!provider) {
			console.warn('[Memory] No provider available for summary generation');
			return null;
		}

		// Format conversation history
		const conversation = messages
			.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
			.join('\n\n');

		const prompt = `Summarize this conversation in 2-3 sentences, focusing on the key topics discussed and any important information shared.

Conversation:
${conversation}

Summary (2-3 sentences, in the same language as the conversation):`;

		const response = await provider.chat({
			model: 'google/gemma-3-27b-it:free',
			messages: [{ role: 'user', content: prompt }],
			maxTokens: 500,
			temperature: 0.5,
		});

		if (!response || typeof response !== 'object' || !('content' in response)) {
			return null;
		}

		const summary = (response.content as string).trim();
		console.log('[Memory] Generated conversation summary');
		return summary;
	} catch (error) {
		console.error('[Memory] Error generating summary:', error);
		return null;
	}
}

// Placeholder for entity extraction - disabled for now
export function extractEntities(text: string): Array<{ name: string; type: string }> {
	return [];
}

// ============ Instant Memory Update Detection API ============
// Pattern-based detection for immediate memory updates (no LLM needed)

interface MemoryUpdatePattern {
	key: string;
	patterns: RegExp[];
	extractValue: (match: RegExpMatchArray, input: string) => string | null;
}

// Define detection patterns for each memory type
const MEMORY_UPDATE_PATTERNS: MemoryUpdatePattern[] = [
	// Name change patterns
	{
		key: 'user_name',
		patterns: [
			/我(?:改名(?:了)?|現在(?:開始)?(?:不)?叫|不叫.+(?:了)?[，,]?\s*(?:叫|改叫|現在叫))(.+?)(?:了|$|[，,。！])/,
			/(?:叫我|我叫|我是|我的名字是|稱呼我)(.+?)(?:了|$|[，,。！])/,
			/我(?:改名|換名字)(?:了)?[，,]?\s*(?:現在)?(?:叫|是)(.+?)(?:了|$|[，,。！])/,
			/不要?叫我.+[，,]\s*(?:叫|改叫|稱呼)我(.+?)(?:了|$|[，,。！])/,
			/我現在(?:的名字)?(?:叫|是)(.+?)(?:了|$|[，,。！])/,
		],
		extractValue: (match, input) => {
			if (match && match[1]) {
				const name = match[1].trim().replace(/[」」』'"\s]+/g, '');
				// Filter out common non-name words
				if (name.length > 0 && name.length < 20 && !['什麼', '誰', '啥', '甚麼'].includes(name)) {
					return name;
				}
			}
			return null;
		}
	},
	// Interest change patterns
	{
		key: 'user_interests',
		patterns: [
			/我(?:現在)?(?:喜歡|愛好?|興趣(?:是)?)\s*(.+?)(?:了|$|[，,。！])/,
			/我的興趣(?:改成|變成|是)\s*(.+?)(?:了|$|[，,。！])/,
		],
		extractValue: (match, input) => {
			if (match && match[1]) {
				const interest = match[1].trim();
				if (interest.length > 0 && interest.length < 50) {
					return interest;
				}
			}
			return null;
		}
	},
	// Food preference change patterns
	{
		key: 'favorite_food',
		patterns: [
			/我(?:現在)?(?:最)?喜歡吃\s*(.+?)(?:了|$|[，,。！])/,
			/我(?:愛|最愛)吃(?:的是)?\s*(.+?)(?:了|$|[，,。！])/,
			/我(?:最喜歡|最愛)的食物(?:是|變成)?\s*(.+?)(?:了|$|[，,。！])/,
		],
		extractValue: (match, input) => {
			if (match && match[1]) {
				const food = match[1].trim();
				if (food.length > 0 && food.length < 30) {
					return food;
				}
			}
			return null;
		}
	},
	// Drink preference change patterns
	{
		key: 'favorite_drink',
		patterns: [
			/我(?:現在)?(?:最)?喜歡喝\s*(.+?)(?:了|$|[，,。！])/,
			/我(?:愛|最愛)喝(?:的是)?\s*(.+?)(?:了|$|[，,。！])/,
		],
		extractValue: (match, input) => {
			if (match && match[1]) {
				const drink = match[1].trim();
				if (drink.length > 0 && drink.length < 30) {
					return drink;
				}
			}
			return null;
		}
	},
	// Occupation change patterns
	{
		key: 'occupation',
		patterns: [
			/我(?:現在)?(?:在|是)\s*(.+?)\s*(?:工作|上班)(?:了|$|[，,。！])/,
			/我(?:換|改)(?:工作|職業)(?:了)?[，,]?\s*(?:現在)?(?:在|是)\s*(.+?)(?:了|$|[，,。！])/,
			/我的(?:工作|職業)(?:是|變成)?\s*(.+?)(?:了|$|[，,。！])/,
		],
		extractValue: (match, input) => {
			if (match && match[1]) {
				const job = match[1].trim();
				if (job.length > 0 && job.length < 50) {
					return job;
				}
			}
			return null;
		}
	}
];

export interface MemoryUpdate {
	key: string;
	value: string;
	detectedPattern: string;
}

/**
 * Instantly detect memory updates from user input using pattern matching
 * This runs BEFORE the LLM processes the message to ensure immediate updates
 *
 * @param userMessage - The user's input message
 * @returns Array of detected memory updates to apply
 */
export function detectInstantMemoryUpdates(userMessage: string): MemoryUpdate[] {
	const updates: MemoryUpdate[] = [];

	for (const pattern of MEMORY_UPDATE_PATTERNS) {
		for (const regex of pattern.patterns) {
			const match = userMessage.match(regex);
			if (match) {
				const value = pattern.extractValue(match, userMessage);
				if (value) {
					updates.push({
						key: pattern.key,
						value,
						detectedPattern: regex.source
					});
					console.log(`[Memory Instant] Detected ${pattern.key} update: "${value}" (pattern: ${regex.source.substring(0, 30)}...)`);
					break; // Only use first matching pattern for each key
				}
			}
		}
	}

	return updates;
}

/**
 * Apply instant memory updates to the database
 * Uses upsert logic to update existing records or create new ones
 */
export async function applyInstantMemoryUpdates(
	userId: string,
	updates: MemoryUpdate[]
): Promise<{ updated: string[]; created: string[] }> {
	const result = { updated: [] as string[], created: [] as string[] };

	if (updates.length === 0) {
		return result;
	}

	const memoryService = new ConversationMemoryService(userId);

	for (const update of updates) {
		try {
			// saveLongTermMemory already has upsert logic for key fields
			await memoryService.saveLongTermMemory(update.key, update.value, 10); // Importance 10 for direct updates

			// Check if it was an update or create by looking at logs
			// For simplicity, we'll just track the key
			result.updated.push(update.key);

			console.log(`[Memory Instant] Applied update: ${update.key} = "${update.value}"`);
		} catch (error) {
			console.error(`[Memory Instant] Failed to apply update for ${update.key}:`, error);
		}
	}

	return result;
}
