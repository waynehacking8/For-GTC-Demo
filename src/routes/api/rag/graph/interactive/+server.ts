import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const maxNodes = url.searchParams.get('max_nodes') || '100';
		const minDegree = url.searchParams.get('min_degree') || '1';

		console.log(`[RAG Graph] Generating interactive graph (max_nodes=${maxNodes}, min_degree=${minDegree})`);

		// Forward to LightRAG API
		const response = await fetch(
			`${LIGHTRAG_API_URL}/graph/interactive?max_nodes=${maxNodes}&min_degree=${minDegree}`,
			{
				method: 'GET',
			}
		);

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Graph] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Graph] Interactive graph generated successfully`);

		return json(data);
	} catch (error) {
		console.error('[RAG Graph] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
