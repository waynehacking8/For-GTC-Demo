import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { characterPresets } from '$lib/server/db/schema.js';
import { eq, desc, and } from 'drizzle-orm';

// GET - List all character presets for the user
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const presets = await db
			.select()
			.from(characterPresets)
			.where(eq(characterPresets.userId, session.user.id))
			.orderBy(desc(characterPresets.isDefault), desc(characterPresets.updatedAt));

		return json({ presets });
	} catch (error) {
		console.error('Get character presets error:', error);
		return json({ error: 'Failed to fetch character presets' }, { status: 500 });
	}
};

// POST - Create a new character preset
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { name, systemPrompt, description, isDefault } = await request.json();

		if (!name || !systemPrompt) {
			return json({ error: 'Name and systemPrompt are required' }, { status: 400 });
		}

		// If this preset is set as default, unset other defaults first
		if (isDefault) {
			await db
				.update(characterPresets)
				.set({ isDefault: false, updatedAt: new Date() })
				.where(and(
					eq(characterPresets.userId, session.user.id),
					eq(characterPresets.isDefault, true)
				));
		}

		const [newPreset] = await db
			.insert(characterPresets)
			.values({
				userId: session.user.id,
				name,
				systemPrompt,
				description: description || null,
				isDefault: isDefault || false
			})
			.returning();

		return json({ preset: newPreset });
	} catch (error) {
		console.error('Create character preset error:', error);
		return json({ error: 'Failed to create character preset' }, { status: 500 });
	}
};

// DELETE - Delete a character preset (by query param id)
export const DELETE: RequestHandler = async ({ url, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const id = url.searchParams.get('id');
		if (!id) {
			return json({ error: 'Preset ID is required' }, { status: 400 });
		}

		// Verify ownership before deleting
		const [existing] = await db
			.select()
			.from(characterPresets)
			.where(and(
				eq(characterPresets.id, id),
				eq(characterPresets.userId, session.user.id)
			));

		if (!existing) {
			return json({ error: 'Preset not found' }, { status: 404 });
		}

		await db
			.delete(characterPresets)
			.where(eq(characterPresets.id, id));

		return json({ success: true });
	} catch (error) {
		console.error('Delete character preset error:', error);
		return json({ error: 'Failed to delete character preset' }, { status: 500 });
	}
};
