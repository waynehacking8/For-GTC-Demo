import {
	boolean,
	timestamp,
	pgTable,
	text,
	unique,
	primaryKey,
	integer,
	json,
	index,
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "@auth/core/adapters"
import { randomUUID } from 'crypto';

// Note: db is exported from index.ts to avoid SvelteKit env issues with drizzle-kit

export const users = pgTable("user", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	name: text("name"),
	email: text("email").unique(),
	emailVerified: timestamp("emailVerified", { mode: "date" }),
	password: text('password'),
	image: text("image"),
	isAdmin: boolean("isAdmin").notNull().default(false),
	stripeCustomerId: text("stripeCustomerId"),
	subscriptionStatus: text("subscriptionStatus", { 
		enum: ["active", "canceled", "incomplete", "incomplete_expired", "past_due", "trialing", "unpaid"] 
	}).default("incomplete"),
	planTier: text("planTier", { 
		enum: ["free", "starter", "pro", "advanced"] 
	}).default("free"),
	marketingConsent: boolean("marketingConsent").notNull().default(false),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
})

export const accounts = pgTable(
	"account",
	{
		userId: text("userId")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: text("type").$type<AdapterAccountType>().notNull(),
		provider: text("provider").notNull(),
		providerAccountId: text("providerAccountId").notNull(),
		refresh_token: text("refresh_token"),
		access_token: text("access_token"),
		expires_at: integer("expires_at"),
		token_type: text("token_type"),
		scope: text("scope"),
		id_token: text("id_token"),
		session_state: text("session_state"),
	},
	(account) => [
		{
			compoundKey: primaryKey({
				columns: [account.provider, account.providerAccountId],
			}),
		},
	]
)

export const sessions = pgTable("session", {
	sessionToken: text("sessionToken").primaryKey(),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable(
	"verificationToken",
	{
		identifier: text("identifier").notNull(),
		token: text("token").notNull(),
		expires: timestamp("expires", { mode: "date" }).notNull(),
	},
	(verificationToken) => [
		{
			compositePk: primaryKey({
				columns: [verificationToken.identifier, verificationToken.token],
			}),
		},
	]
)

export const passwordResetTokens = pgTable(
	"passwordResetToken",
	{
		identifier: text("identifier").notNull(),
		token: text("token").notNull(),
		expires: timestamp("expires", { mode: "date" }).notNull(),
		createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	},
	(passwordResetToken) => [
		{
			compositePk: primaryKey({
				columns: [passwordResetToken.identifier, passwordResetToken.token],
			}),
		},
	]
)

export const authenticators = pgTable(
	"authenticator",
	{
		credentialID: text("credentialID").notNull().unique(),
		userId: text("userId")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		providerAccountId: text("providerAccountId").notNull(),
		credentialPublicKey: text("credentialPublicKey").notNull(),
		counter: integer("counter").notNull(),
		credentialDeviceType: text("credentialDeviceType").notNull(),
		credentialBackedUp: boolean("credentialBackedUp").notNull(),
		transports: text("transports"),
	},
	(authenticator) => [
		{
			compositePK: primaryKey({
				columns: [authenticator.userId, authenticator.credentialID],
			}),
		},
	]
)

export const images = pgTable("image", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	filename: text("filename").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	chatId: text("chatId"), // Optional - images may not always be associated with a specific chat
	mimeType: text("mimeType").notNull(),
	fileSize: integer("fileSize").notNull(),
	storageLocation: text("storageLocation").notNull().default("local"), // 'local' | 'r2'
	cloudPath: text("cloudPath"), // Path/key for cloud storage (null for local files)
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	// Composite index for library queries (order by createdAt DESC for user)
	// Reduces query time on Neon serverless from 100-200ms to 10-50ms
	index('images_user_created_idx').on(table.userId, table.createdAt),
	// Index for filtering by storage location (R2 vs local)
	index('images_storage_location_idx').on(table.storageLocation),
])

export const videos = pgTable("video", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	filename: text("filename").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	chatId: text("chatId"), // Optional - videos may not always be associated with a specific chat
	mimeType: text("mimeType").notNull(),
	fileSize: integer("fileSize").notNull(),
	duration: integer("duration"), // Video duration in seconds (8 for Veo 3)
	resolution: text("resolution"), // e.g., "720p"
	fps: integer("fps"), // Frames per second (24 for Veo 3)
	hasAudio: boolean("hasAudio").notNull().default(true), // Veo 3 generates audio natively
	storageLocation: text("storageLocation").notNull().default("local"), // 'local' | 'r2'
	cloudPath: text("cloudPath"), // Path/key for cloud storage (null for local files)
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	// Composite index for library queries (order by createdAt DESC for user)
	// Reduces query time on Neon serverless from 100-200ms to 10-50ms
	index('videos_user_created_idx').on(table.userId, table.createdAt),
	// Index for filtering by storage location (R2 vs local)
	index('videos_storage_location_idx').on(table.storageLocation),
])

