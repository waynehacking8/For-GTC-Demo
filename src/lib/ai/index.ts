import type { AIProvider, AIModelConfig } from './types.js';
import { openRouterProvider } from './providers/openrouter.js';
import { replicateProvider } from './providers/replicate.js';

export const AI_PROVIDERS: AIProvider[] = [
	openRouterProvider,
	replicateProvider
];

export function getAllModels(): AIModelConfig[] {
	return AI_PROVIDERS.flatMap(provider => provider.models);
}

export function getProvider(providerName: string): AIProvider | undefined {
	return AI_PROVIDERS.find(provider => provider.name === providerName);
}

export function getModelProvider(modelName: string): AIProvider | undefined {
	return AI_PROVIDERS.find(provider =>
		provider.models.some(model => model.name === modelName)
	);
}

export * from './types.js';
export { openRouterProvider } from './providers/openrouter.js';
export { replicateProvider } from './providers/replicate.js';