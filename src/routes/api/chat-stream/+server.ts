import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getModelProvider } from '$lib/ai/index.js';
import type { AIMessage, AITool } from '$lib/ai/types.js';
import { getAllTools, getTools } from '$lib/ai/tools/index.js';
import { UsageTrackingService, UsageLimitError } from '$lib/server/usage-tracking.js';
import { GUEST_MESSAGE_LIMIT, isModelAllowedForGuests } from '$lib/constants/guest-limits.js';
import { isDemoModeRestricted, isModelAllowedForDemo, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js';
import { streamText, type ModelMessage } from 'ai';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { model, messages, maxTokens, temperature, userId, chatId, selectedTool, tools } = body;

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

		// Check if request has images (multimodal)
		const hasImageContent = messages.some((msg: any) =>
			msg.imageId || msg.imageData || msg.imageIds || msg.images ||
			(msg.role === 'user' && msg.type === 'image')
		);

		// Call appropriate provider method based on content type
		let response;
		if (hasImageContent && provider.chatMultimodal) {
			console.log('🔀 [API /chat-stream] Using multimodal streaming');
			// Use multimodal chat with streaming enabled
			response = await provider.chatMultimodal({
				model,
				messages: messages as AIMessage[],
				maxTokens,
				temperature,
				stream: true, // Enable streaming for multimodal!
				userId,
				chatId,
				tools: toolsToUse.length > 0 ? toolsToUse : undefined
			});
		} else {
			console.log('💬 [API /chat-stream] Using regular text streaming');
			// Call the provider's chat method with streaming enabled
			response = await provider.chat({
				model,
				messages: messages as AIMessage[],
				maxTokens,
				temperature,
				stream: true, // Enable streaming
				userId,
				chatId,
				tools: toolsToUse.length > 0 ? toolsToUse : undefined
			});
		}

		// The response is already an AsyncIterableIterator<AIStreamChunk>
		// Convert it to the AI SDK's streaming format
		const encoder = new TextEncoder();
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of response as AsyncIterableIterator<any>) {
						// Send each chunk as a data event
						const data = `data: ${JSON.stringify(chunk)}\n\n`;
						controller.enqueue(encoder.encode(data));

						if (chunk.done) {
							// Track usage for successful streaming completion
							if (userId) {
								UsageTrackingService.trackUsage(userId, 'text').catch(console.error);
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
