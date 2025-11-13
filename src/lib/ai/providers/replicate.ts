import type {
	AIProvider,
	AIModelConfig,
	AIResponse,
	AIStreamChunk,
	AIMessage,
	ImageGenerationParams,
	AIImageResponse,
	VideoGenerationParams,
	AIVideoResponse
} from '../types.js';
import { env } from '$env/dynamic/private';
import { saveImageAndGetId, saveVideoAndGetId, createProviderError } from '../utils.js';
import { getReplicateApiKey, getOpenAIApiKey } from '$lib/server/settings-store.js';
import { db } from '$lib/server/db/index.js';
import { images } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { storageService } from '$lib/server/storage.js';
import Replicate from 'replicate';

// Cache for Replicate client instances (invalidated when API key changes)
let cachedClient: Replicate | null = null;
let cachedApiKey: string | null = null;

// Get API key from database or fallback to environment variable
async function getApiKey(): Promise<string> {
	try {
		const dbKey = await getReplicateApiKey();
		return dbKey || env.REPLICATE_API_TOKEN || '';
	} catch (error) {
		console.warn('Failed to get Replicate API key from database, using environment variable:', error);
		return env.REPLICATE_API_TOKEN || '';
	}
}

// Get or create Replicate client with caching
async function getClient(): Promise<Replicate> {
	const apiKey = await getApiKey();

	if (!apiKey) {
		throw new Error('Replicate API key not configured');
	}

	// Return cached client if API key hasn't changed
	if (cachedClient && cachedApiKey === apiKey) {
		return cachedClient;
	}

	// Create new client and cache it
	cachedClient = new Replicate({ auth: apiKey });
	cachedApiKey = apiKey;
	return cachedClient;
}

