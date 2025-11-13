<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { enhance } from "$app/forms";

  // Import icons
  import {
    BrainIcon,
    CheckCircleIcon,
    ExternalLinkIcon,
    EyeIcon,
    EyeOffIcon,
  } from "$lib/icons/index.js";

  let { form, data } = $props();

  // Form state
  let isSubmitting = $state(false);
  let showOpenRouterKey = $state(false);
  let showReplicateKey = $state(false);
  let showOpenAIKey = $state(false);

  // Reactive form values - initialize with current settings or form data
  let openrouterApiKey = $state(
    form?.openrouterApiKey || data?.settings?.openrouterApiKey || ""
  );
  let replicateApiKey = $state(
    form?.replicateApiKey || data?.settings?.replicateApiKey || ""
  );
  let openaiApiKey = $state(
    form?.openaiApiKey || data?.settings?.openaiApiKey || ""
  );

  // Derived display values for password fields
  $effect(() => {
    // Update reactive state when data changes (e.g., on page refresh or form reset)
    if (data?.settings && !form) {
      openrouterApiKey = data.settings.openrouterApiKey || "";
      replicateApiKey = data.settings.replicateApiKey || "";
      openaiApiKey = data.settings.openaiApiKey || "";
    }
  });

  // Check if providers are configured
  function isOpenRouterConfigured() {
    return openrouterApiKey;
  }

  function isReplicateConfigured() {
    return replicateApiKey;
  }

  function isOpenAIConfigured() {
    return openaiApiKey;
  }
</script>

<svelte:head>
  <title>AI Models - Admin Settings</title>
</svelte:head>

