import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { images, videos, chats } from '$lib/server/db/schema.js';
import { eq, desc, or, isNull } from 'drizzle-orm';
import { storageService } from '$lib/server/storage.js';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Get query parameters for filtering
		const searchParams = url.searchParams;
		const type = searchParams.get('type'); // 'images', 'videos', or null for both

		// Fetch user's images with optional chat context
		let userImages: any[] = [];
		if (!type || type === 'images') {
			const rawImages = await db
				.select({
					id: images.id,
					filename: images.filename,
					mimeType: images.mimeType,
					fileSize: images.fileSize,
					storageLocation: images.storageLocation,
					cloudPath: images.cloudPath,
					createdAt: images.createdAt,
					chatId: images.chatId,
					chatTitle: chats.title,
					chatModel: chats.model,
				})
				.from(images)
				.leftJoin(chats, eq(images.chatId, chats.id))
				.where(eq(images.userId, session.user.id))
				.orderBy(desc(images.createdAt));

			// Generate URLs for each image based on storage location
			const imagesWithUrls = await Promise.all(
				rawImages.map(async (img) => {
					let imageUrl: string;

					// For R2 storage, generate presigned URL
					if (img.storageLocation === 'r2' && img.cloudPath) {
						// Let initialization errors propagate instead of silently falling back
						imageUrl = await storageService.getUrl(img.cloudPath);
					} else {
						// For local storage, use API endpoint
						imageUrl = `/api/images/${img.id}`;
					}

					return {
						...img,
						type: 'image' as const,
						url: imageUrl
					};
				})
			);

			userImages = imagesWithUrls;
		}

		// Fetch user's videos with optional chat context
		let userVideos: any[] = [];
		if (!type || type === 'videos') {
			const rawVideos = await db
				.select({
					id: videos.id,
					filename: videos.filename,
					mimeType: videos.mimeType,
					fileSize: videos.fileSize,
					duration: videos.duration,
					resolution: videos.resolution,
					fps: videos.fps,
					hasAudio: videos.hasAudio,
					storageLocation: videos.storageLocation,
					cloudPath: videos.cloudPath,
					createdAt: videos.createdAt,
					chatId: videos.chatId,
					chatTitle: chats.title,
					chatModel: chats.model,
				})
				.from(videos)
				.leftJoin(chats, eq(videos.chatId, chats.id))
				.where(eq(videos.userId, session.user.id))
				.orderBy(desc(videos.createdAt));

			// Generate URLs for each video based on storage location
			const videosWithUrls = await Promise.all(
				rawVideos.map(async (vid) => {
					let videoUrl: string;

					// For R2 storage, generate presigned URL
					if (vid.storageLocation === 'r2' && vid.cloudPath) {
						// Let initialization errors propagate instead of silently falling back
						videoUrl = await storageService.getUrl(vid.cloudPath);
					} else {
						// For local storage, use API endpoint
						videoUrl = `/api/videos/${vid.id}`;
					}

					return {
						...vid,
						type: 'video' as const,
						url: videoUrl
					};
				})
			);

			userVideos = videosWithUrls;
		}

		// Combine and sort by creation date
		const allMedia = [...userImages, ...userVideos]
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

		return json({
			media: allMedia,
			total: allMedia.length,
			images: userImages.length,
			videos: userVideos.length
		});
	} catch (error) {
		console.error('Get library error:', error);
		return json({ error: 'Failed to fetch library' }, { status: 500 });
	}
};