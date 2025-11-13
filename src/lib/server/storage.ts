import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
// Import environment variables with fallbacks for undefined vars
import * as env from '$env/static/private';
const R2_ACCOUNT_ID = env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = env.R2_PUBLIC_URL || '';
import { getCloudStorageSettings } from './admin-settings';

export interface StorageFile {
	buffer: Buffer;
	mimeType: string;
	filename?: string;
}

export interface StorageResult {
	path: string;
	url?: string;
	storageLocation: 'local' | 'r2';
}

export interface StorageConfig {
	type: 'local' | 'r2';
	localPath?: string;
	r2Config?: {
		accountId: string;
		accessKeyId: string;
		secretAccessKey: string;
		bucketName: string;
		publicUrl?: string;
	};
}

export abstract class StorageProvider {
	abstract upload(file: StorageFile, path: string): Promise<StorageResult>;
	abstract download(path: string): Promise<Buffer>;
	abstract delete(path: string): Promise<void>;
	abstract getUrl(path: string): Promise<string>;
	abstract getPublicUrl(path: string): Promise<string>;
	abstract exists(path: string): Promise<boolean>;
}

export class LocalStorageProvider extends StorageProvider {
	private basePath: string;

	constructor(basePath: string = 'static/uploads') {
		super();
		this.basePath = basePath;
	}

	async upload(file: StorageFile, path: string): Promise<StorageResult> {
		const fullPath = join(process.cwd(), this.basePath, path);
		const dir = join(fullPath, '..');

		// Ensure directory exists
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}

		await writeFile(fullPath, file.buffer);

		return {
			path: path,
			storageLocation: 'local'
		};
	}

	async download(path: string): Promise<Buffer> {
		const fullPath = join(process.cwd(), this.basePath, path);
		
		if (!existsSync(fullPath)) {
			throw new Error(`File not found: ${path}`);
		}

		return await readFile(fullPath);
	}

	async delete(path: string): Promise<void> {
		const fullPath = join(process.cwd(), this.basePath, path);
		
		if (existsSync(fullPath)) {
			await unlink(fullPath);
		}
	}

	async getUrl(path: string): Promise<string> {
		return `/${this.basePath}/${path}`;
	}

	async getPublicUrl(path: string): Promise<string> {
		// For local storage, public and private URLs are the same
		return this.getUrl(path);
	}

	async exists(path: string): Promise<boolean> {
		const fullPath = join(process.cwd(), this.basePath, path);
		return existsSync(fullPath);
	}
}

export class R2StorageProvider extends StorageProvider {
	private client: S3Client;
	private bucketName: string;
	private publicUrl?: string;

	constructor(config: StorageConfig['r2Config']) {
		super();
		
		if (!config) {
			throw new Error('R2 configuration is required');
		}

		this.bucketName = config.bucketName;
		this.publicUrl = config.publicUrl;

		this.client = new S3Client({
			region: 'auto',
			endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey
			}
		});
	}

	async upload(file: StorageFile, path: string): Promise<StorageResult> {
		const command = new PutObjectCommand({
			Bucket: this.bucketName,
			Key: path,
			Body: file.buffer,
			ContentType: file.mimeType,
			ContentLength: file.buffer.length
		});

		await this.client.send(command);

		// Generate presigned URL for immediate access
		const url = await this.getUrl(path);

		return {
			path: path,
			url: url,
			storageLocation: 'r2'
		};
	}

	async download(path: string): Promise<Buffer> {
		const command = new GetObjectCommand({
			Bucket: this.bucketName,
			Key: path
		});

		const response = await this.client.send(command);
		
		if (!response.Body) {
			throw new Error(`File not found: ${path}`);
		}

		const chunks: Uint8Array[] = [];
		const reader = response.Body.transformToWebStream().getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}

		return Buffer.concat(chunks);
	}

	async delete(path: string): Promise<void> {
		const command = new DeleteObjectCommand({
			Bucket: this.bucketName,
			Key: path
		});

		await this.client.send(command);
	}

	async getUrl(path: string, publicAccess: boolean = false): Promise<string> {
		// For branding assets (logos, favicons), return public URLs
		if (publicAccess && this.publicUrl) {
			return `${this.publicUrl}/${path}`;
		}

		// For security, return presigned URLs for authenticated access
		const command = new GetObjectCommand({
			Bucket: this.bucketName,
			Key: path
		});

		return await getSignedUrl(this.client, command, { expiresIn: 3600 }); // 1 hour
	}

	async getPublicUrl(path: string): Promise<string> {
		// Return public URL for branding assets that don't need authentication
		if (this.publicUrl) {
			return `${this.publicUrl}/${path}`;
		}

		// Fallback to presigned URL if no public URL configured
		return await this.getUrl(path, false);
	}

	async exists(path: string): Promise<boolean> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucketName,
				Key: path
			});

			await this.client.send(command);
			return true;
		} catch (error) {
			return false;
		}
	}
}

