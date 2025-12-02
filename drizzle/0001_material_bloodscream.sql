CREATE TABLE "chat_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"chatId" text,
	"memoryType" text DEFAULT 'short_term' NOT NULL,
	"key" text NOT NULL,
	"value" json NOT NULL,
	"metadata" json,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"entityName" text NOT NULL,
	"entityType" text NOT NULL,
	"description" text,
	"facts" json DEFAULT '[]'::json NOT NULL,
	"relations" json DEFAULT '[]'::json,
	"mentionCount" integer DEFAULT 1 NOT NULL,
	"lastMentioned" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_memory" ADD CONSTRAINT "chat_memory_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_memory" ADD CONSTRAINT "entity_memory_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_memory_user_chat_idx" ON "chat_memory" USING btree ("userId","chatId");--> statement-breakpoint
CREATE INDEX "chat_memory_type_idx" ON "chat_memory" USING btree ("memoryType");--> statement-breakpoint
CREATE INDEX "chat_memory_key_idx" ON "chat_memory" USING btree ("key");--> statement-breakpoint
CREATE INDEX "entity_memory_user_name_idx" ON "entity_memory" USING btree ("userId","entityName");--> statement-breakpoint
CREATE INDEX "entity_memory_type_idx" ON "entity_memory" USING btree ("entityType");