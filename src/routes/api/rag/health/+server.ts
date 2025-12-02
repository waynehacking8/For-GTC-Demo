import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async () => {
	try {
		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/health`, {
			method: 'GET',
			signal: AbortSignal.timeout(5000), // 5 second timeout
		});

		if (!response.ok) {
			return json(
				{
					status: 'unhealthy',
					lightrag_available: false,
					error: `LightRAG API returned status ${response.status}`
				},
				{ status: 503 }
			);
		}

		const data = await response.json();

		return json({
			status: 'healthy',
			lightrag_available: true,
			lightrag_status: data,
		});
	} catch (error) {
		console.error('[RAG Health] Error checking LightRAG health:', error);
		return json(
			{
				status: 'unhealthy',
				lightrag_available: false,
				error: error instanceof Error ? error.message : 'Failed to connect to LightRAG API'
			},
			{ status: 503 }
		);
	}
};
