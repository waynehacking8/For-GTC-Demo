import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, smoothStream, type ModelMessage } from 'ai';
import type { AIProvider, AIModelConfig, AIMessage, AIResponse, AIStreamChunk, ChatCompletionParams, ArchitectureObject, AITool, AIToolResult } from '../types.js';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index.js';
import { images } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { getOpenRouterApiKey } from '$lib/server/settings-store.js';
import { storageService } from '$lib/server/storage.js';
import type { ToolInstance } from '../tools/index.js';

// Get API key from database or fallback to environment variable
async function getApiKey(): Promise<string> {
	try {
		const dbKey = await getOpenRouterApiKey();
		return dbKey || env.OPENROUTER_API_KEY || '';
	} catch (error) {
		console.warn('Failed to get OpenRouter API key from database, using environment variable:', error);
		return env.OPENROUTER_API_KEY || '';
	}
}

// Initialize OpenRouter client - will be recreated if needed when API key changes
let cachedOpenRouterClient: ReturnType<typeof createOpenRouter> | null = null;
let currentApiKey: string | null = null;

async function getOpenRouterProvider(): Promise<ReturnType<typeof createOpenRouter>> {
	const apiKey = await getApiKey();

	if (!cachedOpenRouterClient || currentApiKey !== apiKey) {
		currentApiKey = apiKey;
		cachedOpenRouterClient = createOpenRouter({
			apiKey,
			headers: {
				'HTTP-Referer': 'https://localhost:5173',
				'X-Title': 'CC AI Models'
			}
		});
	}

	return cachedOpenRouterClient;
}

