import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const POST: RequestHandler = async () => {
	try {
		console.log('[RAG Clear Processing] Clearing processing documents');

		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/documents/clear-processing`, {
			method: 'POST',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Clear Processing] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Clear Processing] Removed ${data.removed || 0} document(s)`);

		return json(data);
	} catch (error) {
		console.error('[RAG Clear Processing] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
