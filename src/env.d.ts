declare module '$env/static/private' {
  export const DATABASE_URL: string;
  export const AUTH_SECRET: string;
  export const AUTH_GOOGLE_ID: string | undefined;
  export const AUTH_GOOGLE_SECRET: string | undefined;
  export const AUTH_APPLE_ID: string | undefined;
  export const AUTH_APPLE_SECRET: string | undefined;
  export const AUTH_TWITTER_ID: string | undefined;
  export const AUTH_TWITTER_SECRET: string | undefined;
  export const AUTH_FACEBOOK_ID: string | undefined;
  export const AUTH_FACEBOOK_SECRET: string | undefined;
  export const PUBLIC_STRIPE_PUBLISHABLE_KEY: string | undefined;
  export const STRIPE_SECRET_KEY: string | undefined;
  export const STRIPE_WEBHOOK_SECRET: string | undefined;
  export const OPENROUTER_API_KEY: string | undefined;
  export const REPLICATE_API_TOKEN: string | undefined;
  export const R2_ACCOUNT_ID: string | undefined;
  export const R2_ACCESS_KEY_ID: string | undefined;
  export const R2_SECRET_ACCESS_KEY: string | undefined;
  export const R2_BUCKET_NAME: string | undefined;
  export const R2_PUBLIC_URL: string | undefined;
  export const TURNSTILE_SITE_KEY: string | undefined;
  export const TURNSTILE_SECRET_KEY: string | undefined;
}