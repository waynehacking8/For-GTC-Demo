import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'
import { getOAuthSettings, adminSettingsService } from '$lib/server/admin-settings'
import { settingsStore } from '$lib/server/settings-store'
import { clearAuthConfigCache } from '$lib/server/auth-config'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'

export const load: PageServerLoad = async () => {
  try {
    const settings = await getOAuthSettings();

    return {
      settings: {
        // Use strict equality (=== 'true') to ensure switches default to false when no DB record exists
        // This prevents OAuth providers from appearing enabled before credentials are configured
        googleEnabled: settings.google_enabled === 'true',
        googleClientId: settings.google_client_id || "",
        googleClientSecret: settings.google_client_secret || "",
        appleEnabled: settings.apple_enabled === 'true',
        appleClientId: settings.apple_client_id || "",
        appleClientSecret: settings.apple_client_secret || "",
        twitterEnabled: settings.twitter_enabled === 'true',
        twitterClientId: settings.twitter_client_id || "",
        twitterClientSecret: settings.twitter_client_secret || "",
        facebookEnabled: settings.facebook_enabled === 'true',
        facebookClientId: settings.facebook_client_id || "",
        facebookClientSecret: settings.facebook_client_secret || ""
      },
      isDemoMode: isDemoModeEnabled()
    }
  } catch (error) {
    console.error('Failed to load OAuth settings:', error);
    // Fallback to default values
    return {
      settings: {
        googleEnabled: false,
        googleClientId: "",
        googleClientSecret: "",
        appleEnabled: false,
        appleClientId: "",
        appleClientSecret: "",
        twitterEnabled: false,
        twitterClientId: "",
        twitterClientSecret: "",
        facebookEnabled: false,
        facebookClientId: "",
        facebookClientSecret: ""
      },
      isDemoMode: isDemoModeEnabled()
    }
  }
}

