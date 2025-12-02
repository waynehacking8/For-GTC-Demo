import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { node_types, edge_types, min_degree = 0, output_format = 'html' } = body;

		console.log(`[RAG Graph Visualize] Generating graph visualization (format: ${output_format})`);

		// Build query parameters
		const params = new URLSearchParams();
		if (node_types && Array.isArray(node_types)) {
			node_types.forEach(type => params.append('node_types', type));
		}
		if (edge_types && Array.isArray(edge_types)) {
			edge_types.forEach(type => params.append('edge_types', type));
		}
		params.append('min_degree', min_degree.toString());
		params.append('output_format', output_format);

		// Forward to LightRAG API
		const response = await fetch(`${LIGHTRAG_API_URL}/graph/visualize?${params.toString()}`, {
			method: 'POST',
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[RAG Graph Visualize] Error:', errorData);
			return json(
				{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		console.log(`[RAG Graph Visualize] Visualization generated successfully`);

		return json(data);
	} catch (error) {
		console.error('[RAG Graph Visualize] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
