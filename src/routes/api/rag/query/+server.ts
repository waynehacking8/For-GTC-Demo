import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { query, mode = 'hybrid', top_k = 5, return_sources = true, use_cache = true } = body;

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return json({ error: 'Query is required and must be a non-empty string' }, { status: 400 });
		}

		// Validate mode
		const validModes = ['naive', 'local', 'global', 'hybrid'];
		if (!validModes.includes(mode)) {
			return json({
				error: `Invalid mode. Must be one of: ${validModes.join(', ')}`
			}, { status: 400 });
		}

		console.log(`[RAG Query] Mode: ${mode}, Query: ${query.substring(0, 50)}...`);

		// Forward request to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/query`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query,
				mode,
				top_k,
				return_sources,
				use_cache,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Query] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Query] Success, answer length: ${data.answer?.length || 0} chars`);

		return json(data);
	} catch (error) {
		console.error('[RAG Query] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
