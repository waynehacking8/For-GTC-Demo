import { adminSettingsService } from './admin-settings';
import { getCurrentBrandingFile } from './file-upload';

// Define the structure of cached settings
export interface CachedSettings {
  // General settings
  siteName: string;
  siteTitle: string;
  siteDescription: string;
  defaultLanguage: string;
  defaultTheme: string;

  // Payment settings
  paymentEnvironment: string;
  stripePublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;

  // OAuth settings
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  appleEnabled: boolean;
  appleClientId: string;
  appleClientSecret: string;
  twitterEnabled: boolean;
  twitterClientId: string;
  twitterClientSecret: string;
  facebookEnabled: boolean;
  facebookClientId: string;
  facebookClientSecret: string;

  // AI Model settings
  openrouterApiKey: string;
  replicateApiKey: string;
  openaiApiKey: string;

  // Cloud Storage settings
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2PublicUrl: string;

  // Security settings
  turnstileSiteKey: string;
  turnstileSecretKey: string;

  // Branding settings
  logoUrlDark: string;
  logoUrlLight: string;
  logoWidth: string;
  logoHeight: string;
  currentFavicon: string | null;

  // Metadata
  lastUpdated: Date;
  isFallback?: boolean; // Indicates if these are default/fallback settings due to database error
}

// Default fallback values
const DEFAULT_SETTINGS: Omit<CachedSettings, 'lastUpdated'> = {
  siteName: "AI Chat Interface",
  siteTitle: "AI Chat Interface - 65+ Models",
  siteDescription: "A unified web application for interacting with 65+ AI models from 9 different providers through a single, intuitive interface.",
  defaultLanguage: "en",
  defaultTheme: "dark",
  paymentEnvironment: "test",
  stripePublishableKey: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  googleEnabled: true,
  googleClientId: "",
  googleClientSecret: "",
  appleEnabled: true,
  appleClientId: "",
  appleClientSecret: "",
  twitterEnabled: true,
  twitterClientId: "",
  twitterClientSecret: "",
  facebookEnabled: true,
  facebookClientId: "",
  facebookClientSecret: "",
  openrouterApiKey: "",
  replicateApiKey: "",
  openaiApiKey: "",
  r2AccountId: "",
  r2AccessKeyId: "",
  r2SecretAccessKey: "",
  r2BucketName: "",
  r2PublicUrl: "",
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  logoUrlDark: "/branding/logos/default-dark-logo.png", // Default fallback for dark mode
  logoUrlLight: "/branding/logos/default-light-logo.png", // Default fallback for light mode
  logoWidth: "170", // Default logo width in pixels
  logoHeight: "27", // Default logo height in pixels
  currentFavicon: null // Default no custom favicon
};

class SettingsStore {
  private cache: CachedSettings | null = null;
  private initPromise: Promise<CachedSettings> | null = null;
  private lastFetch: number = 0;
  private configVersion: number = 0; // Track config changes for invalidation
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