const OPENROUTER_MODELS: AIModelConfig[] = [
	{
		name: 'anthropic/claude-opus-4.1',
		displayName: 'Claude Opus 4.1',
		provider: 'Anthropic',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'anthropic/claude-sonnet-4.5',
		displayName: 'Claude Sonnet 4.5',
		provider: 'Anthropic',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'anthropic/claude-haiku-4.5',
		displayName: 'Claude Haiku 4.5',
		provider: 'Anthropic',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'anthropic/claude-sonnet-4',
		displayName: 'Claude Sonnet 4',
		provider: 'Anthropic',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'anthropic/claude-3.7-sonnet',
		displayName: 'Claude Sonnet 3.7',
		provider: 'Anthropic',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'anthropic/claude-3.5-haiku',
		displayName: 'Claude Haiku 3.5',
		provider: 'Anthropic',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-5',
		displayName: 'GPT 5',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-5-mini',
		displayName: 'GPT-5 Mini',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-5-nano',
		displayName: 'GPT-5 Nano',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-5-chat',
		displayName: 'GPT-5 Chat',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-5-codex',
		displayName: 'GPT-5 Codex',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-4.1-mini',
		displayName: 'GPT-4.1 Mini',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsImageInput: true,
		supportsFunctions: true
	},
	{
		name: 'openai/o3-mini',
		displayName: 'GPT-o3 Mini',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'openai/o1',
		displayName: 'GPT-o1',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-4o-mini',
		displayName: 'GPT-4o Mini',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'openai/gpt-oss-20b:free',
		displayName: 'GPT OSS 20B (free)',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsStreaming: true
	},
	{
		name: 'google/gemini-2.5-pro',
		displayName: 'Gemini 2.5 Pro',
		provider: 'Google',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'google/gemini-2.5-flash',
		displayName: 'Gemini 2.5 Flash',
		provider: 'Google',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'google/gemini-2.5-flash-lite',
		displayName: 'Gemini 2.5 Flash Lite',
		provider: 'Google',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'google/gemma-3-27b-it:free',
		displayName: 'Gemma 3 27B (free)',
		provider: 'Google',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'meta-llama/llama-4-maverick',
		displayName: 'Llama 4 Maverick',
		provider: 'Meta',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'meta-llama/llama-4-scout',
		displayName: 'Llama 4 Scout',
		provider: 'Meta',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'deepseek/deepseek-r1-0528',
		displayName: 'DeepSeek R1',
		provider: 'DeepSeek',
		maxTokens: 4096,
		supportsStreaming: true
	},
	{
		name: 'deepseek/deepseek-r1-0528:free',
		displayName: 'DeepSeek R1 (free)',
		provider: 'DeepSeek',
		maxTokens: 4096,
		supportsStreaming: true
	},
	{
		name: 'deepseek/deepseek-chat-v3.1:free',
		displayName: 'DeepSeek V3.1 (free)',
		provider: 'DeepSeek',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'x-ai/grok-4',
		displayName: 'Grok 4',
		provider: 'xAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'x-ai/grok-3',
		displayName: 'Grok 3',
		provider: 'xAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'x-ai/grok-3-mini',
		displayName: 'Grok 3 Mini',
		provider: 'xAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'x-ai/grok-code-fast-1',
		displayName: 'Grok Code Fast 1',
		provider: 'xAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'x-ai/grok-4-fast',
		displayName: 'Grok 4 Fast',
		provider: 'xAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'qwen/qwen3-coder',
		displayName: 'Qwen3 Coder',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'qwen/qwen3-235b-a22b-thinking-2507',
		displayName: 'Qwen3 Thinking',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsStreaming: true
	},
	{
		name: 'qwen/qwen3-30b-a3b',
		displayName: 'Qwen3 30B A3B',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'moonshotai/kimi-k2-0905',
		displayName: 'Kimi K2 0905',
		provider: 'Moonshot',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'moonshotai/kimi-k2:free',
		displayName: 'Kimi K2 (free)',
		provider: 'Moonshot',
		maxTokens: 4096,
		supportsStreaming: true
	},
	{
		name: 'mistralai/mistral-nemo',
		displayName: 'Mistral Nemo',
		provider: 'Mistral',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'mistralai/mistral-small-3.2-24b-instruct',
		displayName: 'Mistral Small 3.2',
		provider: 'Mistral',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'z-ai/glm-4.5',
		displayName: 'GLM 4.5',
		provider: 'ZAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'z-ai/glm-4.5-air',
		displayName: 'GLM 4.5 Air',
		provider: 'ZAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	},
	{
		name: 'z-ai/glm-4.5-air:free',
		displayName: 'GLM 4.5 Air (free)',
		provider: 'ZAI',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: true
	}
];

// Interface for OpenRouter API model response
interface OpenRouterModel {
	id: string;
	name: string;
	architecture: ArchitectureObject;
	// Other fields we don't need for now
}

interface OpenRouterModelsResponse {
	data: OpenRouterModel[];
}

// Function to enrich hardcoded models with architecture data from OpenRouter API
async function enrichModelsWithArchitecture(models: AIModelConfig[]): Promise<AIModelConfig[]> {
	try {
		console.log('Fetching architecture data from OpenRouter API...');

		const response = await fetch('https://openrouter.ai/api/v1/models', {
			headers: {
				'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
				'HTTP-Referer': 'https://localhost:5173',
				'X-Title': 'CC AI Models'
			}
		});

		if (!response.ok) {
			console.warn(`OpenRouter API returned ${response.status}: ${response.statusText}`);
			return models; // Return original models on API failure
		}

		const apiData: OpenRouterModelsResponse = await response.json();
		console.log(`Fetched ${apiData.data.length} models from OpenRouter API`);

		// Create a map of API models by their ID for efficient lookup
		const apiModelMap = new Map<string, ArchitectureObject>();
		apiData.data.forEach(apiModel => {
			if (apiModel.architecture) {
				apiModelMap.set(apiModel.id, apiModel.architecture);
			}
		});

		// Enrich hardcoded models with architecture data
		const enrichedModels = models.map(model => {
			const architectureData = apiModelMap.get(model.name);
			if (architectureData) {
				console.log(`Enriched ${model.name} with architecture data:`, architectureData);

				// Auto-set capability flags from architecture data
				const enrichedModel: AIModelConfig = {
					...model,
					architecture: architectureData,
					// Input capabilities from input_modalities
					supportsImageInput: model.supportsImageInput ||
					                   architectureData.input_modalities.includes('image') ||
					                   architectureData.input_modalities.includes('file'),
					supportsVideoInput: model.supportsVideoInput ||
					                   architectureData.input_modalities.includes('video'),
					supportsAudioInput: model.supportsAudioInput ||
					                   architectureData.input_modalities.includes('audio'),
					// Output capabilities from output_modalities
					supportsTextGeneration: model.supportsTextGeneration !== false ? true :
					                       architectureData.output_modalities.includes('text'),
					supportsImageGeneration: model.supportsImageGeneration ||
					                        architectureData.output_modalities.includes('image'),
					supportsVideoGeneration: model.supportsVideoGeneration ||
					                        architectureData.output_modalities.includes('video'),
					supportsAudioGeneration: model.supportsAudioGeneration ||
					                        architectureData.output_modalities.includes('audio')
				};

				console.log(`  → Auto-set capabilities for ${model.name}:`, {
					supportsImageInput: enrichedModel.supportsImageInput,
					supportsVideoInput: enrichedModel.supportsVideoInput,
					supportsTextGeneration: enrichedModel.supportsTextGeneration,
					supportsImageGeneration: enrichedModel.supportsImageGeneration
				});

				return enrichedModel;
			}
			return model; // Return original model if no architecture data found
		});

		console.log(`Successfully enriched ${enrichedModels.filter(m => m.architecture).length} models with architecture data`);
		return enrichedModels;

	} catch (error) {
		console.error('Failed to fetch architecture data from OpenRouter API:', error);
		return models; // Return original models on error
	}
}

function convertMessages(messages: AIMessage[]): ModelMessage[] {
	return messages.map(msg => {
		if (msg.role === 'tool') {
			// Tool result message for AI SDK
			const toolResult = msg.content || 'No content provided';
			return {
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result' as const,
						toolCallId: msg.tool_call_id!,
						toolName: msg.name || 'unknown',
						result: toolResult,
						output: {
							type: 'text' as const,
							value: toolResult
						}
					}
				]
			};
		} else if (msg.role === 'assistant' && msg.tool_calls) {
			// Assistant message with tool calls
			return {
				role: 'assistant' as const,
				content: [
					...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
					...msg.tool_calls.map(tc => ({
						type: 'tool-call' as const,
						toolCallId: tc.id,
						toolName: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}')  // AI SDK uses 'input' not 'args'
					}))
				]
			};
		} else if (msg.role === 'assistant') {
			// Regular assistant message
			return {
				role: 'assistant' as const,
				content: msg.content || 'No response provided'
			};
		} else if (msg.role === 'user') {
			// User message
			return {
				role: 'user' as const,
				content: msg.content || 'No message provided'
			};
		} else if (msg.role === 'system') {
			// System message
			return {
				role: 'system' as const,
				content: msg.content || 'No system message provided'
			};
		} else {
			// Fallback for any other cases
			return {
				role: 'user' as const,
				content: 'No message provided'
			};
		}
	});
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
			console.error(`Image not found or access denied for ID: ${imageId}`);
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
				console.error(`Error downloading image from cloud storage: ${imageRecord.cloudPath}`, error);
				return null;
			}
		}

		// Handle local storage files
		if (imageRecord.storageLocation === 'local') {
			// For local files, use the cloudPath if available (contains the full path)
			// or construct the path using the expected storage structure
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
				console.error(`Error downloading image from local storage: ${storagePath}`, error);
				return null;
			}
		}

		console.error(`Unknown storage location: ${imageRecord.storageLocation} for image ID: ${imageId}`);
		return null;
	} catch (error) {
		console.error('Error fetching image data:', error);
		return null;
	}
}