<div class="space-y-4">
  <!-- Demo Mode Banner -->
  {#if data.isDemoMode}
    <div
      class="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-md"
    >
      <div class="flex items-center gap-2">
        <div class="flex-shrink-0">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </div>
        <div>
          <p class="font-medium">Demo Mode Active</p>
          <p class="text-sm">
            All modifications are disabled. This is a read-only demonstration of
            the admin interface.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Page Header -->
  <div>
    <h1 class="text-xl font-semibold tracking-tight flex items-center gap-2">
      <BrainIcon class="w-6 h-6" />
      AI Models Configuration
    </h1>
    <p class="text-muted-foreground">
      Configure API keys for AI model providers (OpenRouter for text gen,
      Replicate for image/video gen).
    </p>
  </div>

  <!-- Form -->
  <form
    method="POST"
    action="?/update"
    use:enhance={() => {
      isSubmitting = true;
      return async ({ update }) => {
        await update();
        isSubmitting = false;
      };
    }}
    class="space-y-6"
  >
    <!-- Error Message -->
    {#if form?.error}
      <div
        class="p-3 text-sm text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md"
      >
        {form.error}
      </div>
    {/if}

    <!-- Success Message -->
    {#if form?.success}
      <div
        class="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md"
      >
        AI model settings updated successfully!
      </div>
    {/if}

    <!-- OpenRouter Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center justify-between">
          <div>
            <Card.Title class="flex items-center gap-2">
              <div
                class="w-6 h-6 bg-orange-500 rounded flex items-center justify-center"
              >
                <span class="text-white text-xs font-bold">OR</span>
              </div>
              OpenRouter
              {#if isOpenRouterConfigured()}
                <CheckCircleIcon class="w-4 h-4 text-green-500" />
              {/if}
            </Card.Title>
            <Card.Description
              >Unified API for all text generation models</Card.Description
            >
          </div>
        </div>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-md">
          <h4 class="font-medium text-gray-800 mb-2">Setup Instructions:</h4>
          <ol class="text-sm text-gray-700 space-y-1 list-decimal list-inside">
            <li>
              Go to <a
                href="https://openrouter.ai/"
                target="_blank"
                class="underline inline-flex items-center gap-1"
                >OpenRouter.ai <ExternalLinkIcon class="w-3 h-3" /></a
              >
            </li>
            <li>Sign up or log in to your account</li>
            <li>Navigate to "Keys" in your dashboard</li>
            <li>Create a new API key</li>
            <li>Copy the key and paste it below</li>
          </ol>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="openrouterApiKey">OpenRouter API Key</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => (showOpenRouterKey = !showOpenRouterKey)}
              class="h-auto p-1"
              disabled={data.isDemoMode}
            >
              {#if showOpenRouterKey}
                <EyeOffIcon class="w-4 h-4" />
              {:else}
                <EyeIcon class="w-4 h-4" />
              {/if}
            </Button>
          </div>
          <Input
            id="openrouterApiKey"
            name="openrouterApiKey"
            type={showOpenRouterKey ? "text" : "password"}
            placeholder="sk-or-..."
            bind:value={openrouterApiKey}
            class="font-mono"
            disabled={data.isDemoMode}
          />
          <p class="text-xs text-muted-foreground">
            Enables access to 40+ text models including GPT, Claude, Gemini,
            Grok, DeepSeek, Qwen, Kimi, GLM, Llama, and more...
          </p>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Replicate Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center justify-between">
          <div>
            <Card.Title class="flex items-center gap-2">
              <div
                class="w-6 h-6 bg-purple-600 rounded flex items-center justify-center"
              >
                <span class="text-white text-xs font-bold">R</span>
              </div>
              Replicate
              {#if isReplicateConfigured()}
                <CheckCircleIcon class="w-4 h-4 text-green-500" />
              {/if}
            </Card.Title>
            <Card.Description
              >Unified API for all image and video generation models</Card.Description
            >
          </div>
        </div>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-md">
          <h4 class="font-medium text-gray-800 mb-2">Setup Instructions:</h4>
          <ol class="text-sm text-gray-700 space-y-1 list-decimal list-inside">
            <li>
              Go to <a
                href="https://replicate.com/account/api-tokens"
                target="_blank"
                class="underline inline-flex items-center gap-1"
                >Replicate API Tokens <ExternalLinkIcon class="w-3 h-3" /></a
              >
            </li>
            <li>Sign up or log in to your account</li>
            <li>Create a new API token</li>
            <li>Copy the token and paste it below</li>
          </ol>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="replicateApiKey">Replicate API Token</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => (showReplicateKey = !showReplicateKey)}
              class="h-auto p-1"
              disabled={data.isDemoMode}
            >
              {#if showReplicateKey}
                <EyeOffIcon class="w-4 h-4" />
              {:else}
                <EyeIcon class="w-4 h-4" />
              {/if}
            </Button>
          </div>
          <Input
            id="replicateApiKey"
            name="replicateApiKey"
            type={showReplicateKey ? "text" : "password"}
            placeholder="r8_..."
            bind:value={replicateApiKey}
            class="font-mono"
            disabled={data.isDemoMode}
          />
          <p class="text-xs text-muted-foreground">
            Enables access to 64+ image and video models including Sora, Veo,
            Imagen, Flux, Stable Diffusion, LeonardoAI, Kling, and more...
          </p>
          <p class="text-xs text-muted-foreground">
            <span class="font-bold">IMPORTANT:</span> In order to use media
            generation models or make the file upload functionality work in
            general, you will need to integrate
            <a class="underline font-bold" href="/admin/settings/cloud-storage"
              >Cloud Storage</a
            > first. Cloud Storage is required since Local Storage cannot be used
            if the app is hosted on a serverless platform (e.g. Vercel).
          </p>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- OpenAI Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center justify-between">
          <div>
            <Card.Title class="flex items-center gap-2">
              <div
                class="w-6 h-6 bg-green-600 rounded flex items-center justify-center"
              >
                <span class="text-white text-xs font-bold">AI</span>
              </div>
              OpenAI
              {#if isOpenAIConfigured()}
                <CheckCircleIcon class="w-4 h-4 text-green-500" />
              {/if}
            </Card.Title>
            <Card.Description
              >Only required for specific OpenAI image generation models via
              Replicate (GPT-IMAGE-1 and GPT-IMAGE-1-MINI)</Card.Description
            >
          </div>
        </div>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-md">
          <h4 class="font-medium text-gray-800 mb-2">Setup Instructions:</h4>
          <ol class="text-sm text-gray-700 space-y-1 list-decimal list-inside">
            <li>
              Go to <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                class="underline inline-flex items-center gap-1"
                >OpenAI API Keys <ExternalLinkIcon class="w-3 h-3" /></a
              >
            </li>
            <li>Sign up or log in to your account</li>
            <li>Create a new secret API key</li>
            <li>Copy the key and paste it below</li>
          </ol>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="openaiApiKey">OpenAI API Key</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => (showOpenAIKey = !showOpenAIKey)}
              class="h-auto p-1"
              disabled={data.isDemoMode}
            >
              {#if showOpenAIKey}
                <EyeOffIcon class="w-4 h-4" />
              {:else}
                <EyeIcon class="w-4 h-4" />
              {/if}
            </Button>
          </div>
          <Input
            id="openaiApiKey"
            name="openaiApiKey"
            type={showOpenAIKey ? "text" : "password"}
            placeholder="sk-proj-..."
            bind:value={openaiApiKey}
            class="font-mono"
            disabled={data.isDemoMode}
          />
          <p class="text-xs text-muted-foreground">
            Required for OpenAI image generation models accessed through
            Replicate (gpt-image-1 and gpt-image-1-mini). This key is passed as
            a body parameter to Replicate for these specific models.
          </p>
          <p class="text-xs text-muted-foreground">
            If you see the error: “your organization must be verified to use the
            model” please go to <a
              class="underline font-bold"
              target="_blank"
              href="https://platform.openai.com/settings/organization/general"
              >OpenAI Organization Settings</a
            >
            and click on <span class="font-bold">Verify Organization</span>. If
            you just verified, it can take up to 15 minutes for access to
            propagate.
          </p>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Submit Button -->
    <div class="space-y-2">
      <div class="flex justify-end">
        <Button type="submit" disabled={isSubmitting || data.isDemoMode}>
          {isSubmitting
            ? "Saving..."
            : data.isDemoMode
              ? "Demo Mode - Read Only"
              : "Save AI Model Settings"}
        </Button>
      </div>
      {#if data.isDemoMode}
        <p class="text-xs text-muted-foreground text-right">
          Saving is disabled in demo mode. This is a read-only demonstration.
        </p>
      {/if}
    </div>
  </form>
</div>
