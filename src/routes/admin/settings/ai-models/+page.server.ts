import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'
import { getAIModelSettings, adminSettingsService } from '$lib/server/admin-settings'
import { settingsStore } from '$lib/server/settings-store'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'

export const load: PageServerLoad = async () => {
  try {
    const settings = await getAIModelSettings();

    return {
      settings: {
        openrouterApiKey: settings.openrouter_api_key || "",
        replicateApiKey: settings.replicate_api_key || "",
        openaiApiKey: settings.openai_api_key || ""
      },
      isDemoMode: isDemoModeEnabled()
    }
  } catch (error) {
    console.error('Failed to load AI model settings:', error);
    // Fallback to default values
    return {
      settings: {
        openrouterApiKey: "",
        replicateApiKey: "",
        openaiApiKey: ""
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

    const openrouterApiKey = data.get('openrouterApiKey')?.toString()
    const replicateApiKey = data.get('replicateApiKey')?.toString()
    const openaiApiKey = data.get('openaiApiKey')?.toString()

    // Validation for OpenRouter API Key
    if (openrouterApiKey && openrouterApiKey.length < 10) {
      return fail(400, {
        error: 'OpenRouter API key is too short. Please provide a valid API key.',
        openrouterApiKey,
        replicateApiKey,
        openaiApiKey
      })
    }

    // Validation for Replicate API Token
    if (replicateApiKey && !replicateApiKey.startsWith('r8_')) {
      return fail(400, {
        error: 'Invalid Replicate API token format. It should start with "r8_".',
        openrouterApiKey,
        replicateApiKey,
        openaiApiKey
      })
    }

    // Validation for OpenAI API Key
    if (openaiApiKey && !openaiApiKey.startsWith('sk-')) {
      return fail(400, {
        error: 'Invalid OpenAI API key format. It should start with "sk-".',
        openrouterApiKey,
        replicateApiKey,
        openaiApiKey
      })
    }

    try {
      // Get current decrypted values to compare and prevent double encryption
      const currentSettings = await getAIModelSettings();

      // Helper function to check if value should be saved
      const shouldSaveValue = (newValue: string | undefined, currentValue: string | undefined) => {
        // Only save if we have a non-empty new value that's different from current
        const trimmedNew = (newValue || '').trim();
        const trimmedCurrent = (currentValue || '').trim();
        return trimmedNew && trimmedNew !== trimmedCurrent;
      };

      // Only save settings that have actually changed to prevent double encryption
      const settingsToSave = [];

      if (shouldSaveValue(openrouterApiKey, currentSettings.openrouter_api_key)) {
        settingsToSave.push({ key: 'openrouter_api_key', value: openrouterApiKey!.trim(), category: 'ai_models', description: 'OpenRouter API key for 32+ text models (encrypted)' });
      }
      if (shouldSaveValue(replicateApiKey, currentSettings.replicate_api_key)) {
        settingsToSave.push({ key: 'replicate_api_key', value: replicateApiKey!.trim(), category: 'ai_models', description: 'Replicate API token for image/video generation models (encrypted)' });
      }
      if (shouldSaveValue(openaiApiKey, currentSettings.openai_api_key)) {
        settingsToSave.push({ key: 'openai_api_key', value: openaiApiKey!.trim(), category: 'ai_models', description: 'OpenAI API key for specific OpenAI models via Replicate (encrypted)' });
      }

      // Only save if there are actual changes
      if (settingsToSave.length > 0) {
        await adminSettingsService.setSettings(settingsToSave);
      }

      // Clear the settings cache to force refresh on next request
      settingsStore.clearCache();
      
      console.log('AI model settings saved successfully');

      // Get updated settings to return current values (decrypted)
      const updatedSettings = await getAIModelSettings();

      return {
        success: true,
        openrouterApiKey: updatedSettings.openrouter_api_key || '',
        replicateApiKey: updatedSettings.replicate_api_key || '',
        openaiApiKey: updatedSettings.openai_api_key || ''
      }
    } catch (error) {
      console.error('Error saving AI model settings:', error)
      return fail(500, {
        error: 'Failed to save AI model settings. Please try again.',
        openrouterApiKey,
        replicateApiKey,
        openaiApiKey
      })
    }
  }
}