// Convert messages for multimodal chat with image support (AI SDK format)
async function convertMultimodalMessages(messages: AIMessage[], userId?: string): Promise<ModelMessage[]> {
	console.log('🔍 [OpenRouter] convertMultimodalMessages called');
	console.log('  - Total messages:', messages.length);
	console.log('  - userId:', userId);

	const convertedMessages: ModelMessage[] = [];

	for (const msg of messages) {
		if (msg.role === 'user' && (msg.imageId || msg.imageData || msg.imageIds || msg.images)) {
			console.log('📸 [OpenRouter] Processing message with images');
			console.log('  - Has imageId:', !!msg.imageId);
			console.log('  - Has imageData:', !!msg.imageData);
			console.log('  - Has imageIds:', !!msg.imageIds, msg.imageIds?.length || 0);
			console.log('  - Has images array:', !!msg.images, msg.images?.length || 0);

			// Handle messages with images (single or multiple)
			const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];

			// Add text content if present
			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content
				});
				console.log('  - Added text content');
			}

			// Handle multiple images (new format)
			if (msg.images && msg.images.length > 0) {
				console.log('  - Processing msg.images array with', msg.images.length, 'images');
				for (const image of msg.images) {
					if (image.imageData && image.mimeType) {
						// Use base64 data directly (data URL format)
						console.log('    ✓ Using direct base64 data, mimeType:', image.mimeType);
						content.push({
							type: 'image',
							image: `data:${image.mimeType};base64,${image.imageData}`
						});
					} else if (image.imageId && userId) {
						// Fetch image data from database and convert to base64
						console.log('    → Fetching image from DB, imageId:', image.imageId);
						const imageData = await getImageDataById(image.imageId, userId);
						if (imageData) {
							console.log('    ✓ Fetched image successfully, mimeType:', imageData.mimeType);
							content.push({
								type: 'image',
								image: `data:${imageData.mimeType};base64,${imageData.data}`
							});
						} else {
							console.error(`    ✗ Failed to fetch image data for imageId: ${image.imageId}`);
						}
					} else {
						console.warn('    ⚠ Image missing data: imageId=' + image.imageId + ', userId=' + userId);
					}
				}
			} else if (msg.imageIds && msg.imageIds.length > 0 && userId) {
				// Handle multiple image IDs
				console.log('  - Processing msg.imageIds array with', msg.imageIds.length, 'IDs');
				for (const imageId of msg.imageIds) {
					console.log('    → Fetching image from DB, imageId:', imageId);
					const imageData = await getImageDataById(imageId, userId);
					if (imageData) {
						console.log('    ✓ Fetched image successfully, mimeType:', imageData.mimeType);
						content.push({
							type: 'image',
							image: `data:${imageData.mimeType};base64,${imageData.data}`
						});
					} else {
						console.error(`    ✗ Failed to fetch image data for imageId: ${imageId}`);
					}
				}
			} else {
				// Handle single image (backwards compatibility)
				console.log('  - Processing single image (backwards compatibility)');
				if (msg.imageData && msg.mimeType) {
					// Use base64 data directly
					console.log('    ✓ Using direct base64 data, mimeType:', msg.mimeType);
					content.push({
						type: 'image',
						image: `data:${msg.mimeType};base64,${msg.imageData}`
					});
				} else if (msg.imageId && userId) {
					// Fetch image data from database and convert to base64
					console.log('    → Fetching image from DB, imageId:', msg.imageId);
					const imageData = await getImageDataById(msg.imageId, userId);
					if (imageData) {
						console.log('    ✓ Fetched image successfully, mimeType:', imageData.mimeType);
						content.push({
							type: 'image',
							image: `data:${imageData.mimeType};base64,${imageData.data}`
						});
					} else {
						console.error(`    ✗ Failed to fetch image data for imageId: ${msg.imageId}`);
					}
				} else {
					console.warn('    ⚠ Single image missing data: imageId=' + msg.imageId + ', userId=' + userId);
				}
			}

			console.log('  - Final content array has', content.length, 'items');
			console.log('  - Content types:', content.map(c => c.type).join(', '));

			convertedMessages.push({
				role: 'user',
				content: content
			});
		} else {
			// Regular text message - use the standard conversion
			// For non-image messages, we can use the regular converter
			const regularMessage = convertMessages([msg])[0];
			convertedMessages.push(regularMessage);
		}
	}

	console.log('✅ [OpenRouter] Converted', convertedMessages.length, 'messages total');
	return convertedMessages;
}

