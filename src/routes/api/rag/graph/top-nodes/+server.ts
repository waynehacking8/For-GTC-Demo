import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const top_k = url.searchParams.get('top_k') || '10';
		const metric = url.searchParams.get('metric') || 'degree';

		// Validate metric
		const validMetrics = ['degree', 'betweenness', 'pagerank'];
		if (!validMetrics.includes(metric)) {
			return json({
				error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}`
			}, { status: 400 });
		}

		console.log(`[RAG Graph Top Nodes] Getting top ${top_k} nodes by ${metric}`);

		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/graph/top-nodes?top_k=${top_k}&metric=${metric}`, {
			method: 'GET',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Graph Top Nodes] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Graph Top Nodes] Retrieved ${data.nodes?.length || 0} top nodes`);

		return json(data);
	} catch (error) {
		console.error('[RAG Graph Top Nodes] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
