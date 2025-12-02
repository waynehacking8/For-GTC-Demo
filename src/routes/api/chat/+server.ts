import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getModelProvider } from '$lib/ai/index.js';
import type { AIMessage, AITool } from '$lib/ai/types.js';
import { getAllTools, getTools } from '$lib/ai/tools/index.js';
import { UsageTrackingService, UsageLimitError } from '$lib/server/usage-tracking.js';
import { GUEST_MESSAGE_LIMIT, isModelAllowedForGuests } from '$lib/constants/guest-limits.js';
import { isDemoModeRestricted, isModelAllowedForDemo, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js';
import {
	createMemoryService,
	extractEntities,
	extractLongTermMemories,
	generateConversationSummary
} from '$lib/server/memory.js';
import { getRAGContext } from '$lib/server/rag.js';

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

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { model, messages, maxTokens, temperature, stream, userId, chatId, multimodal, selectedTool, tools, systemPrompt } = body;

		if (!model) {
			return json({ error: 'Model is required' }, { status: 400 });
		}

		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			return json({ error: 'Messages array is required and cannot be empty' }, { status: 400 });
		}

		// Get user session to check authentication status
		const session = await locals.getSession();
		const isLoggedIn = !!session?.user?.id;

		// Validate guest user restrictions
		if (!isLoggedIn) {
			// Check guest message limit (count user messages only)
			const userMessages = messages.filter(msg => msg.role === 'user');
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

		// Initialize memory service for logged-in users
		let memoryService = null;
		let memoryContext = '';
		if (userId) {
			memoryService = createMemoryService(userId, chatId);

			// Retrieve memory context to provide to the LLM
			try {
				memoryContext = await memoryService.buildContext();
				console.log('[Memory] Retrieved context for user:', userId);
			} catch (error) {
				console.error('[Memory] Error retrieving context:', error);
				// Continue without memory if there's an error
			}
		}

		// Determine which tools to use (as tool names)
		let toolsToUse: AITool[] = [];
		if (selectedTool) {
			// Single tool selected via UI - create AITool wrapper with tool name for compatibility
			toolsToUse = [{ type: 'function', function: { name: selectedTool, description: '', parameters: { type: 'object', properties: {} } } }];
			console.log(`Using selected tool: ${selectedTool}`);
		} else if (tools && Array.isArray(tools)) {
			// Tools explicitly provided in request
			toolsToUse = tools;
		}

		// Check if model supports functions when tools are requested
		if (toolsToUse.length > 0 && !modelConfig?.supportsFunctions) {
			console.warn(`Model ${model} does not support functions, tools will be ignored`);
			toolsToUse = [];
		}

		// Check if this is a multimodal request or if any messages contain images
		const hasImageContent = multimodal || messages.some((msg: any) =>
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

		// Prepare messages with custom system prompt and memory context
		let messagesWithContext = [...messages];

		// Priority 1: Use systemPrompt from request body (current session)
		// Priority 2: Use customSystemPrompt from database (saved chat)
		const effectiveSystemPrompt = systemPrompt || customSystemPrompt;

		// Add effective system prompt first (highest priority)
		if (effectiveSystemPrompt && effectiveSystemPrompt.trim().length > 0) {
			const systemPromptMessage = {
				role: 'system' as const,
				content: effectiveSystemPrompt
			};
			messagesWithContext = [systemPromptMessage, ...messagesWithContext];
			console.log('[SystemPrompt] Added system prompt to messages:', effectiveSystemPrompt.substring(0, 50) + '...');
		}

		// Add memory context after system prompt
		if (memoryContext && memoryContext.trim().length > 0) {
			// Insert memory context as a system message
			const contextMessage = {
				role: 'system' as const,
				content: `You have access to the following context about the user and previous conversations:\n\n${memoryContext}\n\nUse this information to provide more personalized and contextual responses.`
			};
			messagesWithContext = [messagesWithContext[0], contextMessage, ...messagesWithContext.slice(1)];
			console.log('[Memory] Added context to messages');
		}

		// Add RAG context if available (knowledge base search)
		const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
		if (lastUserMessage && lastUserMessage.content) {
			try {
				const ragContext = await getRAGContext(lastUserMessage.content);
				if (ragContext && ragContext.trim().length > 0) {
					const ragContextMessage = {
						role: 'system' as const,
						content: `${ragContext}\n\nIf the above knowledge base context is relevant to the user's question, use it to provide a more accurate and detailed response. If not relevant, answer based on your general knowledge.`
					};
					// Insert RAG context after system prompt and memory context
					const insertPosition = messagesWithContext.filter(m => m.role === 'system').length;
					messagesWithContext = [
						...messagesWithContext.slice(0, insertPosition),
						ragContextMessage,
						...messagesWithContext.slice(insertPosition)
					];
					console.log('[RAG] Added knowledge base context to messages');
				}
			} catch (error) {
				console.error('[RAG] Error retrieving context, continuing without RAG:', error);
				// Continue without RAG if there's an error
			}
		}

		// Use multimodal chat for image-enabled requests
		if (hasImageContent && provider.chatMultimodal) {
			console.log('🔀 [API /chat] Using multimodal chat path');
			console.log('  - Provider:', provider.name);
			console.log('  - Model:', model);
			console.log('  - userId:', userId);
			console.log('  - chatId:', chatId);
			console.log('  - Messages with images:', messages.filter((m: any) => m.imageId || m.imageData || m.imageIds || m.images).length);

			try {
				const response = await provider.chatMultimodal({
					model,
					messages: messagesWithContext as AIMessage[],
					maxTokens,
					temperature,
					userId,
					chatId,
					tools: toolsToUse.length > 0 ? toolsToUse : undefined
				});

				// Track usage for successful multimodal request
				if (userId) {
					UsageTrackingService.trackUsage(userId, 'text').catch(console.error);
				}

				// Save conversation to memory (async, don't wait)
				if (userId && response.content) {
					const updatedMessages = [...messages, { role: 'assistant', content: response.content }];
					saveConversationMemory(userId, chatId, updatedMessages).catch(console.error);
				}

				return json(response);
			} catch (error) {
				console.error('Multimodal chat error:', error);
				return json(
					{ error: error instanceof Error ? error.message : 'Multimodal chat failed' },
					{ status: 500 }
				);
			}
		}

		// Check if this is a video generation request
		if (modelConfig?.supportsVideoGeneration && provider.generateVideo) {
			// Extract the prompt from the last user message
			const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
			if (!lastUserMessage) {
				return json({ error: 'No user message found for video generation' }, { status: 400 });
			}

			// Extract imageUrl from last user message (for i2v models)
			let imageUrl: string | undefined;
			if (lastUserMessage.imageId) {
				// Single image (backwards compatibility)
				imageUrl = `/api/images/${lastUserMessage.imageId}`;
			} else if (lastUserMessage.imageIds && lastUserMessage.imageIds.length > 0) {
				// Multiple images: use first image
				imageUrl = `/api/images/${lastUserMessage.imageIds[0]}`;
			} else if (lastUserMessage.images && lastUserMessage.images.length > 0) {
				// Images array: use first image with imageId
				const firstImage = lastUserMessage.images[0];
				if (firstImage.imageId) {
					imageUrl = `/api/images/${firstImage.imageId}`;
				}
			}

			try {
				const videoResponse = await provider.generateVideo({
					model,
					prompt: lastUserMessage.content,
					userId,
					chatId,
					imageUrl
				});

				// Track usage for successful video generation
				if (userId) {
					UsageTrackingService.trackUsage(userId, 'video').catch(console.error);
				}

				return json(videoResponse);
			} catch (error) {
				console.error('Video generation error:', error);
				return json(
					{ error: error instanceof Error ? error.message : 'Video generation failed' },
					{ status: 500 }
				);
			}
		}

		const response = await provider.chat({
			model,
			messages: messagesWithContext as AIMessage[],
			maxTokens,
			temperature,
			stream,
			userId,
			chatId,
			tools: toolsToUse.length > 0 ? toolsToUse : undefined
		});

		if (stream) {
			// Handle streaming response
			const encoder = new TextEncoder();
			let fullContent = ''; // Collect full response for memory
			const readable = new ReadableStream({
				async start(controller) {
					try {
						for await (const chunk of response as AsyncIterableIterator<any>) {
							const data = `data: ${JSON.stringify(chunk)}\n\n`;
							controller.enqueue(encoder.encode(data));

							// Collect content for memory
							if (chunk.content) {
								fullContent += chunk.content;
							}

							if (chunk.done) {
								// Track usage for successful streaming completion
								if (userId) {
									UsageTrackingService.trackUsage(userId, 'text').catch(console.error);
								}

								// Save conversation to memory (async, don't wait)
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
		}

		// Track usage for successful text generation (non-streaming)
		if (userId) {
			UsageTrackingService.trackUsage(userId, 'text').catch(console.error);
		}

		// Save conversation to memory (async, don't wait)
		if (userId && response && typeof response === 'object' && 'content' in response) {
			const updatedMessages = [...messages, { role: 'assistant', content: response.content }];
			saveConversationMemory(userId, chatId, updatedMessages).catch(console.error);
		}

		return json(response);

	} catch (error) {
		console.error('Chat API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};