// Initialize with hardcoded models, will be enriched asynchronously
let enrichedModels: AIModelConfig[] = OPENROUTER_MODELS;

// Promise to track enrichment completion
let enrichmentPromise: Promise<void> | null = null;
let enrichmentCompleted = false;

// Initialize architecture data enrichment
async function initializeModels() {
	try {
		enrichedModels = await enrichModelsWithArchitecture(OPENROUTER_MODELS);
		console.log('OpenRouter models enriched with architecture data');
		enrichmentCompleted = true;
	} catch (error) {
		console.error('Failed to initialize OpenRouter models with architecture data:', error);
		enrichmentCompleted = true; // Mark as completed even on error to prevent hanging
	}
}

// Start enrichment process (non-blocking) and track with Promise
enrichmentPromise = initializeModels();

// Export function to wait for enrichment completion with timeout
export async function waitForEnrichmentCompletion(timeoutMs: number = 10000): Promise<boolean> {
	if (enrichmentCompleted) {
		return true;
	}

	if (!enrichmentPromise) {
		return false;
	}

	try {
		// Race between enrichment completion and timeout
		await Promise.race([
			enrichmentPromise,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Enrichment timeout')), timeoutMs)
			)
		]);
		return true;
	} catch (error) {
		console.warn('Enrichment timeout or error, proceeding with basic models:', error);
		return false;
	}
}