// Replicate Image Generation Models Configuration
const REPLICATE_IMAGE_MODELS: AIModelConfig[] = [
	// OpenAI Models
	{
		name: 'gpt-image-1',
		displayName: 'GPT Image 1',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'gpt-image-1-mini',
		displayName: 'GPT Image 1 Mini',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'dall-e-3',
		displayName: 'DALL-E 3',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'dall-e-2',
		displayName: 'DALL-E 2',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Google Models
	{
		name: 'imagen-4',
		displayName: 'Imagen 4',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'imagen-4-ultra',
		displayName: 'Imagen 4 Ultra',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'imagen-4-fast',
		displayName: 'Imagen 4 Fast',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'imagen-3',
		displayName: 'Imagen 3',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'imagen-3-fast',
		displayName: 'Imagen 3 Fast',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'gemini-2.5-flash-image',
		displayName: 'Gemini 2.5 Flash Image',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Black Forest Labs Models
	{
		name: 'flux-schnell',
		displayName: 'FLUX Schnell',
		provider: 'BlackForestLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'flux-1.1-pro',
		displayName: 'FLUX 1.1 Pro',
		provider: 'BlackForestLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'flux-1.1-pro-ultra',
		displayName: 'FLUX 1.1 Pro Ultra',
		provider: 'BlackForestLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'flux-kontext-pro',
		displayName: 'FLUX Kontext Pro',
		provider: 'BlackForestLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'flux-kontext-max',
		displayName: 'FLUX Kontext Max',
		provider: 'BlackForestLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Stability AI Models
	{
		name: 'stable-diffusion-3.5-large',
		displayName: 'Stable Diffusion 3.5 Large',
		provider: 'StabilityAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'stable-diffusion-3.5-large-turbo',
		displayName: 'Stable Diffusion 3.5 Large Turbo',
		provider: 'StabilityAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'stable-diffusion-3.5-medium',
		displayName: 'Stable Diffusion 3.5 Medium',
		provider: 'StabilityAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'stable-diffusion-3',
		displayName: 'Stable Diffusion 3',
		provider: 'StabilityAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Luma Models
	{
		name: 'photon-1',
		displayName: 'Photon 1',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'photon-flash-1',
		displayName: 'Photon Flash 1',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Bytedance Models
	{
		name: 'seedream-4',
		displayName: 'SeeDream 4',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'seedream-3',
		displayName: 'SeeDream 3',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'dreamina-3.1',
		displayName: 'Dreamina 3.1',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Alibaba/Wan Models
	{
		name: 'wan-2.2-image',
		displayName: 'Wan 2.2 Image',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Alibaba/Qwen Models
	{
		name: 'qwen-image',
		displayName: 'Qwen Image',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// Tencent Models
	{
		name: 'hunyuan-image-3',
		displayName: 'Hunyuan Image 3',
		provider: 'Tencent',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'hunyuan-image-2.1',
		displayName: 'Hunyuan Image 2.1',
		provider: 'Tencent',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// XAI Models
	{
		name: 'grok-2-image',
		displayName: 'Grok 2 Image',
		provider: 'xAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// LeonardoAI Models
	{
		name: 'lucid-origin',
		displayName: 'Lucid Origin',
		provider: 'LeonardoAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'phoenix-1.0',
		displayName: 'Phoenix 1.0',
		provider: 'LeonardoAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	// IdeogramAI Models
	{
		name: 'ideogram-v3-quality',
		displayName: 'Ideogram V3 Quality',
		provider: 'Ideogram',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'ideogram-v3-balanced',
		displayName: 'Ideogram V3 Balanced',
		provider: 'Ideogram',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'ideogram-v3-turbo',
		displayName: 'Ideogram V3 Turbo',
		provider: 'Ideogram',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'ideogram-v2',
		displayName: 'Ideogram V2',
		provider: 'Ideogram',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	},
	{
		name: 'ideogram-v2-turbo',
		displayName: 'Ideogram V2 Turbo',
		provider: 'Ideogram',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsImageGeneration: true,
		supportsImageStreaming: false,
		supportsStreaming: false,
	}
];

// Replicate Video Generation Models Configuration
const REPLICATE_VIDEO_MODELS: AIModelConfig[] = [
	// OpenAI Models
	{
		name: 'sora-2',
		displayName: 'Sora 2',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'sora-2-pro',
		displayName: 'Sora 2 Pro',
		provider: 'OpenAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// Google Models
	{
		name: 'veo-3.1',
		displayName: 'Veo 3.1',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'veo-3.1-fast',
		displayName: 'Veo 3.1 Fast',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'veo-3',
		displayName: 'Veo 3',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'veo-3-fast',
		displayName: 'Veo 3 Fast',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'veo-2',
		displayName: 'Veo 2',
		provider: 'Google',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// Luma Models
	{
		name: 'ray-2-720p',
		displayName: 'Ray 2 720p',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'ray-2-540p',
		displayName: 'Ray 2 540p',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'ray-flash-2-720p',
		displayName: 'Ray Flash 2 720p',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'ray-flash-2-540p',
		displayName: 'Ray Flash 2 540p',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'ray',
		displayName: 'Ray',
		provider: 'LumaLabs',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// Bytedance Models
	{
		name: 'seedance-1-pro',
		displayName: 'SeeDance 1 Pro',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'seedance-1-pro-fast',
		displayName: 'SeeDance 1 Pro Fast',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'seedance-1-lite',
		displayName: 'SeeDance 1 Lite',
		provider: 'ByteDance',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// Alibaba/Wan Models
	{
		name: 'wan-2.5-t2v',
		displayName: 'Wan 2.5 T2V',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'wan-2.5-t2v-fast',
		displayName: 'Wan 2.5 T2V Fast',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'wan-2.5-i2v',
		displayName: 'Wan 2.5 I2V',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'wan-2.5-i2v-fast',
		displayName: 'Wan 2.5 I2V Fast',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'wan-2.2-5b-fast',
		displayName: 'Wan 2.2 5b Fast',
		provider: 'Alibaba',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// LeonardoAI Models
	{
		name: 'motion-2.0',
		displayName: 'Motion 2.0',
		provider: 'LeonardoAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// Pixverse Models
	{
		name: 'pixverse-v5',
		displayName: 'Pixverse v5',
		provider: 'Pixverse',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'pixverse-v4.5',
		displayName: 'Pixverse v4.5',
		provider: 'Pixverse',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'pixverse-v4',
		displayName: 'Pixverse v4',
		provider: 'Pixverse',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	// KlingAI Models
	{
		name: 'kling-v2.5-turbo-pro',
		displayName: 'Kling 2.5 Turbo Pro',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v2.1',
		displayName: 'Kling 2.1',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v2.1-master',
		displayName: 'Kling 2.1 Master',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v2.0',
		displayName: 'Kling 2.0',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v1.6-standard',
		displayName: 'Kling 1.6 Standard',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v1.6-pro',
		displayName: 'Kling 1.6 Pro',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v1.5-standard',
		displayName: 'Kling 1.5 Standard',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	},
	{
		name: 'kling-v1.5-pro',
		displayName: 'Kling 1.5 Pro',
		provider: 'KlingAI',
		maxTokens: 4096,
		supportsTextInput: true,
		supportsImageInput: true,
		supportsVideoGeneration: true,
		supportsStreaming: false,
	}
];

// Model identifier mapping to Replicate model paths
const MODEL_IDENTIFIERS: Record<string, string> = {
	// ===== IMAGE MODELS =====
	// OpenAI models
	'gpt-image-1': 'openai/gpt-image-1',
	'gpt-image-1-mini': 'openai/gpt-image-1-mini',
	'dall-e-3': 'openai/dall-e-3',
	'dall-e-2': 'openai/dall-e-2',

	// Google models
	'imagen-4': 'google/imagen-4',
	'imagen-4-ultra': 'google/imagen-4-ultra',
	'imagen-4-fast': 'google/imagen-4-fast',
	'imagen-3': 'google/imagen-3',
	'imagen-3-fast': 'google/imagen-3-fast',
	'gemini-2.5-flash-image': 'google/gemini-2.5-flash-image',

	// Black Forest Labs models
	'flux-schnell': 'black-forest-labs/flux-schnell',
	'flux-1.1-pro': 'black-forest-labs/flux-1.1-pro',
	'flux-1.1-pro-ultra': 'black-forest-labs/flux-1.1-pro-ultra',
	'flux-kontext-pro': 'black-forest-labs/flux-kontext-pro',
	'flux-kontext-max': 'black-forest-labs/flux-kontext-max',

	// Stable Diffusion models
	'stable-diffusion-3.5-large': 'stability-ai/stable-diffusion-3.5-large',
	'stable-diffusion-3.5-large-turbo': 'stability-ai/stable-diffusion-3.5-large-turbo',
	'stable-diffusion-3.5-medium': 'stability-ai/stable-diffusion-3.5-medium',
	'stable-diffusion-3': 'stability-ai/stable-diffusion-3',

	// Luma models
	'photon-1': 'luma/photon',
	'photon-flash-1': 'luma/photon-flash',

	// Bytedance models
	'seedream-4': 'bytedance/seedream-4',
	'seedream-3': 'bytedance/seedream-3',
	'dreamina-3.1': 'bytedance/dreamina-3.1',

	// Alibaba/Wan models
	'wan-2.2-image': 'prunaai/wan-2.2-image',

	// Alibaba/Qwen models
	'qwen-image': 'qwen/qwen-image',

	// Tencent models
	'hunyuan-image-3': 'tencent/hunyuan-image-3',
	'hunyuan-image-2.1': 'tencent/hunyuan-image-2.1',

	// XAI models
	'grok-2-image': 'xai/grok-2-image',

	// LeonardoAI models
	'lucid-origin': 'leonardoai/lucid-origin',
	'phoenix-1.0': 'leonardoai/phoenix-1.0',

	// IdeogramAI models
	'ideogram-v3-quality': 'ideogram-ai/ideogram-v3-quality',
	'ideogram-v3-balanced': 'ideogram-ai/ideogram-v3-balanced',
	'ideogram-v3-turbo': 'ideogram-ai/ideogram-v3-turbo',
	'ideogram-v2': 'ideogram-ai/ideogram-v2',
	'ideogram-v2-turbo': 'ideogram-ai/ideogram-v2-turbo',

	// ===== VIDEO MODELS =====
	// OpenAI models
	'sora-2': 'openai/sora-2',
	'sora-2-pro': 'openai/sora-2-pro',

	// Google models
	'veo-3.1': 'google/veo-3.1',
	'veo-3.1-fast': 'google/veo-3.1-fast',
	'veo-3': 'google/veo-3',
	'veo-3-fast': 'google/veo-3-fast',
	'veo-2': 'google/veo-2',

	// Luma models
	'ray-2-720p': 'luma/ray-2-720p',
	'ray-2-540p': 'luma/ray-2-540p',
	'ray-flash-2-720p': 'luma/ray-flash-2-720p',
	'ray-flash-2-540p': 'luma/ray-flash-2-540p',
	'ray': 'luma/ray',

	// Bytedance models
	'seedance-1-pro': 'bytedance/seedance-1-pro',
	'seedance-1-pro-fast': 'bytedance/seedance-1-pro-fast',
	'seedance-1-lite': 'bytedance/seedance-1-lite',

	// Alibaba/Wan models
	'wan-2.5-t2v': 'wan-video/wan-2.5-t2v',
	'wan-2.5-t2v-fast': 'wan-video/wan-2.5-t2v-fast',
	'wan-2.5-i2v': 'wan-video/wan-2.5-i2v',
	'wan-2.5-i2v-fast': 'wan-video/wan-2.5-i2v-fast',
	'wan-2.2-5b-fast': 'wan-video/wan-2.2-5b-fast',

	// LeonardoAI models
	'motion-2.0': 'leonardoai/motion-2.0',

	// Pixverse models
	'pixverse-v5': 'pixverse/pixverse-v5',
	'pixverse-v4.5': 'pixverse/pixverse-v4.5',
	'pixverse-v4': 'pixverse/pixverse-v4',

	// KlingAI models
	'kling-v2.5-turbo-pro': 'kwaivgi/kling-v2.5-turbo-pro',
	'kling-v2.1': 'kwaivgi/kling-v2.1',
	'kling-v2.1-master': 'kwaivgi/kling-v2.1-master',
	'kling-v2.0': 'kwaivgi/kling-v2.0',
	'kling-v1.6-standard': 'kwaivgi/kling-v1.6-standard',
	'kling-v1.6-pro': 'kwaivgi/kling-v1.6-pro',
	'kling-v1.5-standard': 'kwaivgi/kling-v1.5-standard',
	'kling-v1.5-pro': 'kwaivgi/kling-v1.5-pro',

};

/**
 * Model-specific parameter configuration
 * Maps model names to their specific parameter requirements
 */
interface ModelParamConfig {
	imageInputParam?: {
		name: string;          // Parameter name (e.g., "image", "image_input", "image_prompt", "image_reference")
		isArray: boolean;      // Whether to wrap in array
		needsDataUri: boolean; // Whether to convert to data URI (vs URL)
	};
	sizeParam?: {
		name: string;                           // Parameter name (e.g., "aspect_ratio", "size")
		format: 'aspect-ratio' | 'dimensions';  // Format type
	};
	seedParam?: {
		name: string;          // Parameter name (e.g., "seed", "random_seed")
		type: 'integer';       // Type validation
	};
}

const MODEL_CONFIGS: Record<string, ModelParamConfig> = {
	// ===== IMAGE MODELS =====

	// OpenAI Models
	'gpt-image-1': {
		imageInputParam: { name: 'input_images', isArray: true, needsDataUri: true },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'gpt-image-1-mini': {
		imageInputParam: { name: 'input_images', isArray: true, needsDataUri: true },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'dall-e-3': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},

	// Google Models
	'imagen-4': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'imagen-4-ultra': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'imagen-4-fast': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'imagen-3': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'imagen-3-fast': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},
	'gemini-2.5-flash-image': {
		imageInputParam: { name: 'image_input', isArray: true, needsDataUri: true },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' }
	},

	// Black Forest Labs Models
	'flux-1.1-pro': {
		imageInputParam: { name: 'image_prompt', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'flux-1.1-pro-ultra': {
		imageInputParam: { name: 'image_prompt', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'flux-kontext-pro': {
		imageInputParam: { name: 'input_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'flux-kontext-max': {
		imageInputParam: { name: 'input_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'flux-schnell': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Stability AI Models
	'stable-diffusion-3.5-large': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'stable-diffusion-3.5-large-turbo': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'stable-diffusion-3.5-medium': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'stable-diffusion-3': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Luma Models
	'photon-1': {
		imageInputParam: { name: 'image_reference', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'photon-flash-1': {
		imageInputParam: { name: 'image_reference', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Bytedance Models
	'seedream-4': {
		imageInputParam: { name: 'image_input', isArray: true, needsDataUri: true },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'seedream-3': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'dreamina-3.1': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Alibaba/Wan Models
	'wan-2.2-image': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Alibaba/Qwen Models
	'qwen-image': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Tencent Models
	'hunyuan-image-3': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'hunyuan-image-2.1': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// LeonardoAI Models
	'lucid-origin': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'phoenix-1.0': {
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},

	// Ideogram Models
	'ideogram-v3-quality': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'ideogram-v3-balanced': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'ideogram-v3-turbo': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'ideogram-v2': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'ideogram-v2-turbo': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// ===== VIDEO MODELS =====

	// OpenAI models
	'sora-2': {
		imageInputParam: { name: 'input_reference', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'sora-2-pro': {
		imageInputParam: { name: 'input_reference', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},

	// Google models
	'veo-3.1': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'veo-3.1-fast': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'veo-3': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'veo-3-fast': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'veo-2': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Luma models
	'ray-2-720p': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'ray-2-540p': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'ray-flash-2-720p': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'ray-flash-2-540p': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'ray': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},

	// ByteDance models
	'seedance-1-pro': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'seedance-1-pro-fast': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'seedance-1-lite': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// Alibaba/Wan models
	'wan-2.5-t2v': {
		seedParam: { name: 'seed', type: 'integer' }
	},
	'wan-2.5-t2v-fast': {
		seedParam: { name: 'seed', type: 'integer' }
	},
	'wan-2.5-i2v': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'wan-2.5-i2v-fast': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'wan-2.2-5b-fast': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// LeonardoAI models
	'motion-2.0': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},

	// Pixverse models
	'pixverse-v5': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'pixverse-v4.5': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},
	'pixverse-v4': {
		imageInputParam: { name: 'image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
		seedParam: { name: 'seed', type: 'integer' }
	},

	// KlingAI models
	'kling-v2.5-turbo-pro': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v2.1': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false }
	},
	'kling-v2.1-master': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v2.0': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v1.6-standard': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v1.6-pro': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v1.5-standard': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	},
	'kling-v1.5-pro': {
		imageInputParam: { name: 'start_image', isArray: false, needsDataUri: false },
		sizeParam: { name: 'aspect_ratio', format: 'aspect-ratio' },
	}
};

/**
 * Infer MIME type from file path extension
 */
function inferMimeTypeFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase();
	const mimeTypes: Record<string, string> = {
		'jpg': 'image/jpeg',
		'jpeg': 'image/jpeg',
		'png': 'image/png',
		'gif': 'image/gif',
		'webp': 'image/webp'
	};
	return mimeTypes[ext || ''] || 'image/jpeg';
}

/**
 * Fetch image from storage and convert to data URI for Replicate input
 */
async function fetchImageAsDataUri(imageUrl: string): Promise<string> {
	// Case 1: Internal API path (format: /api/images/[id])
	const imageIdMatch = imageUrl.match(/\/api\/images\/([a-f0-9-]+)/i);
	if (imageIdMatch) {
		const imageId = imageIdMatch[1];

		// Fetch image metadata from database
		const [imageRecord] = await db
			.select()
			.from(images)
			.where(eq(images.id, imageId));

		if (!imageRecord || !imageRecord.cloudPath) {
			throw new Error('Image not found');
		}

		// Download image from storage
		const imageBuffer = await storageService.download(imageRecord.cloudPath);

		// Convert to base64
		const base64 = Buffer.from(imageBuffer).toString('base64');
		const mimeType = imageRecord.mimeType || 'image/jpeg';

		// Return data URI
		return `data:${mimeType};base64,${base64}`;
	}

	// Case 2: Local static path (format: /static/uploads/{userId}/images/generated/{filename})
	if (imageUrl.startsWith('/static/')) {
		try {
			// Extract storage path from URL
			// URL format: /static/uploads/{userId}/images/generated/{filename}
			// Storage path: {userId}/images/generated/{filename}
			const storagePath = imageUrl.replace('/static/uploads/', '');

			// Download from storage service
			const imageBuffer = await storageService.download(storagePath);

			// Convert to base64
			const base64 = Buffer.from(imageBuffer).toString('base64');

			// Infer MIME type from file extension
			const mimeType = inferMimeTypeFromPath(imageUrl);

			// Return data URI
			return `data:${mimeType};base64,${base64}`;
		} catch (error) {
			throw new Error(`Failed to load local image: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	// Case 3: External URL (presigned R2 URL, https:// URL)
	if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
		try {
			// Fetch the image from the URL
			const response = await fetch(imageUrl);

			if (!response.ok) {
				throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
			}

			// Get the image data as array buffer
			const arrayBuffer = await response.arrayBuffer();

			// Convert to base64
			const base64 = Buffer.from(arrayBuffer).toString('base64');

			// Get MIME type from response headers or default to image/jpeg
			const contentType = response.headers.get('content-type') || 'image/jpeg';

			// Return data URI
			return `data:${contentType};base64,${base64}`;
		} catch (error) {
			throw new Error(`Failed to fetch image from URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	// If none of the formats match, throw error
	throw new Error('Invalid image URL format');
}

/**
 * Convert FileOutput or URL to base64 data
 */
async function fileOutputToBase64(output: any): Promise<string> {
	// If it's already a string, it might be base64 or a URL
	if (typeof output === 'string') {
		// If it starts with http, fetch it
		if (output.startsWith('http://') || output.startsWith('https://')) {
			const response = await fetch(output);
			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer).toString('base64');
		}
		// Otherwise assume it's already base64
		return output;
	}

	// If it's a FileOutput ReadableStream, read it
	if (output && typeof output === 'object' && 'url' in output) {
		// FileOutput has a url() method
		const url = typeof output.url === 'function' ? output.url() : output.url;
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer).toString('base64');
	}

	// If it's a Blob or has arrayBuffer method
	if (output && typeof output.arrayBuffer === 'function') {
		const arrayBuffer = await output.arrayBuffer();
		return Buffer.from(arrayBuffer).toString('base64');
	}

	throw new Error('Unsupported output format from Replicate');
}

/**
 * Generate image using Replicate
 */
async function generateImage(params: ImageGenerationParams): Promise<AIImageResponse> {
	const client = await getClient();
	const modelIdentifier = MODEL_IDENTIFIERS[params.model];

	if (!modelIdentifier) {
		throw new Error(`Unknown Replicate model: ${params.model}`);
	}

	if (!params.userId) {
		throw new Error('User ID is required for image generation');
	}

	try {
		// Get model configuration
		const modelConfig = MODEL_CONFIGS[params.model];

		// Prepare input based on model
		const input: Record<string, any> = {
			prompt: params.prompt
		};

		// Add openai_api_key for specific OpenAI models that require it
		// Only gpt-image-1 and gpt-image-1-mini require passing the OpenAI API key as a body parameter
		if (params.model === 'gpt-image-1' || params.model === 'gpt-image-1-mini') {
			const openaiKey = await getOpenAIApiKey();
			if (!openaiKey) {
				throw new Error('OpenAI API key not configured. Please add it in Admin Settings > AI Models.');
			}
			input.openai_api_key = openaiKey;
		}

		// Add image input if provided and model supports it
		if (params.imageUrl && modelConfig?.imageInputParam) {
			const { name, isArray, needsDataUri } = modelConfig.imageInputParam;

			try {
				// Fetch/convert image based on model requirements
				let imageData: string | string[];

				// Check if it's an internal path that needs conversion
				const isInternalPath = params.imageUrl.startsWith('/api/images/') ||
					params.imageUrl.startsWith('/static/');

				if (needsDataUri || isInternalPath) {
					// Convert to data URI
					// - Always for models that require it (e.g., Gemini)
					// - Also for internal paths (e.g., /api/images/[id]) as fallback for backward compatibility
					const dataUri = await fetchImageAsDataUri(params.imageUrl);
					imageData = isArray ? [dataUri] : dataUri;
				} else {
					// Use URL as-is for external URLs (e.g., presigned R2 URLs, https:// URLs)
					imageData = isArray ? [params.imageUrl] : params.imageUrl;
				}

				input[name] = imageData;
			} catch (error) {
				console.error('Failed to process image input:', error);
				throw new Error(`Failed to process input image: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}

		// Add size/aspect ratio if provided and model supports it
		if (params.size && modelConfig?.sizeParam) {
			const { name, format } = modelConfig.sizeParam;

			if (format === 'aspect-ratio') {
				// Convert size like "1024x1024" to aspect ratio "1:1"
				const [width, height] = params.size.split('x').map(Number);
				if (width && height) {
					const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
					const divisor = gcd(width, height);
					input[name] = `${width / divisor}:${height / divisor}`;
				}
			} else {
				// Pass dimensions as-is
				input[name] = params.size;
			}
		}

		// Add seed if provided and model supports it
		if (params.seed !== undefined && modelConfig?.seedParam) {
			const { name } = modelConfig.seedParam;
			input[name] = params.seed;
		}

		// Run the model (assert type as Replicate expects owner/model format)
		const output = await client.run(modelIdentifier as `${string}/${string}`, { input });

		// Handle output (could be array of URLs or FileOutput objects)
		let imageData: string;

		if (Array.isArray(output) && output.length > 0) {
			imageData = await fileOutputToBase64(output[0]);
		} else if (output) {
			imageData = await fileOutputToBase64(output);
		} else {
			throw new Error('No output received from Replicate');
		}

		// Save to storage and database
		const imageId = await saveImageAndGetId(
			imageData,
			'image/png', // Replicate typically returns PNG
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
		throw createProviderError('Replicate', 'image generation', error);
	}
}

/**
 * Generate video using Replicate
 */
async function generateVideo(params: VideoGenerationParams): Promise<AIVideoResponse> {
	const client = await getClient();
	const modelIdentifier = MODEL_IDENTIFIERS[params.model];

	if (!modelIdentifier) {
		throw new Error(`Unknown Replicate video model: ${params.model}`);
	}

	if (!params.userId) {
		throw new Error('User ID is required for video generation');
	}

	try {
		// Get model configuration
		const modelConfig = MODEL_CONFIGS[params.model];

		// Prepare input based on model
		const input: Record<string, any> = {
			prompt: params.prompt
		};

		// Add image input if provided and model supports it (for i2v models)
		if (params.imageUrl && modelConfig?.imageInputParam) {
			const { name, isArray, needsDataUri } = modelConfig.imageInputParam;

			try {
				// Fetch/convert image based on model requirements
				let imageData: string | string[];

				// Check if it's an internal path that needs conversion
				const isInternalPath = params.imageUrl.startsWith('/api/images/') ||
					params.imageUrl.startsWith('/static/');

				if (needsDataUri || isInternalPath) {
					// Convert to data URI
					// - Always for models that require it
					// - Also for internal paths (e.g., /api/images/[id]) as fallback for backward compatibility
					const dataUri = await fetchImageAsDataUri(params.imageUrl);
					imageData = isArray ? [dataUri] : dataUri;
				} else {
					// Use URL as-is for external URLs (e.g., presigned R2 URLs, https:// URLs)
					imageData = isArray ? [params.imageUrl] : params.imageUrl;
				}

				input[name] = imageData;
			} catch (error) {
				console.error('Failed to process image input for video:', error);
				throw new Error(`Failed to process input image: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}

		// Add duration if supported
		if (params.duration) {
			input.duration = params.duration;
		}

		// Add resolution/fps if provided
		if (params.resolution) {
			input.resolution = params.resolution;
		}
		if (params.fps) {
			input.fps = params.fps;
		}

		// Add seed if provided and model supports it
		if (params.seed !== undefined && modelConfig?.seedParam) {
			const { name } = modelConfig.seedParam;
			input[name] = params.seed;
		}

		// Run the model (assert type as Replicate expects owner/model format)
		const output = await client.run(modelIdentifier as `${string}/${string}`, { input });

		// Handle output
		let videoData: string;

		if (Array.isArray(output) && output.length > 0) {
			videoData = await fileOutputToBase64(output[0]);
		} else if (output) {
			videoData = await fileOutputToBase64(output);
		} else {
			throw new Error('No output received from Replicate');
		}

		// Determine if video has audio based on model
		const hasAudio = params.model.includes('veo') || params.model.includes('wan') || params.model.includes('hailuo');

		// Save to storage and database
		const videoId = await saveVideoAndGetId(
			videoData,
			'video/mp4', // Replicate typically returns MP4
			params.userId,
			params.chatId,
			params.duration || 8,
			params.resolution || '720p',
			params.fps || 24,
			hasAudio
		);

		return {
			videoId,
			mimeType: 'video/mp4',
			prompt: params.prompt,
			model: params.model,
			duration: params.duration || 8,
			resolution: params.resolution || '720p',
			fps: params.fps || 24,
			hasAudio,
			usage: {
				promptTokens: Math.ceil(params.prompt.length / 4),
				totalTokens: Math.ceil(params.prompt.length / 4)
			}
		};
	} catch (error) {
		throw createProviderError('Replicate', 'video generation', error);
	}
}

/**
 * Placeholder chat method (not used for Replicate, but required by interface)
 */
async function chat(params: {
	model: string;
	messages: AIMessage[];
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
}): Promise<AIResponse | AsyncIterableIterator<AIStreamChunk>> {
	throw new Error('Replicate provider does not support text chat. Use OpenRouter instead.');
}

// Export the Replicate provider
export const replicateProvider: AIProvider = {
	name: 'Replicate',
	models: [...REPLICATE_IMAGE_MODELS, ...REPLICATE_VIDEO_MODELS],
	chat,
	generateImage,
	generateVideo
};
