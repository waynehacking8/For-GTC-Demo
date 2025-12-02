import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { characterPresets } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';

// GET - Get a single character preset
export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const [preset] = await db
			.select()
			.from(characterPresets)
			.where(and(
				eq(characterPresets.id, params.id),
				eq(characterPresets.userId, session.user.id)
			));

		if (!preset) {
			return json({ error: 'Preset not found' }, { status: 404 });
		}

		return json({ preset });
	} catch (error) {
		console.error('Get character preset error:', error);
		return json({ error: 'Failed to fetch character preset' }, { status: 500 });
	}
};

// PUT - Update a character preset
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { name, systemPrompt, description, isDefault } = await request.json();

		// Verify ownership
		const [existing] = await db
			.select()
			.from(characterPresets)
			.where(and(
				eq(characterPresets.id, params.id),
				eq(characterPresets.userId, session.user.id)
			));

		if (!existing) {
			return json({ error: 'Preset not found' }, { status: 404 });
		}

		// If setting as default, unset others first
		if (isDefault && !existing.isDefault) {
			await db
				.update(characterPresets)
				.set({ isDefault: false, updatedAt: new Date() })
				.where(and(
					eq(characterPresets.userId, session.user.id),
					eq(characterPresets.isDefault, true)
				));
		}

		const [updatedPreset] = await db
			.update(characterPresets)
			.set({
				name: name ?? existing.name,
				systemPrompt: systemPrompt ?? existing.systemPrompt,
				description: description !== undefined ? description : existing.description,
				isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
				updatedAt: new Date()
			})
			.where(eq(characterPresets.id, params.id))
			.returning();

		return json({ preset: updatedPreset });
	} catch (error) {
		console.error('Update character preset error:', error);
		return json({ error: 'Failed to update character preset' }, { status: 500 });
	}
};

// DELETE - Delete a character preset
export const DELETE: RequestHandler = async ({ params, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Verify ownership
		const [existing] = await db
			.select()
			.from(characterPresets)
			.where(and(
				eq(characterPresets.id, params.id),
				eq(characterPresets.userId, session.user.id)
			));

		if (!existing) {
			return json({ error: 'Preset not found' }, { status: 404 });
		}

		await db
			.delete(characterPresets)
			.where(eq(characterPresets.id, params.id));

		return json({ success: true });
	} catch (error) {
		console.error('Delete character preset error:', error);
		return json({ error: 'Failed to delete character preset' }, { status: 500 });
	}
};