export const openRouterProvider: AIProvider = {
	name: 'OpenRouter',
	get models() {
		return enrichedModels;
	},

	async chat(params: ChatCompletionParams): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
		const { model, messages, maxTokens = 4096, temperature = 0.7, stream = false, tools } = params;

		const provider = await getOpenRouterProvider();
		const convertedMessages = convertMessages(messages);

		// Tools parameter is legacy AITool[] for API compatibility, but we work with tool names internally
		// Extract tool names and get the AI SDK v5 tool instances
		let aiSdkTools: Record<string, ToolInstance> | undefined;
		if (tools && tools.length > 0) {
			const { getToolsAsObject } = await import('../tools/index.js');
			// Extract tool names from the AITool format
			const toolNames = tools
				.map(t => t.function?.name)
				.filter((name): name is string => Boolean(name));
			aiSdkTools = getToolsAsObject(toolNames);
		}

		try {
			const result = streamText({
				model: provider.chat(model),
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
				// Return async iterator for streaming
				return createAISDKStreamIterator(result);
			}

			// Non-streaming: wait for completion - all properties are promises
			const text = await result.text;
			const usage = await result.usage;
			const finishReason = await result.finishReason;
			const toolCalls = await result.toolCalls;
			const response = await result.response;

			return {
				content: text,
				usage: usage ? {
					promptTokens: usage.inputTokens || 0,
					completionTokens: usage.outputTokens || 0,
					totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
				} : undefined,
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
			throw new Error(`OpenRouter API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	},

	// Multimodal chat method for vision models
	async chatMultimodal(params: {
		model: string;
		messages: AIMessage[];
		maxTokens?: number;
		temperature?: number;
		userId?: string;
		chatId?: string;
		tools?: AITool[];
		stream?: boolean;
	}): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
		const { model, messages, maxTokens = 4096, temperature = 0.7, tools, stream = false } = params;

		const provider = await getOpenRouterProvider();

		// Convert messages to multimodal format
		const multimodalMessages = await convertMultimodalMessages(messages, params.userId);

		// Tools parameter is legacy AITool[] for API compatibility, but we work with tool names internally
		// Extract tool names and get the AI SDK v5 tool instances
		let aiSdkTools: Record<string, ToolInstance> | undefined;
		if (tools && tools.length > 0) {
			const { getToolsAsObject } = await import('../tools/index.js');
			// Extract tool names from the AITool format
			const toolNames = tools
				.map(t => t.function?.name)
				.filter((name): name is string => Boolean(name));
			aiSdkTools = getToolsAsObject(toolNames);
		}

		console.log('🚀 [OpenRouter] About to call streamText with:');
		console.log('  - Model:', model);
		console.log('  - Messages count:', multimodalMessages.length);
		console.log('  - Messages structure:', JSON.stringify(multimodalMessages, null, 2));

		try {
			const result = streamText({
				model: provider.chat(model),
				messages: multimodalMessages,
				maxOutputTokens: maxTokens,
				temperature,
				...(aiSdkTools && { tools: aiSdkTools }),
				experimental_transform: smoothStream({
					delayInMs: 20,
					chunking: 'word'
				})
			});

			if (stream) {
				// Return async iterator for streaming (same as chat method)
				console.log('✓ Returning streaming iterator for multimodal chat');
				return createAISDKStreamIterator(result);
			}

			// Non-streaming: wait for completion - all properties are promises
			const text = await result.text;
			const usage = await result.usage;
			const finishReason = await result.finishReason;
			const toolCalls = await result.toolCalls;
			const response = await result.response;

			return {
				content: text,
				usage: usage ? {
					promptTokens: usage.inputTokens || 0,
					completionTokens: usage.outputTokens || 0,
					totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
				} : undefined,
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
			console.error('OpenRouter multimodal API error:', error);
			throw new Error(`OpenRouter multimodal API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	},

};

// Create async iterator for AI SDK streaming responses
async function* createAISDKStreamIterator(result: any): AsyncIterableIterator<AIStreamChunk> {
	try {
		for await (const chunk of result.textStream) {
			yield {
				content: chunk,
				done: false
			};
		}

		// Get final usage information - usage is a promise
		const usage = await result.usage;

		yield {
			content: '',
			done: true,
			usage: usage ? {
				promptTokens: usage.inputTokens || 0,
				completionTokens: usage.outputTokens || 0,
				totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
			} : undefined
		};
	} catch (error) {
		throw new Error(`OpenRouter streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