  /**
   * Get all settings, using cache if available and fresh
   * Implements stale-while-revalidate pattern to prevent cache stampede
   * Uses double-check locking to prevent race conditions during serverless cold starts
   */
  async getSettings(): Promise<CachedSettings> {
    const now = Date.now();
    const cacheAge = now - this.lastFetch;

    // Fresh cache - return immediately
    if (this.cache && cacheAge < this.CACHE_TTL) {
      return this.cache;
    }

    // Stale cache exists - return it immediately and refresh in background
    // This prevents cache stampede on TTL expiry under high concurrent load
    if (this.cache && cacheAge >= this.CACHE_TTL) {
      // Trigger background refresh only if not already refreshing
      if (!this.initPromise) {
        this.initPromise = this.refreshCache()
          .then(() => {
            // Delay nullifying promise to ensure all concurrent callers receive result
            // This prevents race condition where promise is nulled before all callers await it
            setTimeout(() => {
              this.initPromise = null;
            }, 100);
            return this.cache || this.createDefaultSettings();
          })
          .catch((error) => {
            setTimeout(() => {
              this.initPromise = null;
            }, 100);
            console.error('Background cache refresh failed:', error);
            return this.cache || this.createDefaultSettings();
          });
      }
      // Return stale cache immediately without waiting
      return this.cache;
    }

    // No cache at all - must wait for first load (Lambda cold start)
    // CRITICAL PATH: Double-check locking to prevent multiple concurrent DB queries
    // Store promise reference to prevent TOCTOU race (promise could be nullified between check and await)
    let existingPromise = this.initPromise;
    if (existingPromise) {
      // Wait for existing promise
      await existingPromise;

      // Double-check: Promise might have resolved, verify cache is populated
      if (this.cache) {
        return this.cache;
      }

      // If cache still empty after promise resolved, something went wrong
      console.warn('⚠️  Settings promise resolved but cache is still empty, using defaults');
      return this.createDefaultSettings();
    }

    // Create new initialization promise (only if no promise exists)
    // Use double-check locking: verify again that no promise was created between check and creation
    if (!this.initPromise) {
      this.initPromise = this.refreshCache()
        .then(() => {
          // Delay nullifying promise to ensure all concurrent callers receive result
          // Critical for serverless where 5-10 concurrent requests may arrive during cold start
          setTimeout(() => {
            this.initPromise = null;
          }, 100);
          return this.cache || this.createDefaultSettings();
        })
        .catch((error) => {
          setTimeout(() => {
            this.initPromise = null;
          }, 100);
          console.error('Settings cache refresh failed:', error);
          return this.cache || this.createDefaultSettings();
        });
    }

    // Store reference to newly created promise to prevent TOCTOU race
    existingPromise = this.initPromise;
    return await existingPromise;
  }

  /**
   * Get a specific setting value
   */
  async getSetting<K extends keyof Omit<CachedSettings, 'lastUpdated'>>(
    key: K
  ): Promise<CachedSettings[K]> {
    const settings = await this.getSettings();
    return settings[key];
  }

