/**
 * POST /api/memory/detect - 偵測並即時套用記憶更新
 *
 * 從用戶訊息中偵測記憶更新模式，並自動套用到資料庫
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { detectMemoryUpdates, applyMemoryUpdates } from '$lib/server/knowledge.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { userId, message, apply = true } = body;

		if (!userId || !message) {
			return json({
				error: 'userId and message are required'
			}, { status: 400 });
		}

		// 偵測更新
		const detected = detectMemoryUpdates(message);

		if (detected.length === 0) {
			return json({
				success: true,
				message: 'No memory updates detected',
				detected: [],
				applied: []
			});
		}

		// 可選擇是否自動套用
		let applied: string[] = [];
		if (apply) {
			applied = await applyMemoryUpdates(userId, detected);
		}

		return json({
			success: true,
			message: `Detected ${detected.length} memory update(s)`,
			detected: detected.map(d => ({
				key: d.key,
				value: d.value,
				pattern: d.pattern
			})),
			applied
		});

	} catch (error) {
		console.error('[Memory API] Detect error:', error);
		return json({
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