export const chats = pgTable("chat", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	model: text("model").notNull(),
	messages: json("messages").$type<Array<{
		role: 'user' | 'assistant' | 'system';
		content: string;
		model?: string;
		imageId?: string; // Reference to images table
		imageUrl?: string; // Deprecated, for backwards compatibility
		imageData?: string; // Deprecated, for backwards compatibility
		videoId?: string; // Reference to videos table
		mimeType?: string;
		type?: 'text' | 'image' | 'video';
	}>>().notNull().default([]),
	systemPrompt: text("systemPrompt"), // Custom system prompt for personalized agent
	pinned: boolean("pinned").notNull().default(false),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
})

export const pricingPlans = pgTable("pricing_plan", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	name: text("name").notNull(),
	tier: text("tier", { 
		enum: ["free", "starter", "pro", "advanced"] 
	}).notNull(),
	stripePriceId: text("stripePriceId").notNull().unique(),
	priceAmount: integer("priceAmount").notNull(), // Price in cents
	currency: text("currency").notNull().default("usd"),
	billingInterval: text("billingInterval", { 
		enum: ["month", "year"] 
	}).notNull().default("month"),
	textGenerationLimit: integer("textGenerationLimit"), // null = unlimited
	imageGenerationLimit: integer("imageGenerationLimit"), // null = unlimited
	videoGenerationLimit: integer("videoGenerationLimit"), // null = unlimited
	features: json("features").$type<string[]>().notNull().default([]),
	isActive: boolean("isActive").notNull().default(true),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
})

export const subscriptions = pgTable("subscription", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	stripeSubscriptionId: text("stripeSubscriptionId").notNull().unique(),
	stripePriceId: text("stripePriceId").notNull(),
	planTier: text("planTier", { 
		enum: ["free", "starter", "pro", "advanced"] 
	}).notNull(),
	previousPlanTier: text("previousPlanTier", { 
		enum: ["free", "starter", "pro", "advanced"] 
	}), // Track previous plan for plan change analytics
	status: text("status", { 
		enum: ["active", "canceled", "incomplete", "incomplete_expired", "past_due", "trialing", "unpaid"] 
	}).notNull(),
	currentPeriodStart: timestamp("currentPeriodStart", { mode: "date" }).notNull(),
	currentPeriodEnd: timestamp("currentPeriodEnd", { mode: "date" }).notNull(),
	cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
	canceledAt: timestamp("canceledAt", { mode: "date" }),
	endedAt: timestamp("endedAt", { mode: "date" }),
	planChangedAt: timestamp("planChangedAt", { mode: "date" }), // Track when plan was last changed
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
})

export const usageTracking = pgTable("usage_tracking", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	month: integer("month").notNull(), // 1-12
	year: integer("year").notNull(),
	textGenerationCount: integer("textGenerationCount").notNull().default(0),
	imageGenerationCount: integer("imageGenerationCount").notNull().default(0),
	videoGenerationCount: integer("videoGenerationCount").notNull().default(0),
	lastResetAt: timestamp("lastResetAt", { mode: "date" }).notNull().defaultNow(),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	unique('user_month_year_unique').on(table.userId, table.month, table.year),
])