  /**
   * Force refresh the cache from database
   */
  async refreshCache(): Promise<void> {
    try {
      console.log('Refreshing settings cache from database...');

      // Load general, payment, oauth, ai model, cloud storage, security, branding settings, and branding files from database
      const [generalSettings, paymentSettings, oauthSettings, aiModelSettings, cloudStorageSettings, securitySettings, brandingSettings, brandingDarkFile, brandingLightFile, faviconFile] = await Promise.all([
        adminSettingsService.getSettingsByCategory('general'),
        adminSettingsService.getSettingsByCategory('payment'),
        adminSettingsService.getSettingsByCategory('oauth'),
        adminSettingsService.getSettingsByCategory('ai_models'),
        adminSettingsService.getSettingsByCategory('cloud_storage'),
        adminSettingsService.getSettingsByCategory('security'),
        adminSettingsService.getSettingsByCategory('branding'),
        getCurrentBrandingFile('logo-dark'),
        getCurrentBrandingFile('logo-light'),
        getCurrentBrandingFile('favicon')
      ]);

      // Transform database settings to our cached format
      this.cache = {
        siteName: generalSettings.site_name || DEFAULT_SETTINGS.siteName,
        siteTitle: generalSettings.site_title || DEFAULT_SETTINGS.siteTitle,
        siteDescription: generalSettings.site_description || DEFAULT_SETTINGS.siteDescription,
        defaultLanguage: generalSettings.default_language || DEFAULT_SETTINGS.defaultLanguage,
        defaultTheme: generalSettings.default_theme || DEFAULT_SETTINGS.defaultTheme,
        paymentEnvironment: paymentSettings.environment || DEFAULT_SETTINGS.paymentEnvironment,
        stripePublishableKey: paymentSettings.stripe_publishable_key || DEFAULT_SETTINGS.stripePublishableKey,
        stripeSecretKey: paymentSettings.stripe_secret_key || DEFAULT_SETTINGS.stripeSecretKey,
        stripeWebhookSecret: paymentSettings.stripe_webhook_secret || DEFAULT_SETTINGS.stripeWebhookSecret,
        googleEnabled: oauthSettings.google_enabled !== 'false',
        googleClientId: oauthSettings.google_client_id || DEFAULT_SETTINGS.googleClientId,
        googleClientSecret: oauthSettings.google_client_secret || DEFAULT_SETTINGS.googleClientSecret,
        appleEnabled: oauthSettings.apple_enabled !== 'false',
        appleClientId: oauthSettings.apple_client_id || DEFAULT_SETTINGS.appleClientId,
        appleClientSecret: oauthSettings.apple_client_secret || DEFAULT_SETTINGS.appleClientSecret,
        twitterEnabled: oauthSettings.twitter_enabled !== 'false',
        twitterClientId: oauthSettings.twitter_client_id || DEFAULT_SETTINGS.twitterClientId,
        twitterClientSecret: oauthSettings.twitter_client_secret || DEFAULT_SETTINGS.twitterClientSecret,
        facebookEnabled: oauthSettings.facebook_enabled !== 'false',
        facebookClientId: oauthSettings.facebook_client_id || DEFAULT_SETTINGS.facebookClientId,
        facebookClientSecret: oauthSettings.facebook_client_secret || DEFAULT_SETTINGS.facebookClientSecret,
        openrouterApiKey: aiModelSettings.openrouter_api_key || DEFAULT_SETTINGS.openrouterApiKey,
        replicateApiKey: aiModelSettings.replicate_api_key || DEFAULT_SETTINGS.replicateApiKey,
        openaiApiKey: aiModelSettings.openai_api_key || DEFAULT_SETTINGS.openaiApiKey,
        r2AccountId: cloudStorageSettings.r2_account_id || DEFAULT_SETTINGS.r2AccountId,
        r2AccessKeyId: cloudStorageSettings.r2_access_key_id || DEFAULT_SETTINGS.r2AccessKeyId,
        r2SecretAccessKey: cloudStorageSettings.r2_secret_access_key || DEFAULT_SETTINGS.r2SecretAccessKey,
        r2BucketName: cloudStorageSettings.r2_bucket_name || DEFAULT_SETTINGS.r2BucketName,
        r2PublicUrl: cloudStorageSettings.r2_public_url || DEFAULT_SETTINGS.r2PublicUrl,
        turnstileSiteKey: securitySettings.turnstile_site_key || DEFAULT_SETTINGS.turnstileSiteKey,
        turnstileSecretKey: securitySettings.turnstile_secret_key || DEFAULT_SETTINGS.turnstileSecretKey,
        logoUrlDark: brandingDarkFile?.url || DEFAULT_SETTINGS.logoUrlDark,
        logoUrlLight: brandingLightFile?.url || DEFAULT_SETTINGS.logoUrlLight,
        logoWidth: brandingSettings.logo_width || DEFAULT_SETTINGS.logoWidth,
        logoHeight: brandingSettings.logo_height || DEFAULT_SETTINGS.logoHeight,
        currentFavicon: faviconFile?.url || DEFAULT_SETTINGS.currentFavicon,
        lastUpdated: new Date(),
        isFallback: false // Mark as real settings from database
      };

      this.lastFetch = Date.now();
      this.configVersion++; // Increment version on successful refresh
      console.log('Settings cache refreshed successfully');

    } catch (error) {
      console.error('Failed to refresh settings cache:', error);

      // Use default settings if database fails
      if (!this.cache) {
        console.warn('⚠️  Using fallback default settings due to database error');
        this.cache = {
          ...this.createDefaultSettings(),
          isFallback: true // Mark as fallback to signal database failure
        };
      }
    }
  }

  /**
   * Clear the cache (useful when settings are updated)
   * Increments config version to trigger re-initialization in dependent services
   */
  clearCache(): void {
    console.log('Clearing settings cache');
    this.cache = null;
    this.lastFetch = 0;
    this.configVersion++; // Increment version to signal config change
  }

