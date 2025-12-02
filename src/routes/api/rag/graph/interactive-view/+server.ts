import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async () => {
	try {
		console.log('[RAG Graph] Fetching interactive graph view');

		// Forward to LightRAG API and stream the HTML response
		const response = await fetch(`${LIGHTRAG_API_URL}/graph/interactive-view`, {
			method: 'GET',
		});

		if (!response.ok) {
			console.error('[RAG Graph] Error fetching view:', response.statusText);
			return new Response('Failed to load interactive graph', {
				status: response.status,
				headers: {
					'Content-Type': 'text/plain',
				},
			});
		}

		// Stream the HTML directly to the client
		const html = await response.text();
		console.log(`[RAG Graph] Interactive graph view loaded successfully`);

		return new Response(html, {
			status: 200,
			headers: {
				'Content-Type': 'text/html',
			},
		});
	} catch (error) {
		console.error('[RAG Graph] Exception:', error);
		return new Response('Internal server error', {
			status: 500,
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	}
};
