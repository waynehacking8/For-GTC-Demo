// vLLM Provider for WeaveAI
// Integrates local vLLM inference server with WeaveAI's AI provider system
// vLLM provides high-performance inference for large language models with OpenAI-compatible API

import { createOpenAI } from '@ai-sdk/openai';
import { streamText, smoothStream, type ModelMessage } from 'ai';
import type {
	AIProvider,
	AIModelConfig,
	AIMessage,
	AIResponse,
	AIStreamChunk,
	ChatCompletionParams,
	AITool
} from '../types.js';
import { env } from '$env/dynamic/private';
import type { ToolInstance } from '../tools/index.js';

// vLLM model configurations
// Add or remove models based on what you have deployed in your vLLM server
const VLLM_MODELS: AIModelConfig[] = [
	{
		name: './Qwen3-VL-32B-Instruct',
		displayName: 'Qwen 3 VL 32B (Multimodal)',
		provider: 'vLLM',
		maxTokens: 20000,
		supportsStreaming: true,
		supportsFunctions: false,
		supportsTextGeneration: true,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsMultimodal: true,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'Qwen/Qwen2.5-VL-7B-Instruct',
		displayName: 'Qwen 2.5 VL 7B (Multimodal)',
		provider: 'vLLM',
		maxTokens: 32768,
		supportsStreaming: true,
		supportsFunctions: false,
		supportsTextGeneration: true,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsMultimodal: true,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'meta-llama/Llama-2-7b-hf',
		displayName: 'Llama 2 7B (vLLM)',
		provider: 'vLLM',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: false,
		supportsTextGeneration: true,
		supportsTextInput: true,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'llama-2-13b-chat',
		displayName: 'Llama 2 13B Chat (vLLM)',
		provider: 'vLLM',
		maxTokens: 4096,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: false,
		isDemoAllowed: true
	},
	{
		name: 'mistral-7b-instruct',
		displayName: 'Mistral 7B Instruct (vLLM)',
		provider: 'vLLM',
		maxTokens: 8192,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: true,
		isDemoAllowed: true
	},
	{
		name: 'codellama-34b-instruct',
		displayName: 'CodeLlama 34B Instruct (vLLM)',
		provider: 'vLLM',
		maxTokens: 16384,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: false,
		isDemoAllowed: true
	},
	{
		name: 'deepseek-coder-33b-instruct',
		displayName: 'DeepSeek Coder 33B (vLLM)',
		provider: 'vLLM',
		maxTokens: 16384,
		supportsStreaming: true,
		supportsFunctions: false,
		isGuestAllowed: false,
		isDemoAllowed: false
	}
];

// Get vLLM API configuration from environment variables
// Supports separate endpoints for text LLM and multimodal VLM
function getVllmConfig(modelName?: string) {
	// Check if this is a Qwen3-VL-32B model (uses port 8002)
	const isQwen3VL32B = modelName?.includes('Qwen3-VL-32B') || modelName?.includes('/Qwen3-VL-32B');

	// Check if this is other multimodal model (VL model, uses port 8004)
	const isMultimodal = modelName?.includes('-VL-') || modelName?.includes('vision');

	// Route to correct endpoint based on model
	let baseURL: string;
	if (isQwen3VL32B) {
		baseURL = 'http://localhost:8002/v1';  // Qwen3-VL-32B on port 8002
	} else if (isMultimodal) {
		baseURL = env.VLLM_VLM_API_URL || 'http://localhost:8004/v1';  // Other VLM models on port 8004
	} else {
		baseURL = env.VLLM_API_URL || 'http://localhost:8002/v1';  // Text-only models default to port 8002
	}

	const apiKey = env.VLLM_API_KEY || 'dummy-key'; // vLLM doesn't require a real API key

	console.log(`[vLLM] Using endpoint:`, baseURL, 'for model:', modelName);

	return { baseURL, apiKey };
}