export const paymentHistory = pgTable("payment_history", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.references(() => users.id, { onDelete: "set null" }), // Keep payment records for audit/legal purposes
	stripePaymentIntentId: text("stripePaymentIntentId"),
	stripeInvoiceId: text("stripeInvoiceId"),
	subscriptionId: text("subscriptionId")
		.references(() => subscriptions.id, { onDelete: "set null" }),
	amount: integer("amount").notNull(), // Amount in cents
	currency: text("currency").notNull().default("usd"),
	status: text("status", { 
		enum: ["succeeded", "pending", "failed", "canceled", "refunded"] 
	}).notNull(),
	description: text("description"),
	paymentMethodType: text("paymentMethodType"), // card, bank_transfer, etc.
	last4: text("last4"), // Last 4 digits of payment method
	brand: text("brand"), // visa, mastercard, etc.
	paidAt: timestamp("paidAt", { mode: "date" }),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
})

export const adminSettings = pgTable("admin_settings", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	key: text("key").notNull().unique(), // Setting key (e.g., 'site_name', 'stripe_public_key')
	value: text("value"), // Setting value (JSON for complex values)
	category: text("category").notNull(), // 'general', 'branding', 'payment', 'oauth'
	encrypted: boolean("encrypted").notNull().default(false), // Whether value is encrypted
	description: text("description"), // Human-readable description
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	index('admin_settings_category_idx').on(table.category),
])

export const adminFiles = pgTable("admin_files", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	filename: text("filename").notNull(),
	originalName: text("originalName").notNull(),
	mimeType: text("mimeType").notNull(),
	size: integer("size").notNull(), // File size in bytes
	category: text("category").notNull(), // 'logo', 'favicon', etc.
	path: text("path").notNull(), // File storage path
	url: text("url"), // Public URL if applicable
	storageLocation: text("storage_location").notNull().default('local'), // 'local' or 'r2'
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	index('admin_files_category_idx').on(table.category),
])
// Memory Management Tables for LangChain Integration
export const chatMemories = pgTable("chat_memory", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	chatId: text("chatId"), // Optional - can be session-specific or global
	memoryType: text("memoryType", {
		enum: ["short_term", "long_term", "summary", "entity"]
	}).notNull().default("short_term"),
	key: text("key").notNull(), // Memory identifier (e.g., "user_preferences", "conversation_summary")
	value: json("value").notNull(), // Flexible JSON storage for memory content
	metadata: json("metadata").$type<{
		importance?: number; // 1-10 scale for memory importance
		lastAccessed?: string;
		accessCount?: number;
		tags?: string[];
	}>(),
	expiresAt: timestamp("expiresAt", { mode: "date" }), // Optional expiration for short-term memories
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	// Index for fast user + chat lookups
	index('chat_memory_user_chat_idx').on(table.userId, table.chatId),
	// Index for memory type filtering
	index('chat_memory_type_idx').on(table.memoryType),
	// Index for key lookups
	index('chat_memory_key_idx').on(table.key),
])

// Character Presets - User-defined AI character/persona templates
export const characterPresets = pgTable("character_preset", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	name: text("name").notNull(), // e.g., "貓娘", "傲嬌助手", "專業顧問"
	systemPrompt: text("systemPrompt").notNull(), // The actual character prompt
	description: text("description"), // Optional short description
	isDefault: boolean("isDefault").notNull().default(false), // User's default character
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	index('character_preset_user_idx').on(table.userId),
])

// Entity Memory - Track important entities (people, places, concepts) mentioned in conversations
export const entityMemories = pgTable("entity_memory", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => randomUUID()),
	userId: text("userId")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	entityName: text("entityName").notNull(), // e.g., "John", "Paris", "Python"
	entityType: text("entityType", {
		enum: ["person", "place", "organization", "concept", "other"]
	}).notNull(),
	description: text("description"), // What we know about this entity
	facts: json("facts").$type<Array<{
		fact: string;
		source?: string; // Which chat/message this came from
		confidence?: number;
		timestamp?: string;
	}>>().notNull().default([]),
	relations: json("relations").$type<Array<{
		relatedEntity: string;
		relationType: string; // "works_at", "located_in", "friend_of", etc.
	}>>().default([]),
	mentionCount: integer("mentionCount").notNull().default(1),
	lastMentioned: timestamp("lastMentioned", { mode: "date" }).notNull().defaultNow(),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	// Composite index for entity lookups
	index('entity_memory_user_name_idx').on(table.userId, table.entityName),
	// Index for entity type filtering
	index('entity_memory_type_idx').on(table.entityType),
])