// Helper function to validate credentials are non-empty strings
function isValidCredential(value: string | undefined): boolean {
	return !!value && value.trim().length > 0;
}

// Helper function to determine if error is retryable (transient vs permanent)
function isRetryableError(error: Error): boolean {
	const message = error.message.toLowerCase();

	// Retryable: Network/timeout issues that may succeed on retry
	const retryablePatterns = [
		'timeout',
		'econnrefused',
		'enotfound',
		'econnreset',
		'socket hang up',
		'network error',
		'rate limit',
		'too many requests',
		'service unavailable',
		'503',
		'429',
		'etimedout',
		'connection refused'
	];

	return retryablePatterns.some(pattern => message.includes(pattern));
}

class StorageService {
	private provider: StorageProvider | null = null;
	private config: StorageConfig | null = null;
	private initPromise: Promise<void> | null = null;
	private initState: 'pending' | 'initializing' | 'initialized' | 'failed' = 'pending';
	private configVersion: number = 0; // Track config version for re-initialization
	private lastInitError: Error | null = null;
	private lastInitErrorTime: number = 0;

	constructor() {
		// Don't auto-initialize - let ensureInitialized handle it to avoid race conditions
	}

	private async initialize() {
		const startTime = Date.now();

		try {
			this.config = await this.getStorageConfig();
			this.provider = this.createProvider();
			const duration = Date.now() - startTime;

			console.log(`✅ StorageService initialized: ${this.config.type} storage (${duration}ms)`);

			// Alert on slow initialization (indicates serverless cold start or Neon latency)
			if (duration > 5000) {
				console.warn(`⚠️  Slow storage initialization: ${duration}ms (possible Neon cold start or network latency)`);
			}
		} catch (error) {
			const duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`❌ StorageService initialization failed after ${duration}ms:`, errorMessage);
			throw error;
		}
	}

	private async ensureInitialized() {
		// If already initialized and provider is ready, return immediately
		if (this.initState === 'initialized' && this.provider) {
			return;
		}

		// If initialization failed previously, check if we should retry
		if (this.initState === 'failed' && this.lastInitError) {
			const timeSinceError = Date.now() - this.lastInitErrorTime;

			// Retry after 5 seconds for transient errors
			if (timeSinceError < 5000) {
				throw this.lastInitError;
			}

			// Reset state to allow retry after cooldown period
			console.log('🔄 Retrying storage initialization after cooldown period...');
			this.initState = 'pending';
			this.lastInitError = null;
		}

		// If already initializing, wait for existing promise to complete
		// This prevents multiple concurrent initialization attempts
		// Store promise reference to prevent TOCTOU race (promise could be nullified between check and await)
		const existingPromise = this.initPromise;
		if (existingPromise) {
			await existingPromise;

			// Double-check: After awaiting, verify we're actually initialized
			if (this.initState === 'initialized' && this.provider) {
				return;
			}

			// If still not initialized after promise resolved, throw error
			if (!this.provider) {
				throw new Error('StorageService initialization completed but provider is null');
			}

			return;
		}

		// Start new initialization
		this.initState = 'initializing';

		// Create promise that tracks success/failure state
		this.initPromise = this.initialize()
			.then(() => {
				this.initState = 'initialized';
				this.lastInitError = null;
				this.lastInitErrorTime = 0;

				// Delay nullifying promise to ensure all concurrent callers receive result
				// This prevents race condition where promise is nulled before all callers await it
				setTimeout(() => {
					this.initPromise = null;
				}, 100);
			})
			.catch((error) => {
				this.initState = 'failed';
				this.lastInitError = error instanceof Error ? error : new Error(String(error));
				this.lastInitErrorTime = Date.now();

				// Delay nullifying promise to ensure all concurrent callers receive error
				setTimeout(() => {
					this.initPromise = null;
				}, 100);

				throw error;
			});

		await this.initPromise;
	}

	private async getStorageConfig(): Promise<StorageConfig> {
		// 3-tier fallback logic:
		// 1. Admin dashboard settings (database, with 5-min cache)
		// 2. Environment variables (.env file)
		// 3. Local storage (fallback)

		// Check if config has changed (admin updated credentials)
		// This allows re-initialization without Lambda restart
		const { settingsStore } = await import('./settings-store.js');

		// Wait for settings store to be ready before reading version
		// This prevents reading stale version=0 during cold start
		await settingsStore.getSettings().catch((error) => {
			console.warn('⚠️  Failed to warm settings cache, will retry:', error.message);
		});

		const currentVersion = settingsStore.getConfigVersion();

		if (this.configVersion !== 0 && this.configVersion !== currentVersion) {
			console.log('🔄 Storage config version changed, triggering re-initialization...');
			this.provider = null;
			this.config = null;
		}

		this.configVersion = currentVersion;

		// Retry logic with exponential backoff for database query
		const maxRetries = 3;
		const baseDelay = 100; // ms
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// First, check admin dashboard settings (uses cached settingsStore with 5-min TTL)
				// This prevents database query timeouts on serverless platforms during cold starts
				// Extended timeout from 10s to 15s for Neon serverless cold starts
				const adminSettings = await Promise.race([
					getCloudStorageSettings(),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Settings fetch timeout (15s exceeded - Neon cold start?)')), 15000)
					)
				]);

				// Validate R2 credentials are non-empty strings, not just truthy
				// This prevents attempting to initialize R2 with empty/whitespace values
				if (
					isValidCredential(adminSettings.r2_account_id) &&
					isValidCredential(adminSettings.r2_access_key_id) &&
					isValidCredential(adminSettings.r2_secret_access_key) &&
					isValidCredential(adminSettings.r2_bucket_name)
				) {
					console.log('✅ Using R2 configuration from admin dashboard settings (cached)');
					return {
						type: 'r2',
						r2Config: {
							accountId: adminSettings.r2_account_id!,
							accessKeyId: adminSettings.r2_access_key_id!,
							secretAccessKey: adminSettings.r2_secret_access_key!,
							bucketName: adminSettings.r2_bucket_name!,
							publicUrl: adminSettings.r2_public_url || undefined
						}
					};
				}

				// Warn if partial credentials found
				const hasAnyR2Setting =
					adminSettings.r2_account_id ||
					adminSettings.r2_access_key_id ||
					adminSettings.r2_secret_access_key ||
					adminSettings.r2_bucket_name;

				if (hasAnyR2Setting) {
					console.warn('⚠️  Partial R2 credentials found in admin settings - all fields required');
				}

				// Successfully fetched settings, but no valid R2 credentials configured
				break;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if error is retryable (transient vs permanent)
				if (!isRetryableError(lastError)) {
					console.warn(`⚠️  Non-retryable error encountered, skipping remaining retries:`, lastError.message);
					break; // Exit retry loop immediately for permanent errors
				}

				if (attempt < maxRetries) {
					const delay = baseDelay * Math.pow(2, attempt - 1);
					console.warn(`⚠️  Retryable error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, error);
					await new Promise(resolve => setTimeout(resolve, delay));
				} else {
					console.error('❌ Failed to load admin settings after all retries:', error);
				}
			}
		}

		// Second, check environment variables
		if (
			R2_ACCOUNT_ID &&
			R2_ACCESS_KEY_ID &&
			R2_SECRET_ACCESS_KEY &&
			R2_BUCKET_NAME
		) {
			console.log('✅ Using R2 configuration from environment variables');
			return {
				type: 'r2',
				r2Config: {
					accountId: R2_ACCOUNT_ID,
					accessKeyId: R2_ACCESS_KEY_ID,
					secretAccessKey: R2_SECRET_ACCESS_KEY,
					bucketName: R2_BUCKET_NAME,
					publicUrl: R2_PUBLIC_URL
				}
			};
		}

		// Third, fallback to local storage
		// NOTE: This is problematic on serverless platforms (e.g., Vercel) where filesystem is read-only
		console.log('📁 Using local storage (no R2 configuration found)');
		if (lastError) {
			console.warn('⚠️  Local storage fallback may fail on serverless platforms. Last error:', lastError.message);
		}
		return {
			type: 'local',
			localPath: 'static/uploads'
		};
	}

	private createProvider(): StorageProvider {
		if (!this.config) {
			throw new Error('Storage config not initialized');
		}

		if (this.config.type === 'r2') {
			try {
				// Validate R2 configuration before initializing provider
				if (!this.config.r2Config) {
					throw new Error('R2 configuration is undefined');
				}

				const { accountId, accessKeyId, secretAccessKey, bucketName } = this.config.r2Config;

				if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
					throw new Error('Incomplete R2 configuration: missing required credentials');
				}

				// Create R2 provider
				const provider = new R2StorageProvider(this.config.r2Config);
				console.log('✅ R2 storage provider initialized successfully');
				return provider;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error('❌ Failed to initialize R2 storage provider:', errorMessage);

				// Check if running on serverless platform (Vercel)
				const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

				if (isServerless) {
					// On serverless, local storage won't work - throw error instead of silent fallback
					throw new Error(
						`R2 storage initialization failed on serverless platform. ` +
						`R2 configuration is required for Vercel/Lambda deployments. ` +
						`Original error: ${errorMessage}`
					);
				}

				// On non-serverless environments, fall back to local storage with warning
				console.warn('⚠️  Falling back to local storage. This should only happen in development.');
				return new LocalStorageProvider(this.config.localPath || 'static/uploads');
			}
		}

		return new LocalStorageProvider(this.config.localPath || 'static/uploads');
	}

	generateFilePath(userId: string, fileType: 'images' | 'videos', filename: string, category: 'generated' | 'uploaded' = 'generated'): string {
		return `${userId}/${fileType}/${category}/${filename}`;
	}

	generateBrandingPath(category: string, filename: string): string {
		switch (category) {
			case 'logo-dark':
			case 'logo-light':
				return `branding/logos/${filename}`;
			case 'favicon':
				return `branding/favicon/${filename}`;
			default:
				return `branding/${filename}`;
		}
	}

	generateFilename(originalName: string): string {
		const id = randomUUID();
		const ext = originalName.split('.').pop()?.toLowerCase() || '';
		return `${id}.${ext}`;
	}

	async upload(file: StorageFile, userId: string, fileType: 'images' | 'videos', category: 'generated' | 'uploaded' = 'generated'): Promise<StorageResult> {
		await this.ensureInitialized();

		const filename = file.filename || this.generateFilename('file');
		const path = this.generateFilePath(userId, fileType, filename, category);

		console.log(`Uploading ${fileType} to ${this.config!.type} storage: ${path}`);

		try {
			const result = await this.provider!.upload(file, path);
			return result;
		} catch (error) {
			console.error(`Storage upload failed for ${fileType}:`, error);
			throw error;
		}
	}

	async uploadBrandingFile(file: StorageFile, category: string): Promise<StorageResult & { publicUrl?: string }> {
		await this.ensureInitialized();

		const filename = file.filename || this.generateFilename('branding');
		const path = this.generateBrandingPath(category, filename);

		console.log(`Uploading branding file (${category}) to ${this.config!.type} storage: ${path}`);

		try {
			const result = await this.provider!.upload(file, path);

			// For branding files, also get the public URL
			const publicUrl = await this.provider!.getPublicUrl(path);

			return {
				...result,
				publicUrl
			};
		} catch (error) {
			console.error(`Branding file upload failed for ${category}:`, error);
			throw error;
		}
	}

	async download(path: string): Promise<Buffer> {
		await this.ensureInitialized();
		return await this.provider!.download(path);
	}

	async delete(path: string): Promise<void> {
		await this.ensureInitialized();
		return await this.provider!.delete(path);
	}

	async getUrl(path: string): Promise<string> {
		await this.ensureInitialized();

		// Add retry logic similar to upload operations
		const maxRetries = 3;
		const baseDelay = 100; // ms
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await this.provider!.getUrl(path);
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if error is retryable
				if (!isRetryableError(lastError)) {
					console.warn(`Non-retryable error in getUrl for ${path}, throwing immediately:`, lastError.message);
					throw lastError;
				}

				if (attempt < maxRetries) {
					const delay = baseDelay * Math.pow(2, attempt - 1);
					console.warn(`Retryable error in getUrl for ${path} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, lastError.message);
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		// If we exhausted all retries, throw the last error
		console.error(`Failed to get URL for ${path} after ${maxRetries} attempts`);
		throw lastError || new Error('Failed to get URL after retries');
	}

	async getPublicUrl(path: string): Promise<string> {
		await this.ensureInitialized();
		return await this.provider!.getPublicUrl(path);
	}

	async exists(path: string): Promise<boolean> {
		await this.ensureInitialized();
		return await this.provider!.exists(path);
	}

	async getStorageType(): Promise<'local' | 'r2'> {
		await this.ensureInitialized();
		return this.config!.type;
	}

	// Migration helper for moving from local to R2
	async migrateFile(localPath: string, userId: string, fileType: 'images' | 'videos', filename: string, mimeType: string): Promise<StorageResult | null> {
		await this.ensureInitialized();
		
		if (this.config!.type !== 'r2') {
			return null;
		}

		const localProvider = new LocalStorageProvider();
		
		try {
			if (await localProvider.exists(localPath)) {
				const buffer = await localProvider.download(localPath);
				const result = await this.upload({ buffer, mimeType, filename }, userId, fileType);
				
				// Optionally delete local file after successful migration
				// await localProvider.delete(localPath);
				
				return result;
			}
		} catch (error) {
			console.error('Migration failed:', error);
			return null;
		}

		return null;
	}
}

// Export singleton instance
export const storageService = new StorageService();