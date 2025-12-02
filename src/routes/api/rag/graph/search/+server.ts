import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const query = url.searchParams.get('query');
		const limit = url.searchParams.get('limit') || '10';

		if (!query || query.trim().length === 0) {
			return json({ error: 'Query parameter is required' }, { status: 400 });
		}

		console.log(`[RAG Graph Search] Searching nodes: ${query}`);

		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/graph/search?query=${encodeURIComponent(query)}&limit=${limit}`, {
			method: 'GET',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Graph Search] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Graph Search] Found ${data.total_results || 0} results`);

		return json(data);
	} catch (error) {
		console.error('[RAG Graph Search] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
