/**
 * GET /api/memory/health - Health check for Memory API
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { chatMemories } from '$lib/server/db/schema.js';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	try {
		// 簡單查詢測試資料庫連線
		const result = await db
			.select({ count: sql<number>`count(*)` })
			.from(chatMemories);

		return json({
			status: 'healthy',
			service: 'Memory API (Layer 1)',
			database: 'PostgreSQL',
			port: 5173, // SvelteKit app port
			endpoint: '/api/memory',
			totalMemories: Number(result[0]?.count || 0),
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		return json({
			status: 'unhealthy',
			service: 'Memory API (Layer 1)',
			error: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString()
		}, { status: 500 });
	}
};
