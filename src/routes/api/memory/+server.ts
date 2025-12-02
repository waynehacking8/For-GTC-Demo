/**
 * Layer 1: Personal Memory HTTP API
 *
 * Endpoints:
 * - GET /api/memory?userId=xxx - 取得用戶記憶
 * - POST /api/memory - 新增/更新記憶
 * - DELETE /api/memory - 刪除記憶
 * - POST /api/memory/query - 查詢記憶
 * - POST /api/memory/search - 搜尋記憶
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	searchPersonalMemory,
	getUserProfile,
	saveUserMemory,
	detectMemoryUpdates,
	applyMemoryUpdates
} from '$lib/server/knowledge.js';
import { db } from '$lib/server/db/index.js';
import { chatMemories } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/memory - 取得用戶的所有記憶或特定記憶
 */
export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get('userId');
	const key = url.searchParams.get('key');
	const type = url.searchParams.get('type'); // 'profile' | 'all' | specific memoryType

	if (!userId) {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	try {
		// 取得用戶 profile
		if (type === 'profile') {
			const profile = await getUserProfile(userId);
			return json({
				success: true,
				data: profile,
				count: Object.keys(profile).length
			});
		}

		// 取得特定 key 的記憶
		if (key) {
			const memories = await db
				.select()
				.from(chatMemories)
				.where(
					and(
						eq(chatMemories.userId, userId),
						eq(chatMemories.key, key)
					)
				);

			return json({
				success: true,
				data: memories.length > 0 ? memories[0] : null
			});
		}

		// 取得所有記憶
		const conditions = [eq(chatMemories.userId, userId)];

		if (type && type !== 'all') {
			conditions.push(eq(chatMemories.memoryType, type));
		}

		const memories = await db
			.select()
			.from(chatMemories)
			.where(and(...conditions));

		return json({
			success: true,
			data: memories,
			count: memories.length
		});

	} catch (error) {
		console.error('[Memory API] GET error:', error);
		return json({
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};

/**
 * POST /api/memory - 新增或更新記憶
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { userId, key, value, memoryType = 'long_term' } = body;

		if (!userId || !key || value === undefined) {
			return json({
				error: 'userId, key, and value are required'
			}, { status: 400 });
		}

		await saveUserMemory(userId, key, value, memoryType);

		return json({
			success: true,
			message: `Memory "${key}" saved successfully`,
			data: { userId, key, value, memoryType }
		});

	} catch (error) {
		console.error('[Memory API] POST error:', error);
		return json({
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};

/**
 * DELETE /api/memory - 刪除記憶
 */
export const DELETE: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get('userId');
	const key = url.searchParams.get('key');
	const id = url.searchParams.get('id');

	if (!userId) {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	try {
		if (id) {
			// 用 ID 刪除
			await db
				.delete(chatMemories)
				.where(
					and(
						eq(chatMemories.userId, userId),
						eq(chatMemories.id, id)
					)
				);
		} else if (key) {
			// 用 key 刪除
			await db
				.delete(chatMemories)
				.where(
					and(
						eq(chatMemories.userId, userId),
						eq(chatMemories.key, key)
					)
				);
		} else {
			return json({
				error: 'Either key or id is required'
			}, { status: 400 });
		}

		return json({
			success: true,
			message: `Memory deleted successfully`
		});

	} catch (error) {
		console.error('[Memory API] DELETE error:', error);
		return json({
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
