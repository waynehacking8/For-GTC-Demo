// Ollama Provider for WeaveAI
// Integrates local Ollama inference server with WeaveAI's AI provider system
// Ollama provides easy-to-use local LLM deployment with OpenAI-compatible API

import { createOpenAI } from '@ai-sdk/openai';
import { streamText, smoothStream, type ModelMessage } from 'ai';
import type {
	AIProvider,
	AIModelConfig,
	AIMessage,
	AIResponse,
	AIStreamChunk,
	ChatCompletionParams,
} from '../types.js';
import { env } from '$env/dynamic/private';
import type { ToolInstance } from '../tools/index.js';
import { db } from '$lib/server/db/index.js';
import { images } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { storageService } from '$lib/server/storage.js';

// Ollama model configurations
// These should match the models you have pulled with `ollama pull <model>`
const OLLAMA_MODELS: AIModelConfig[] = [
	{
		name: 'llava:7b',
		displayName: 'LLaVA 7B (Ollama)',
		provider: 'Ollama',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: false,
		supportsImageInput: true,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'qwen3:8b',
		displayName: 'Qwen 3 8B (Ollama)',
		provider: 'Ollama',
		maxTokens: 32768,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'qwen2.5:32b',
		displayName: 'Qwen 2.5 32B (Ollama)',
		provider: 'Ollama',
		maxTokens: 32768,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: false,
		isDemoAllowed: true
	},
	{
		name: 'deepseek-r1:32b',
		displayName: 'DeepSeek R1 32B (Ollama)',
		provider: 'Ollama',
		maxTokens: 65536,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: false,
		isDemoAllowed: false
	}
];

// Get Ollama API configuration from environment variables
function getOllamaConfig() {
	const baseURL = env.OLLAMA_API_URL || 'http://localhost:11434/v1';
	const apiKey = env.OLLAMA_API_KEY || 'ollama'; // Ollama doesn't require a real API key

	return { baseURL, apiKey };
}

// Initialize Ollama client using OpenAI-compatible interface
let cachedOllamaClient: ReturnType<typeof createOpenAI> | null = null;

function getOllamaClient(): ReturnType<typeof createOpenAI> {
	if (!cachedOllamaClient) {
		const { baseURL, apiKey } = getOllamaConfig();

		console.log('[Ollama] Initializing client with baseURL:', baseURL);

		cachedOllamaClient = createOpenAI({
			baseURL,
			apiKey
		});
	}

	return cachedOllamaClient;
}

// Utility function to fetch image data by ID and convert to base64
async function getImageDataById(imageId: string, userId: string): Promise<{ data: string; mimeType: string } | null> {
	try {
		// Query database to get image metadata and verify ownership
		const [imageRecord] = await db
			.select()
			.from(images)
			.where(eq(images.id, imageId));

		if (!imageRecord || imageRecord.userId !== userId) {
			console.error(`[Ollama] Image not found or access denied for ID: ${imageId}`);
			return null;
		}

		// Handle cloud storage files (R2)
		if (imageRecord.storageLocation === 'r2' && imageRecord.cloudPath) {
			try {
				const imageData = await storageService.download(imageRecord.cloudPath);
				const base64Data = imageData.toString('base64');

				return {
					data: base64Data,
					mimeType: imageRecord.mimeType
				};
			} catch (error) {
				console.error(`[Ollama] Error downloading image from cloud storage: ${imageRecord.cloudPath}`, error);
				return null;
			}
		}

		// Handle local storage files
		if (imageRecord.storageLocation === 'local') {
			const storagePath = imageRecord.cloudPath ||
				storageService.generateFilePath(userId, 'images', imageRecord.filename, 'generated');

			try {
				const imageData = await storageService.download(storagePath);
				const base64Data = imageData.toString('base64');

				return {
					data: base64Data,
					mimeType: imageRecord.mimeType
				};
			} catch (error) {
				console.error(`[Ollama] Error downloading image from local storage: ${storagePath}`, error);
				return null;
			}
		}

		console.error(`[Ollama] Unknown storage location: ${imageRecord.storageLocation} for image ID: ${imageId}`);
		return null;
	} catch (error) {
		console.error('[Ollama] Error fetching image data:', error);
		return null;
	}
}

