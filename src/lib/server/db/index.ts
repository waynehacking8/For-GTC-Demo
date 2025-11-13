import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { env } from "$env/dynamic/private"

// Use SvelteKit's dynamic environment variables for runtime
const connectionString = env.DATABASE_URL || process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/drizzle"

const pool = postgres(connectionString)

export const db = drizzle(pool)

// Re-export everything from schema for convenience
export * from "./schema.js"