// Initialize vLLM client using OpenAI-compatible interface
// We can't cache the client anymore since it depends on the model
function getVllmClient(modelName: string): ReturnType<typeof createOpenAI> {
	const { baseURL, apiKey } = getVllmConfig(modelName);

	console.log('[vLLM] Initializing client with baseURL:', baseURL);

	return createOpenAI({
		baseURL,
		apiKey
	});
}

// Convert AIMessage format to AI SDK ModelMessage format
function convertMessages(messages: AIMessage[]): ModelMessage[] {
	return messages.map((msg) => {
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
					...msg.tool_calls.map((tc) => ({
						type: 'tool-call' as const,
						toolCallId: tc.id,
						toolName: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}')
					}))
				]
			};
		} else if (msg.role === 'assistant') {
			return {
				role: 'assistant' as const,
				content: msg.content || 'No response provided'
			};
		} else if (msg.role === 'user') {
			return {
				role: 'user' as const,
				content: msg.content || 'No message provided'
			};
		} else if (msg.role === 'system') {
			return {
				role: 'system' as const,
				content: msg.content || 'No system message provided'
			};
		} else {
			return {
				role: 'user' as const,
				content: 'No message provided'
			};
		}
	});
}

// Create async iterator for streaming responses
async function* createVllmStreamIterator(result: any): AsyncIterableIterator<AIStreamChunk> {
	try {
		console.log('[vLLM] Starting stream iterator');
		let chunkCount = 0;

		for await (const chunk of result.textStream) {
			chunkCount++;
			console.log('[vLLM] Yielding chunk', chunkCount, ':', chunk.substring(0, 50));
			yield {
				content: chunk,
				done: false
			};
		}

		console.log('[vLLM] Stream completed, total chunks:', chunkCount);

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
		console.error('[vLLM] Streaming error:', error);
		throw new Error(`vLLM streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

// vLLM Provider implementation
export const vllmProvider: AIProvider = {
	name: 'vLLM',
	models: VLLM_MODELS,

	async chat(
		params: ChatCompletionParams
	): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
		const { model, messages, maxTokens = 4096, temperature = 0.7, stream = false, tools } = params;

		console.log('[vLLM] Chat request:', {
			model,
			messageCount: messages.length,
			maxTokens,
			temperature,
			stream,
			hasTools: !!tools?.length
		});

		const client = getVllmClient(model);  // Pass model name to get correct endpoint
		const convertedMessages = convertMessages(messages);

		// Extract tool names and get AI SDK v5 tool instances if tools are provided
		let aiSdkTools: Record<string, ToolInstance> | undefined;
		if (tools && tools.length > 0) {
			const { getToolsAsObject } = await import('../tools/index.js');
			const toolNames = tools
				.map((t) => t.function?.name)
				.filter((name): name is string => Boolean(name));
			aiSdkTools = getToolsAsObject(toolNames);
			console.log('[vLLM] Using tools:', toolNames);
		}

		const startTime = Date.now();

		try {
			const result = streamText({
				model: client.chat(model), // Use .chat() to explicitly use chat completions endpoint
				messages: convertedMessages,
				maxOutputTokens: maxTokens,
				temperature,
				...(aiSdkTools && { tools: aiSdkTools })
				// Temporarily disabled smoothStream to debug streaming issues
				// experimental_transform: smoothStream({
				// 	delayInMs: 20,
				// 	chunking: 'word'
				// })
			});

			if (stream) {
				console.log('[vLLM] Returning streaming response');
				return createVllmStreamIterator(result);
			}

			// Non-streaming mode: wait for completion
			const text = await result.text;
			const usage = await result.usage;
			const finishReason = await result.finishReason;
			const toolCalls = await result.toolCalls;
			const response = await result.response;

			const duration = Date.now() - startTime;
			console.log('[vLLM] Response completed:', {
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
			console.error('[vLLM] API error after', `${duration}ms:`, error);
			throw new Error(`vLLM API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
};
