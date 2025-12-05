import type {
	AIProvider,
	AIModelConfig,
	AIResponse,
	AIStreamChunk,
	AIMessage,
	ImageGenerationParams,
	AIImageResponse,
	AIImageStreamChunk
} from '../types.js';
import { env } from '$env/dynamic/private';
import { saveImageAndGetId } from '../utils.js';

// Configuration
const IMAGE_API_URL = env.IMAGE_API_URL || 'http://localhost:8004';

// Qwen-Image Local Model Configuration
const QWEN_IMAGE_LOCAL_MODELS: AIModelConfig[] = [
	{
		name: 'qwen-image-local',
		displayName: 'Qwen Image (Local)',
		provider: 'QwenImageLocal',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: true,
		supportsStreaming: false,
	}
];

/**
 * Generate image using local Qwen-Image API
 */
async function generateImage(params: ImageGenerationParams): Promise<AIImageResponse | AsyncIterableIterator<AIImageStreamChunk>> {
	if (!params.userId) {
		throw new Error('User ID is required for image generation');
	}

	// Parse size to width/height
	let width = 1024;
	let height = 1024;
	if (params.size) {
		const [w, h] = params.size.split('x').map(Number);
		if (w && h) {
			width = w;
			height = h;
		}
	}

	// Handle streaming
	if (params.stream) {
		return streamImageGeneration(params, width, height);
	}

	// Non-streaming generation
	try {
		const response = await fetch(`${IMAGE_API_URL}/generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: params.prompt,
				width,
				height,
				num_inference_steps: 50,
				guidance_scale: 4.0,
				seed: params.seed,
				output_format: 'base64'
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ detail: response.statusText }));
			throw new Error(`Image API error: ${error.detail || response.statusText}`);
		}

		const result = await response.json();

		if (!result.success || !result.image) {
			throw new Error('Failed to generate image');
		}

		// Extract base64 data from data URI
		const base64Match = result.image.match(/^data:image\/\w+;base64,(.+)$/);
		const imageData = base64Match ? base64Match[1] : result.image;

		// Save to storage and database
		const imageId = await saveImageAndGetId(
			imageData,
			'image/png',
			params.userId,
			params.chatId
		);

		return {
			imageId,
			mimeType: 'image/png',
			prompt: params.prompt,
			model: params.model,
			usage: {
				promptTokens: Math.ceil(params.prompt.length / 4),
				totalTokens: Math.ceil(params.prompt.length / 4)
			}
		};
	} catch (error) {
		console.error('Qwen-Image Local generation error:', error);
		throw new Error(`Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

/**
 * Stream image generation with progress updates
 */
async function* streamImageGeneration(
	params: ImageGenerationParams,
	width: number,
	height: number
): AsyncIterableIterator<AIImageStreamChunk> {
	try {
		const response = await fetch(`${IMAGE_API_URL}/generate/stream`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: params.prompt,
				width,
				height,
				num_inference_steps: 50,
				guidance_scale: 4.0,
				seed: params.seed,
				output_format: 'base64'
			})
		});

		if (!response.ok) {
			throw new Error(`Image API error: ${response.statusText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					try {
						const data = JSON.parse(line.slice(6));

						if (data.type === 'start') {
							// Progress update
							yield {
								type: 'image_generation.partial_image',
								partial_image_index: 0,
								done: false
							};
						} else if (data.type === 'complete') {
							// Final image
							const base64Match = data.image?.match(/^data:image\/\w+;base64,(.+)$/);
							const imageData = base64Match ? base64Match[1] : data.image;

							// Save to storage
							if (params.userId) {
								const imageId = await saveImageAndGetId(
									imageData,
									'image/png',
									params.userId,
									params.chatId
								);

								yield {
									type: 'image_generation.complete',
									b64_json: imageData,
									imageId,
									done: true
								};
							}
						} else if (data.type === 'error') {
							throw new Error(data.message);
						}
					} catch (parseError) {
						// Skip invalid JSON
					}
				}
			}
		}
	} catch (error) {
		console.error('Streaming error:', error);
		yield {
			type: 'image_generation.complete',
			done: true
		};
	}
}

/**
 * Placeholder chat method (not used for image generation, but required by interface)
 */
async function chat(params: {
	model: string;
	messages: AIMessage[];
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
}): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
	throw new Error('Qwen-Image Local provider does not support text chat. Use for image generation only.');
}

// Export the provider
export const qwenImageLocalProvider: AIProvider = {
	name: 'QwenImageLocal',
	models: QWEN_IMAGE_LOCAL_MODELS,
	chat,
	generateImage
};