// Convert AIMessage format to AI SDK ModelMessage format with image support
async function convertMessages(messages: AIMessage[], userId?: string): Promise<ModelMessage[]> {
	const convertedMessages: ModelMessage[] = [];

	for (const msg of messages) {
		if (msg.role === 'tool') {
			// Tool result message for AI SDK
			const toolResult = msg.content || 'No content provided';
			convertedMessages.push({
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result' as const,
						toolCallId: msg.tool_call_id!,
						toolName: msg.name || 'unknown',
						output: {
							type: 'text' as const,
							value: toolResult
						}
					}
				]
			});
		} else if (msg.role === 'assistant' && msg.tool_calls) {
			// Assistant message with tool calls
			convertedMessages.push({
				role: 'assistant' as const,
				content: [
					...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
					...msg.tool_calls.map((tc) => ({
						type: 'tool-call' as const,
						toolCallId: tc.id,
						toolName: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}')
					}))
				]
			});
		} else if (msg.role === 'assistant') {
			convertedMessages.push({
				role: 'assistant' as const,
				content: msg.content || 'No response provided'
			});
		} else if (msg.role === 'user' && (msg.imageId || msg.imageData || msg.imageIds || msg.images)) {
			// Handle user messages with images (multimodal)
			const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];

			// Add text content if present
			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content
				});
			}

			// Handle multiple images (new format)
			if (msg.images && msg.images.length > 0) {
				for (const image of msg.images) {
					if (image.imageData && image.mimeType) {
						content.push({
							type: 'image',
							image: `data:${image.mimeType};base64,${image.imageData}`
						});
					} else if (image.imageId && userId) {
						const imageData = await getImageDataById(image.imageId, userId);
						if (imageData) {
							content.push({
								type: 'image',
								image: `data:${imageData.mimeType};base64,${imageData.data}`
							});
						}
					}
				}
			} else if (msg.imageIds && msg.imageIds.length > 0 && userId) {
				for (const imageId of msg.imageIds) {
					const imageData = await getImageDataById(imageId, userId);
					if (imageData) {
						content.push({
							type: 'image',
							image: `data:${imageData.mimeType};base64,${imageData.data}`
						});
					}
				}
			} else if (msg.imageData && msg.mimeType) {
				content.push({
					type: 'image',
					image: `data:${msg.mimeType};base64,${msg.imageData}`
				});
			} else if (msg.imageId && userId) {
				const imageData = await getImageDataById(msg.imageId, userId);
				if (imageData) {
					content.push({
						type: 'image',
						image: `data:${imageData.mimeType};base64,${imageData.data}`
					});
				}
			}

			convertedMessages.push({
				role: 'user' as const,
				content
			});
		} else if (msg.role === 'user') {
			convertedMessages.push({
				role: 'user' as const,
				content: msg.content || 'No message provided'
			});
		} else if (msg.role === 'system') {
			convertedMessages.push({
				role: 'system' as const,
				content: msg.content || 'No system message provided'
			});
		} else {
			convertedMessages.push({
				role: 'user' as const,
				content: 'No message provided'
			});
		}
	}

	return convertedMessages;
}

// Create async iterator for streaming responses
async function* createOllamaStreamIterator(result: any): AsyncIterableIterator<AIStreamChunk> {
	try {
		for await (const chunk of result.textStream) {
			yield {
				content: chunk,
				done: false
			};
		}

		// Get final usage information
		const usage = await result.usage;

		yield {
			content: '',
			done: true,
			usage: usage
				? {
						promptTokens: usage.inputTokens || 0,
						completionTokens: usage.outputTokens || 0,
						totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
					}
				: undefined
		};
	} catch (error) {
		console.error('[Ollama] Streaming error:', error);
		throw new Error(
			`Ollama streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

// Ollama Provider implementation
export const ollamaProvider: AIProvider = {
	name: 'Ollama',
	models: OLLAMA_MODELS,

	async chat(
		params: ChatCompletionParams
	): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
		const { model, messages, maxTokens = 4096, temperature = 0.7, stream = false, tools, userId } = params;

		const client = getOllamaClient();
		const convertedMessages = await convertMessages(messages, userId);

		// Extract tool names and get AI SDK v5 tool instances if tools are provided
		let aiSdkTools: Record<string, ToolInstance> | undefined;
		if (tools && tools.length > 0) {
			const { getToolsAsObject } = await import('../tools/index.js');
			const toolNames = tools
				.map((t) => t.function?.name)
				.filter((name): name is string => Boolean(name));
			aiSdkTools = getToolsAsObject(toolNames);
			console.log('[Ollama] Using tools:', toolNames);
		}

		const startTime = Date.now();

		try {
			const result = streamText({
				model: client.chat(model), // Use .chat() to explicitly use chat completions endpoint
				messages: convertedMessages,
				maxOutputTokens: maxTokens,
				temperature,
				...(aiSdkTools && { tools: aiSdkTools }),
				experimental_transform: smoothStream({
					delayInMs: 20,
					chunking: 'word'
				})
			});

			if (stream) {
				console.log('[Ollama] Returning streaming response');
				return createOllamaStreamIterator(result);
			}

			// Non-streaming mode: wait for completion
			const text = await result.text;
			const usage = await result.usage;
			const finishReason = await result.finishReason;
			const toolCalls = await result.toolCalls;
			const response = await result.response;

			const duration = Date.now() - startTime;
			console.log('[Ollama] Response completed:', {
				model,
				duration: `${duration}ms`,
				tokensUsed: usage?.totalTokens,
				finishReason
			});

			return {
				content: text,
				usage: usage
					? {
							promptTokens: usage.inputTokens || 0,
							completionTokens: usage.outputTokens || 0,
							totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
						}
					: undefined,
				model: response.modelId || model,
				finishReason: finishReason as AIResponse['finishReason'],
				tool_calls: toolCalls?.map((tc) => ({
					id: tc.toolCallId,
					type: 'function' as const,
					function: {
						name: tc.toolName,
						arguments: JSON.stringify(tc.input)
					}
				}))
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			console.error('[Ollama] API error after', `${duration}ms:`, error);
			throw new Error(
				`Ollama API error: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}
};
