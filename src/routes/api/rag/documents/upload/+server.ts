import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// LightRAG API configuration
const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL || 'http://172.19.0.1:8020';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const files = formData.getAll('files');

		if (!files || files.length === 0) {
			return json({ error: 'No files provided' }, { status: 400 });
		}

		// Check if all files are valid
		for (const file of files) {
			if (!(file instanceof File)) {
				return json({ error: 'Invalid file data' }, { status: 400 });
			}

			// Check file type
			if (!file.name.toLowerCase().endsWith('.pdf')) {
				return json({
					error: `File ${file.name} is not a PDF. Only PDF files are supported.`
				}, { status: 400 });
			}
		}

		console.log(`[RAG Upload] Uploading ${files.length} file(s)`);

		// Determine endpoint based on number of files
		const endpoint = files.length === 1 ? '/documents/upload' : '/documents/batch-upload';

		// Create FormData for LightRAG API
		const lightragFormData = new FormData();

		if (files.length === 1) {
			// Single file upload
			lightragFormData.append('file', files[0]);
		} else {
			// Batch upload
			files.forEach((file) => {
				lightragFormData.append('files', file);
			});
		}

		// Build URL with process_now=true to get OCR content immediately
		// This allows LLM to respond with the extracted content
		const url = new URL(`${LIGHTRAG_API_URL}${endpoint}`);
		url.searchParams.append('process_now', 'true');

		// Forward to LightRAG API with timeout
		// Increased timeout to account for vLLM startup (30-40s) + PDF parsing (30-100s)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 second timeout

		try {
			const response = await fetch(url.toString(), {
				method: 'POST',
				body: lightragFormData,
				signal: controller.signal
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
				console.error('[RAG Upload] Error:', errorData);
				return json(
					{ error: errorData.error || `LightRAG API error: ${response.statusText}` },
					{ status: response.status }
				);
			}

			const data = await response.json();
			console.log(`[RAG Upload] Success:`, data);

			return json(data);
		} catch (fetchError) {
			clearTimeout(timeoutId);
			if (fetchError instanceof Error && fetchError.name === 'AbortError') {
				console.error('[RAG Upload] Request timeout');
				return json(
					{ error: 'Upload timeout - file is being processed in background' },
					{ status: 408 }
				);
			}
			throw fetchError;
		}
	} catch (error) {
		console.error('[RAG Upload] Exception:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};