  /**
   * Get current config version (increments on cache refresh/clear)
   * Used by StorageService to detect configuration changes
   */
  getConfigVersion(): number {
    return this.configVersion;
  }

  /**
   * Check if currently using fallback settings due to database error
   * Returns true if settings are defaults, false if from database
   */
  isUsingFallbackSettings(): boolean {
    return this.cache?.isFallback === true;
  }

  /**
   * Get settings synchronously from cache (returns defaults if cache is empty)
   */
  getCachedSettings(): CachedSettings {
    return this.cache || this.createDefaultSettings();
  }

  /**
   * Check if cache is considered fresh
   */
  isCacheFresh(): boolean {
    if (!this.cache) return false;
    return (Date.now() - this.lastFetch) < this.CACHE_TTL;
  }

  private createDefaultSettings(): CachedSettings {
    return {
      ...DEFAULT_SETTINGS,
      lastUpdated: new Date()
    };
  }
}

// Export singleton instance
export const settingsStore = new SettingsStore();

// Convenience functions for common operations
export async function getSiteSettings() {
  return await settingsStore.getSettings();
}

export async function getSiteName(): Promise<string> {
  return await settingsStore.getSetting('siteName');
}

export async function getSiteTitle(): Promise<string> {
  return await settingsStore.getSetting('siteTitle');
}

export async function getSiteDescription(): Promise<string> {
  return await settingsStore.getSetting('siteDescription');
}

export async function getDefaultLanguage(): Promise<string> {
  return await settingsStore.getSetting('defaultLanguage');
}

export async function getDefaultTheme(): Promise<string> {
  return await settingsStore.getSetting('defaultTheme');
}

export async function refreshSiteSettings() {
  await settingsStore.refreshCache();
}

// Payment settings convenience functions
export async function getPaymentEnvironment(): Promise<string> {
  return await settingsStore.getSetting('paymentEnvironment');
}

export async function getStripePublishableKey(): Promise<string> {
  return await settingsStore.getSetting('stripePublishableKey');
}

export async function getStripeSecretKey(): Promise<string> {
  return await settingsStore.getSetting('stripeSecretKey');
}

export async function getStripeWebhookSecret(): Promise<string> {
  return await settingsStore.getSetting('stripeWebhookSecret');
}

export async function getPaymentSettings() {
  const settings = await settingsStore.getSettings();
  return {
    paymentEnvironment: settings.paymentEnvironment,
    stripePublishableKey: settings.stripePublishableKey,
    stripeSecretKey: settings.stripeSecretKey,
    stripeWebhookSecret: settings.stripeWebhookSecret
  };
}

// OAuth settings convenience functions
export async function getGoogleEnabled(): Promise<boolean> {
  return await settingsStore.getSetting('googleEnabled');
}

export async function getGoogleClientId(): Promise<string> {
  return await settingsStore.getSetting('googleClientId');
}

export async function getGoogleClientSecret(): Promise<string> {
  return await settingsStore.getSetting('googleClientSecret');
}

export async function getOAuthSettings() {
  const settings = await settingsStore.getSettings();
  return {
    googleEnabled: settings.googleEnabled,
    googleClientId: settings.googleClientId,
    googleClientSecret: settings.googleClientSecret,
    appleEnabled: settings.appleEnabled,
    appleClientId: settings.appleClientId,
    appleClientSecret: settings.appleClientSecret,
    twitterEnabled: settings.twitterEnabled,
    twitterClientId: settings.twitterClientId,
    twitterClientSecret: settings.twitterClientSecret,
    facebookEnabled: settings.facebookEnabled,
    facebookClientId: settings.facebookClientId,
    facebookClientSecret: settings.facebookClientSecret
  };
}

// Apple OAuth settings convenience functions
export async function getAppleEnabled(): Promise<boolean> {
  return await settingsStore.getSetting('appleEnabled');
}

