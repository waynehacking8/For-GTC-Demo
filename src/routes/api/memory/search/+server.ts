/**
 * POST /api/memory/search - 搜尋用戶記憶
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { searchPersonalMemory } from '$lib/server/knowledge.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { userId, query, limit = 10 } = body;

		if (!userId || !query) {
			return json({
				error: 'userId and query are required'
			}, { status: 400 });
		}

		const results = await searchPersonalMemory(userId, query);

		return json({
			success: true,
			query,
			data: results.slice(0, limit),
			count: results.length
		});

	} catch (error) {
		console.error('[Memory API] Search error:', error);
		return json({
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
