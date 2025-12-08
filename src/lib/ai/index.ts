import type { AIProvider, AIModelConfig } from './types.js';
import { openRouterProvider } from './providers/openrouter.js';
import { replicateProvider } from './providers/replicate.js';
import { ollamaProvider } from './providers/ollama.js';
import { vllmProvider } from './providers/vllm.js';

export const AI_PROVIDERS: AIProvider[] = [
	openRouterProvider,
	replicateProvider,
	ollamaProvider,
	vllmProvider
];

export function getAllModels(): AIModelConfig[] {
	return AI_PROVIDERS.flatMap(provider => provider.models);
}

export function getProvider(providerName: string): AIProvider | undefined {
	return AI_PROVIDERS.find(provider => provider.name === providerName);
}

// Model name mapping for backwards compatibility
const MODEL_NAME_ALIASES: Record<string, string> = {
	'/home/wayne/Desktop/LocalMind/models/Qwen3-VL-32B-Instruct': 'Qwen/Qwen3-VL-32B-Instruct',
};

export function getModelProvider(modelName: string): AIProvider | undefined {
	// Check for alias first
	const normalizedName = MODEL_NAME_ALIASES[modelName] || modelName;
	return AI_PROVIDERS.find(provider =>
		provider.models.some(model => model.name === normalizedName)
	);
}

// Normalize model name (convert aliases to canonical names)
export function normalizeModelName(modelName: string): string {
	return MODEL_NAME_ALIASES[modelName] || modelName;
}

export * from './types.js';
export { openRouterProvider } from './providers/openrouter.js';
export { replicateProvider } from './providers/replicate.js';
export { ollamaProvider } from './providers/ollama.js';
export { vllmProvider } from './providers/vllm.js';