export async function getAppleClientId(): Promise<string> {
  return await settingsStore.getSetting('appleClientId');
}

export async function getAppleClientSecret(): Promise<string> {
  return await settingsStore.getSetting('appleClientSecret');
}

// Twitter OAuth settings convenience functions
export async function getTwitterEnabled(): Promise<boolean> {
  return await settingsStore.getSetting('twitterEnabled');
}

export async function getTwitterClientId(): Promise<string> {
  return await settingsStore.getSetting('twitterClientId');
}

export async function getTwitterClientSecret(): Promise<string> {
  return await settingsStore.getSetting('twitterClientSecret');
}

// Facebook OAuth settings convenience functions
export async function getFacebookEnabled(): Promise<boolean> {
  return await settingsStore.getSetting('facebookEnabled');
}

export async function getFacebookClientId(): Promise<string> {
  return await settingsStore.getSetting('facebookClientId');
}

export async function getFacebookClientSecret(): Promise<string> {
  return await settingsStore.getSetting('facebookClientSecret');
}

// AI Model settings convenience functions
export async function getAIModelSettings() {
  const settings = await settingsStore.getSettings();
  return {
    openrouterApiKey: settings.openrouterApiKey,
    replicateApiKey: settings.replicateApiKey,
    openaiApiKey: settings.openaiApiKey
  };
}

export async function getOpenRouterApiKey(): Promise<string> {
  return await settingsStore.getSetting('openrouterApiKey');
}

export async function getReplicateApiKey(): Promise<string> {
  const key = await settingsStore.getSetting('replicateApiKey');
  return typeof key === 'string' ? key : '';
}

export async function getOpenAIApiKey(): Promise<string> {
  const key = await settingsStore.getSetting('openaiApiKey');
  return typeof key === 'string' ? key : '';
}

// Cloud Storage settings convenience functions
export async function getCloudStorageSettingsFromCache() {
  const settings = await settingsStore.getSettings();
  return {
    r2AccountId: settings.r2AccountId,
    r2AccessKeyId: settings.r2AccessKeyId,
    r2SecretAccessKey: settings.r2SecretAccessKey,
    r2BucketName: settings.r2BucketName,
    r2PublicUrl: settings.r2PublicUrl
  };
}

export async function getR2AccountId(): Promise<string> {
  return await settingsStore.getSetting('r2AccountId');
}

export async function getR2AccessKeyId(): Promise<string> {
  return await settingsStore.getSetting('r2AccessKeyId');
}

export async function getR2SecretAccessKey(): Promise<string> {
  return await settingsStore.getSetting('r2SecretAccessKey');
}

export async function getR2BucketName(): Promise<string> {
  return await settingsStore.getSetting('r2BucketName');
}

export async function getR2PublicUrl(): Promise<string> {
  return await settingsStore.getSetting('r2PublicUrl');
}

// Turnstile security settings convenience functions
export async function getTurnstileSettings() {
  const settings = await settingsStore.getSettings();
  return {
    turnstileSiteKey: settings.turnstileSiteKey,
    turnstileSecretKey: settings.turnstileSecretKey
  };
}

export async function getTurnstileSiteKey(): Promise<string> {
  return await settingsStore.getSetting('turnstileSiteKey');
}

export async function getTurnstileSecretKey(): Promise<string> {
  return await settingsStore.getSetting('turnstileSecretKey');
}

// Logo settings convenience functions
export async function getLogoUrlDark(): Promise<string> {
  return await settingsStore.getSetting('logoUrlDark');
}

export async function getLogoUrlLight(): Promise<string> {
  return await settingsStore.getSetting('logoUrlLight');
}

export async function getLogoWidth(): Promise<string> {
  return await settingsStore.getSetting('logoWidth');
}

export async function getLogoHeight(): Promise<string> {
  return await settingsStore.getSetting('logoHeight');
}

export async function getCurrentFavicon(): Promise<string | null> {
  return await settingsStore.getSetting('currentFavicon');
}