export const actions: Actions = {
  update: async ({ request }) => {
    // Check demo mode - block modifications
    if (isDemoModeEnabled()) {
      return fail(403, {
        error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED
      });
    }

    const data = await request.formData()

    // Extract form values - enabled states are sent via hidden inputs as 'on' or 'off'
    const googleEnabled = data.get('googleEnabled') === 'on'
    const googleClientId = data.get('googleClientId')?.toString()
    const googleClientSecret = data.get('googleClientSecret')?.toString()

    const appleEnabled = data.get('appleEnabled') === 'on'
    const appleClientId = data.get('appleClientId')?.toString()
    const appleClientSecret = data.get('appleClientSecret')?.toString()

    const twitterEnabled = data.get('twitterEnabled') === 'on'
    const twitterClientId = data.get('twitterClientId')?.toString()
    const twitterClientSecret = data.get('twitterClientSecret')?.toString()

    const facebookEnabled = data.get('facebookEnabled') === 'on'
    const facebookClientId = data.get('facebookClientId')?.toString()
    const facebookClientSecret = data.get('facebookClientSecret')?.toString()

    // Validation for Google OAuth
    if (googleEnabled) {
      if (!googleClientId || !googleClientSecret) {
        return fail(400, {
          error: 'Google Client ID and Secret are required when Google OAuth is enabled',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Validate Google Client ID format
      if (!googleClientId.endsWith('.apps.googleusercontent.com')) {
        return fail(400, {
          error: 'Invalid Google Client ID format. It should end with .apps.googleusercontent.com',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Validate Google Client Secret format
      if (!googleClientSecret.startsWith('GOCSPX-')) {
        return fail(400, {
          error: 'Invalid Google Client Secret format. It should start with GOCSPX-',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }
    }

    // Validation for Apple OAuth
    if (appleEnabled) {
      if (!appleClientId || !appleClientSecret) {
        return fail(400, {
          error: 'Apple Client ID and Secret are required when Apple OAuth is enabled',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Apple Service ID validation - should be a reverse domain format
      if (!appleClientId.includes('.') || appleClientId.length < 3) {
        return fail(400, {
          error: 'Invalid Apple Service ID format. It should be in reverse domain format (e.g., com.yourcompany.yourapp)',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Apple Client Secret validation - accept multiple formats (JWT, Client Secret, or Private Key)
      if (appleClientSecret.length < 10) {
        return fail(400, {
          error: 'Apple Client Secret is too short. It should be a valid Client Secret, JWT, or Private Key',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }
    }

    // Validation for Twitter OAuth
    if (twitterEnabled) {
      if (!twitterClientId || !twitterClientSecret) {
        return fail(400, {
          error: 'X Client ID and Secret are required when X OAuth is enabled',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Basic Twitter Client ID validation (should be alphanumeric string)
      if (twitterClientId.length < 10 || !/^[a-zA-Z0-9_-]+$/.test(twitterClientId)) {
        return fail(400, {
          error: 'Invalid X Client ID format. It should be an alphanumeric string of at least 10 characters',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Twitter Client Secret validation - should be a long alphanumeric string
      if (twitterClientSecret.length < 20 || !/^[a-zA-Z0-9_-]+$/.test(twitterClientSecret)) {
        return fail(400, {
          error: 'Invalid X Client Secret format. It should be an alphanumeric string of at least 20 characters',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }
    }

    // Validation for Facebook OAuth
    if (facebookEnabled) {
      if (!facebookClientId || !facebookClientSecret) {
        return fail(400, {
          error: 'Facebook App ID and App Secret are required when Facebook OAuth is enabled',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Facebook App ID validation - should be numeric and at least 15 digits
      if (!/^\d{15,}$/.test(facebookClientId)) {
        return fail(400, {
          error: 'Invalid Facebook App ID format. It should be a numeric string of at least 15 digits',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }

      // Facebook App Secret validation - should be at least 32 characters
      if (facebookClientSecret.length < 32) {
        return fail(400, {
          error: 'Invalid Facebook App Secret format. It should be at least 32 characters long',
          googleEnabled,
          googleClientId,
          googleClientSecret,
          appleEnabled,
          appleClientId,
          appleClientSecret,
          twitterEnabled,
          twitterClientId,
          twitterClientSecret,
          facebookEnabled,
          facebookClientId,
          facebookClientSecret
        })
      }
    }

    try {
      // Get current decrypted values to compare and prevent double encryption
      const currentSettings = await getOAuthSettings();

      // Helper function to check if value should be saved
      const shouldSaveValue = (newValue: string | undefined, currentValue: string | undefined) => {
        // Only save if we have a non-empty new value that's different from current
        const trimmedNew = (newValue || '').trim();
        const trimmedCurrent = (currentValue || '').trim();
        return trimmedNew && trimmedNew !== trimmedCurrent;
      };

      // Only save settings that have actually changed to prevent double encryption
      const settingsToSave = [];

      // Save boolean settings if they've changed
      // Note: We default to 'false' for missing DB values to ensure switches start disabled
      const googleEnabledValue = googleEnabled ? 'true' : 'false';
      if (googleEnabledValue !== (currentSettings.google_enabled || 'false')) {
        settingsToSave.push({ key: 'google_enabled', value: googleEnabledValue, category: 'oauth', description: 'Enable Google OAuth login' });
      }
      const appleEnabledValue = appleEnabled ? 'true' : 'false';
      if (appleEnabledValue !== (currentSettings.apple_enabled || 'false')) {
        settingsToSave.push({ key: 'apple_enabled', value: appleEnabledValue, category: 'oauth', description: 'Enable Apple OAuth login' });
      }
      const twitterEnabledValue = twitterEnabled ? 'true' : 'false';
      if (twitterEnabledValue !== (currentSettings.twitter_enabled || 'false')) {
        settingsToSave.push({ key: 'twitter_enabled', value: twitterEnabledValue, category: 'oauth', description: 'Enable X (Twitter) OAuth login' });
      }
      const facebookEnabledValue = facebookEnabled ? 'true' : 'false';
      if (facebookEnabledValue !== (currentSettings.facebook_enabled || 'false')) {
        settingsToSave.push({ key: 'facebook_enabled', value: facebookEnabledValue, category: 'oauth', description: 'Enable Facebook OAuth login' });
      }

      // Track which providers are having credentials saved (to ensure enabled state is also saved)
      const googleCredentialsSaving = shouldSaveValue(googleClientId, currentSettings.google_client_id) || shouldSaveValue(googleClientSecret, currentSettings.google_client_secret);
      const appleCredentialsSaving = shouldSaveValue(appleClientId, currentSettings.apple_client_id) || shouldSaveValue(appleClientSecret, currentSettings.apple_client_secret);
      const twitterCredentialsSaving = shouldSaveValue(twitterClientId, currentSettings.twitter_client_id) || shouldSaveValue(twitterClientSecret, currentSettings.twitter_client_secret);
      const facebookCredentialsSaving = shouldSaveValue(facebookClientId, currentSettings.facebook_client_id) || shouldSaveValue(facebookClientSecret, currentSettings.facebook_client_secret);

      // Force save enabled state when credentials are being saved (to ensure DB record is created)
      // This fixes the issue where saving OAuth credentials with switch OFF wouldn't create the *_enabled record
      if (googleCredentialsSaving && googleEnabledValue === (currentSettings.google_enabled || 'false')) {
        settingsToSave.push({ key: 'google_enabled', value: googleEnabledValue, category: 'oauth', description: 'Enable Google OAuth login' });
      }
      if (appleCredentialsSaving && appleEnabledValue === (currentSettings.apple_enabled || 'false')) {
        settingsToSave.push({ key: 'apple_enabled', value: appleEnabledValue, category: 'oauth', description: 'Enable Apple OAuth login' });
      }
      if (twitterCredentialsSaving && twitterEnabledValue === (currentSettings.twitter_enabled || 'false')) {
        settingsToSave.push({ key: 'twitter_enabled', value: twitterEnabledValue, category: 'oauth', description: 'Enable X (Twitter) OAuth login' });
      }
      if (facebookCredentialsSaving && facebookEnabledValue === (currentSettings.facebook_enabled || 'false')) {
        settingsToSave.push({ key: 'facebook_enabled', value: facebookEnabledValue, category: 'oauth', description: 'Enable Facebook OAuth login' });
      }

      // Only save client IDs and secrets that have changed
      if (shouldSaveValue(googleClientId, currentSettings.google_client_id)) {
        settingsToSave.push({ key: 'google_client_id', value: googleClientId!.trim(), category: 'oauth', description: 'Google OAuth client ID' });
      }
      if (shouldSaveValue(googleClientSecret, currentSettings.google_client_secret)) {
        settingsToSave.push({ key: 'google_client_secret', value: googleClientSecret!.trim(), category: 'oauth', description: 'Google OAuth client secret (encrypted)' });
      }
      if (shouldSaveValue(appleClientId, currentSettings.apple_client_id)) {
        settingsToSave.push({ key: 'apple_client_id', value: appleClientId!.trim(), category: 'oauth', description: 'Apple OAuth client ID (Service ID)' });
      }
      if (shouldSaveValue(appleClientSecret, currentSettings.apple_client_secret)) {
        settingsToSave.push({ key: 'apple_client_secret', value: appleClientSecret!.trim(), category: 'oauth', description: 'Apple OAuth client secret JWT (encrypted)' });
      }
      if (shouldSaveValue(twitterClientId, currentSettings.twitter_client_id)) {
        settingsToSave.push({ key: 'twitter_client_id', value: twitterClientId!.trim(), category: 'oauth', description: 'X (Twitter) OAuth client ID' });
      }
      if (shouldSaveValue(twitterClientSecret, currentSettings.twitter_client_secret)) {
        settingsToSave.push({ key: 'twitter_client_secret', value: twitterClientSecret!.trim(), category: 'oauth', description: 'X (Twitter) OAuth client secret (encrypted)' });
      }
      if (shouldSaveValue(facebookClientId, currentSettings.facebook_client_id)) {
        settingsToSave.push({ key: 'facebook_client_id', value: facebookClientId!.trim(), category: 'oauth', description: 'Facebook OAuth App ID' });
      }
      if (shouldSaveValue(facebookClientSecret, currentSettings.facebook_client_secret)) {
        settingsToSave.push({ key: 'facebook_client_secret', value: facebookClientSecret!.trim(), category: 'oauth', description: 'Facebook OAuth App Secret (encrypted)' });
      }

      // Only save if there are actual changes
      if (settingsToSave.length > 0) {
        await adminSettingsService.setSettings(settingsToSave);
      }

      // Clear both settings cache and auth config cache to force refresh on next request
      settingsStore.clearCache();
      clearAuthConfigCache();

      console.log('OAuth settings saved successfully');

      // Get updated settings to return current values
      const updatedSettings = await getOAuthSettings();

      return {
        success: true,
        googleEnabled: updatedSettings.google_enabled === 'true',
        googleClientId: updatedSettings.google_client_id || '',
        googleClientSecret: updatedSettings.google_client_secret || '',
        appleEnabled: updatedSettings.apple_enabled === 'true',
        appleClientId: updatedSettings.apple_client_id || '',
        appleClientSecret: updatedSettings.apple_client_secret || '',
        twitterEnabled: updatedSettings.twitter_enabled === 'true',
        twitterClientId: updatedSettings.twitter_client_id || '',
        twitterClientSecret: updatedSettings.twitter_client_secret || '',
        facebookEnabled: updatedSettings.facebook_enabled === 'true',
        facebookClientId: updatedSettings.facebook_client_id || '',
        facebookClientSecret: updatedSettings.facebook_client_secret || ''
      }
    } catch (error) {
      console.error('Error saving OAuth settings:', error)
      return fail(500, {
        error: 'Failed to save OAuth settings. Please try again.',
        googleEnabled,
        googleClientId,
        googleClientSecret,
        appleEnabled,
        appleClientId,
        appleClientSecret,
        twitterEnabled,
        twitterClientId,
        twitterClientSecret,
        facebookEnabled,
        facebookClientId,
        facebookClientSecret
      })
    }
  }
}