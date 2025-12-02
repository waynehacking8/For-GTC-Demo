import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async () => {
	try {
		console.log('[RAG Documents] Fetching document list');

		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/documents`, {
			method: 'GET',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Documents] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Documents] Found ${data.documents?.length || 0} documents`);

		return json(data);
	} catch (error) {
		console.error('[RAG Documents] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
