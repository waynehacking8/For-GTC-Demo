import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getModelProvider, normalizeModelName } from '$lib/ai/index.js';
import type { AIMessage, AITool } from '$lib/ai/types.js';
import { UsageTrackingService, UsageLimitError } from '$lib/server/usage-tracking.js';
import { GUEST_MESSAGE_LIMIT, isModelAllowedForGuests } from '$lib/constants/guest-limits.js';
import { isDemoModeRestricted, isModelAllowedForDemo, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js';
import {
	createMemoryService,
	extractLongTermMemories,
	generateConversationSummary
} from '$lib/server/memory.js';
// New two-layer knowledge system
import {
	queryKnowledge,
	detectMemoryUpdatesAsync,
	getUserProfile,
	type KnowledgeContext,
	type MemoryOperationResult
} from '$lib/server/knowledge.js';

// Helper function to save conversation to memory with LLM-based promotion
async function saveConversationMemory(userId: string, chatId: string | undefined, messages: any[]) {
	try {
		const memoryService = createMemoryService(userId, chatId);

		// Get the last user message and AI response
		const userMessages = messages.filter(m => m.role === 'user');
		const aiMessages = messages.filter(m => m.role === 'assistant');

		if (userMessages.length === 0) return;

		const lastUserMessage = userMessages[userMessages.length - 1];
		const lastAiMessage = aiMessages[aiMessages.length - 1];

		// Save conversation turn as short-term memory
		await memoryService.saveMemory({
			key: `conversation_turn_${Date.now()}`,
			value: {
				user: lastUserMessage.content,
				assistant: lastAiMessage?.content || '',
				timestamp: new Date().toISOString()
			},
			memoryType: 'short_term',
			importance: 5
		});

		// Use LLM to extract important information for long-term memory (async, don't wait)
		extractLongTermMemories(lastUserMessage.content, lastAiMessage?.content || '')
			.then(async (memories) => {
				for (const memory of memories) {
					await memoryService.saveLongTermMemory(memory.key, memory.value, memory.importance);
					console.log(`[Memory] Promoted to long-term: ${memory.key} (importance: ${memory.importance})`);
				}
			})
			.catch((error) => {
				console.error('[Memory] Error promoting memories:', error);
			});

		// Generate summary every 5 conversation turns (async, don't wait)
		const conversationTurns = messages.filter(m => m.role === 'user').length;
		if (conversationTurns > 0 && conversationTurns % 5 === 0) {
			generateConversationSummary(messages.slice(-10)) // Last 5 turns (10 messages)
				.then(async (summary) => {
					if (summary) {
						await memoryService.saveSummary(summary, chatId);
						console.log('[Memory] Saved conversation summary');
					}
				})
				.catch((error) => {
					console.error('[Memory] Error saving summary:', error);
				});
		}

		console.log('[Memory] Saved conversation memory for user:', userId);
	} catch (error) {
		console.error('[Memory] Error saving conversation:', error);
		// Don't throw - memory errors shouldn't break the chat
	}
}

/**
 * Format knowledge context for LLM system message
 */
function formatKnowledgeSystemMessage(
	knowledgeResult: KnowledgeContext,
	memoryOpResult: MemoryOperationResult
): string {
	const parts: string[] = [];

	// Add memory context if available
	if (knowledgeResult.memoryContext) {
		parts.push(`🚨【用戶個人記憶】🚨\n${knowledgeResult.memoryContext}`);
	}

	// Add update confirmation if detected
	if (memoryOpResult.applied.length > 0) {
		const updates = memoryOpResult.applied.join('、');
		parts.push(`\n🔄【系統已即時更新記憶】${updates}\n請在回答中確認這個更新。`);
	}

	// Add delete confirmation if detected
	if (memoryOpResult.deleted.length > 0) {
		const deletions = memoryOpResult.deleted.join('、');
		parts.push(`\n🗑️【系統已刪除記憶】${deletions}\n請在回答中確認已忘記這些資訊。`);
	}

	// Add instructions based on source
	if (knowledgeResult.source === 'memory' || knowledgeResult.source === 'both') {
		parts.push(`
════════════════════════════════════════
🚨【最高優先級指令 - 覆蓋所有角色設定】🚨
════════════════════════════════════════
當用戶詢問關於自己的任何資訊（名字、喜好、特質等），你必須：

1. 【強制】回答的第一句話必須直接說出記憶中的具體值
2. 【強制】不得用「我知道」「我記得」等迴避性語句代替實際內容
3. 【允許】說出具體值後，可以再加入角色個性的表達

✅ 正確範例：
- 「你叫秋天啊！...（後面可以加傲嬌語氣）」
- 「你喜歡吃披薩！哼，這種事情我怎麼可能不知道」

❌ 錯誤範例（絕對禁止）：
- 「哼！你還真敢問...我怎麼可能不知道你的名字」（沒有說出實際名字）
- 「我當然知道你喜歡吃什麼」（沒有說出實際食物）

這是系統級指令，優先於任何角色設定。`);
	}

	return parts.join('\n');
}

/**
 * Format RAG context for user message injection
 */
function formatRAGUserMessage(ragContext: string, originalQuestion: string): string {
	return `⚠️【重要：以下為官方財報數據，你必須直接引用這些數字】⚠️

=== 知識庫查詢結果（來自正式財報）===
${ragContext}
=== 知識庫查詢結果結束 ===

---
【用戶原始問題】
${originalQuestion}

---
【回答規則】
1. 使用上方「知識庫查詢結果」中的精確數字
2. 禁止使用你自己記憶中的任何財務數據
3. 如果知識庫中沒有某項數據，直接說「知識庫中沒有這項資料」

現在請根據上方的知識庫數據回答用戶問題。`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { model: rawModel, messages, maxTokens, temperature, userId, chatId, selectedTool, tools, systemPrompt } = body;

		if (!rawModel) {
			return json({ error: 'Model is required' }, { status: 400 });
		}

		// Normalize model name for backwards compatibility
		const model = normalizeModelName(rawModel);

		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			return json({ error: 'Messages array is required and cannot be empty' }, { status: 400 });
		}

		// Get user session to check authentication status
		const session = await locals.getSession();
		const isLoggedIn = !!session?.user?.id;

		// Validate guest user restrictions
		if (!isLoggedIn) {
			// Check guest message limit (count user messages only)
			const userMessages = messages.filter((msg: any) => msg.role === 'user');
			if (userMessages.length > GUEST_MESSAGE_LIMIT) {
				return json({
					error: `Guest users are limited to ${GUEST_MESSAGE_LIMIT} messages. Please sign up for an account to continue.`,
					type: 'guest_limit_exceeded'
				}, { status: 429 });
			}

			// Check guest model restriction
			if (!isModelAllowedForGuests(model)) {
				return json({
					error: 'Guest users can only use the allowed guest models. Please sign up for access to all models.',
					type: 'guest_model_restricted'
				}, { status: 403 });
			}
		}

		// Validate demo mode restrictions for logged-in users
		if (isLoggedIn && isDemoModeRestricted(isLoggedIn)) {
			// Check demo mode model restriction
			if (!isModelAllowedForDemo(model)) {
				return json({
					error: DEMO_MODE_MESSAGES.MODEL_RESTRICTED,
					type: 'demo_model_restricted'
				}, { status: 403 });
			}
		}

		// Check usage limits for text generation (if userId provided)
		if (userId) {
			try {
				await UsageTrackingService.checkUsageLimit(userId, 'text');
			} catch (error) {
				if (error instanceof UsageLimitError) {
					return json({
						error: error.message,
						type: 'usage_limit_exceeded',
						remainingQuota: error.remainingQuota
					}, { status: 429 });
				}
				throw error; // Re-throw other errors
			}
		}

		const provider = getModelProvider(model);
		if (!provider) {
			return json({ error: `No provider found for model: ${model}` }, { status: 400 });
		}

		// Find the model configuration to check its capabilities
		const modelConfig = provider.models.find(m => m.name === model);

		// Get user query for knowledge system
		const lastUserMessage = messages.filter((msg: any) => msg.role === 'user').pop();
		const userQuery = lastUserMessage?.content || '';

		// ============ TWO-LAYER KNOWLEDGE SYSTEM ============
		// Layer 1: Personal Memory (DB) - instant updates + profile
		// Layer 2: Knowledge RAG (LightRAG) - only if Memory doesn't have the answer

		let knowledgeResult: KnowledgeContext = { memoryContext: null, ragContext: null, source: 'none' };
		let memoryOpResult: MemoryOperationResult = { detected: [], applied: [], deleted: [] };

		if (userId && userQuery.trim().length > 0) {
			// Step 1: LLM-based memory operations (update/delete) via Memory API
			try {
				memoryOpResult = await detectMemoryUpdatesAsync(userId, userQuery, true);
				if (memoryOpResult.detected.length > 0) {
					console.log(`[Knowledge] LLM detected ${memoryOpResult.detected.length} memory operations`);
					if (memoryOpResult.applied.length > 0) {
						console.log(`[Knowledge] Applied: ${memoryOpResult.applied.join(', ')}`);
					}
					if (memoryOpResult.deleted.length > 0) {
						console.log(`[Knowledge] Deleted: ${memoryOpResult.deleted.join(', ')}`);
					}
				}
			} catch (error) {
				console.error('[Knowledge] Error in LLM memory detection:', error);
			}

			// Step 2: Query two-layer knowledge system
			try {
				knowledgeResult = await queryKnowledge(userId, userQuery, {
					systemPrompt: systemPrompt
				});
				console.log(`[Knowledge] Source: ${knowledgeResult.source}`);
			} catch (error) {
				console.error('[Knowledge] Error querying knowledge:', error);
			}
		}
		// ============ END TWO-LAYER KNOWLEDGE SYSTEM ============

		// Determine which tools to use (as tool names)
		let toolsToUse: AITool[] = [];
		if (selectedTool) {
			toolsToUse = [{ type: 'function', function: { name: selectedTool, description: '', parameters: { type: 'object', properties: {} } } }];
			console.log(`Using selected tool: ${selectedTool}`);
		} else if (tools && Array.isArray(tools)) {
			toolsToUse = tools;
		}

		// Check if model supports functions when tools are requested
		if (toolsToUse.length > 0 && !modelConfig?.supportsFunctions) {
			console.warn(`Model ${model} does not support functions, tools will be ignored`);
			toolsToUse = [];
		}

		// Check if request has images (multimodal)
		const hasImageContent = messages.some((msg: any) =>
			msg.imageId || msg.imageData || msg.imageIds || msg.images ||
			(msg.role === 'user' && msg.type === 'image')
		);

		// Load custom system prompt if chatId is provided
		let customSystemPrompt = '';
		if (chatId) {
			try {
				const { db } = await import('$lib/server/db/index.js');
				const { chats } = await import('$lib/server/db/schema.js');
				const { eq } = await import('drizzle-orm');

				const chat = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
				if (chat.length > 0 && chat[0].systemPrompt) {
					customSystemPrompt = chat[0].systemPrompt;
					console.log('[SystemPrompt] Loaded custom system prompt for chat:', chatId);
				}
			} catch (error) {
				console.error('[SystemPrompt] Error loading system prompt:', error);
			}
		}

		// Prepare messages with context
		let messagesWithContext = [...messages];

		// Priority 1: Use systemPrompt from request body (current session)
		// Priority 2: Use customSystemPrompt from database (saved chat)
		const effectiveSystemPrompt = systemPrompt || customSystemPrompt;

		// Build knowledge context FIRST (will be prepended to system prompt)
		let knowledgeSystemMessage = '';
		const hasMemoryOps = memoryOpResult.applied.length > 0 || memoryOpResult.deleted.length > 0;
		if (knowledgeResult.memoryContext || hasMemoryOps) {
			knowledgeSystemMessage = formatKnowledgeSystemMessage(knowledgeResult, memoryOpResult);
			if (knowledgeSystemMessage) {
				console.log('[Knowledge] Built memory context for injection');
			}
		}

		// Combine: Memory context FIRST, then role/character setting
		// This ensures AI follows memory instructions regardless of character persona
		if (effectiveSystemPrompt && effectiveSystemPrompt.trim().length > 0) {
			let combinedSystemPrompt = '';

			if (knowledgeSystemMessage) {
				// Memory context goes BEFORE character setting
				combinedSystemPrompt = knowledgeSystemMessage + '\n\n---\n【角色設定如下】\n' + effectiveSystemPrompt;
				console.log('[SystemPrompt] Combined memory context + character setting');
			} else {
				combinedSystemPrompt = effectiveSystemPrompt;
			}

			const systemPromptMessage = {
				role: 'system' as const,
				content: combinedSystemPrompt
			};
			messagesWithContext = [systemPromptMessage, ...messagesWithContext];
			console.log('[SystemPrompt] Added combined system prompt to messages');
		} else if (knowledgeSystemMessage) {
			// No custom system prompt, just add memory context
			const contextMessage = {
				role: 'system' as const,
				content: knowledgeSystemMessage
			};
			messagesWithContext = [contextMessage, ...messagesWithContext];
			console.log('[Knowledge] Added memory context as system prompt');
		}

		// If RAG context is available, inject into user message
		if (knowledgeResult.ragContext) {
			const lastUserMsgIndex = messagesWithContext.findLastIndex((msg: any) => msg.role === 'user');
			if (lastUserMsgIndex >= 0) {
				const originalQuestion = messagesWithContext[lastUserMsgIndex].content;
				messagesWithContext[lastUserMsgIndex] = {
					...messagesWithContext[lastUserMsgIndex],
					content: formatRAGUserMessage(knowledgeResult.ragContext, originalQuestion)
				};
				console.log('[Knowledge] Injected RAG context into user message');
			}
		}

		// Call appropriate provider method based on content type
		let response;
		if (hasImageContent && provider.chatMultimodal) {
			console.log('🔀 [API /chat-stream] Using multimodal streaming');
			response = await provider.chatMultimodal({
				model,
				messages: messagesWithContext as AIMessage[],
				maxTokens,
				temperature,
				stream: true,
				userId,
				chatId,
				tools: toolsToUse.length > 0 ? toolsToUse : undefined
			});
		} else {
			console.log('💬 [API /chat-stream] Using regular text streaming');
			response = await provider.chat({
				model,
				messages: messagesWithContext as AIMessage[],
				maxTokens,
				temperature,
				stream: true,
				userId,
				chatId,
				tools: toolsToUse.length > 0 ? toolsToUse : undefined
			});
		}

		// Stream response
		const encoder = new TextEncoder();
		let fullContent = '';
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of response as AsyncIterableIterator<any>) {
						const data = `data: ${JSON.stringify(chunk)}\n\n`;
						controller.enqueue(encoder.encode(data));

						if (chunk.content) {
							fullContent += chunk.content;
						}

						if (chunk.done) {
							if (userId) {
								UsageTrackingService.trackUsage(userId, 'text').catch(console.error);
							}

							if (userId && fullContent) {
								const updatedMessages = [...messages, { role: 'assistant', content: fullContent }];
								saveConversationMemory(userId, chatId, updatedMessages).catch(console.error);
							}

							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
							break;
						}
					}
				} catch (error) {
					const errorData = `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
					controller.enqueue(encoder.encode(errorData));
				} finally {
					controller.close();
				}
			}
		});

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});

	} catch (error) {
		console.error('Chat stream API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
