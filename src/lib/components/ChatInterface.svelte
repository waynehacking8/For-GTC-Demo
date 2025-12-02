<script lang="ts">
  // UI Component imports
  import * as Select from "$lib/components/ui/select/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import Button from "$lib/components/ui/button/button.svelte";
  import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

  // Icon imports
  import {
    ArrowUpIcon,
    CircleCheckIcon,
    ImageIcon,
    TypeIcon,
    VideoIcon,
    Settings2Icon,
    BulbIcon,
    CodeIcon,
    AnalyticsIcon,
    MessageCircleIcon,
    SquarePlusIcon,
    XIcon,
    FileIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    BrainIcon,
    PlusIcon,
    UsersIcon,
    PencilIcon,
    TrashIcon,
  } from "$lib/icons/index.js";

  // Application types and config
  import type { AIModelConfig } from "$lib/ai/types.js";
  import { providerConfig } from "$lib/config/provider-icons.js";
  import { GUEST_MESSAGE_LIMIT } from "$lib/constants/guest-limits.js";
  import {
    parseMarkdown,
    applySyntaxHighlighting,
  } from "$lib/utils/markdown.js";
  import { getAllToolNames, getToolDisplayName } from "$lib/ai/tools/index.js";
  import { TextareaAutosize } from "$lib/spells/textarea-autosize.svelte.ts";
  import { ElementSize, ScrollState, IsMounted, Debounced } from "runed";

  import { getContext } from "svelte";
  import type { ChatState, AttachedFile } from "./chat-state.svelte.js";
  import FileUpload from "./FileUpload.svelte";
  import * as Carousel from "$lib/components/ui/carousel/index.js";
  import * as m from "$lib/../paraglide/messages.js";

  // ToggleEvent interface for popover beforetoggle event
  interface ToggleEvent extends Event {
    newState: "open" | "closed";
    oldState: "open" | "closed";
  }

  // Get chat state from context (provided by layout)
  const chatState = getContext<ChatState>("chatState");

  let chatContainer: HTMLDivElement;

  // Model filter state
  let modelFilter = $state<"all" | "images" | "videos">("all");

  // System prompt editor state
  let showSystemPrompt = $state(false);

  // Knowledge Graph visualization state
  let showKgDialog = $state(false);
  let maxNodes = $state(100);
  let minDegree = $state(1);
  let generatingGraph = $state(false);
  let graphGenerated = $state(false);
  let graphUrl = $state('');
  let kgError = $state('');

  // Textarea implementation based on thom-chat
  let textarea = $state<HTMLTextAreaElement>();
  const autosize = new TextareaAutosize();
  const textareaSize = new ElementSize(() => textarea);
  const mounted = new IsMounted();

  // Timer management for cleanup
  let timers: Set<ReturnType<typeof setTimeout>> = new Set();

  // Standardized timing constants
  const TIMING = {
    TEXTAREA_SCROLL: 10,
    CHAT_SCROLL: 100,
    SYNTAX_HIGHLIGHTING: 100,
    FOCUS_AFTER_MOUNT: 225,
    FOCUS_AFTER_RESPONSE: 200,
    PROMPT_TEMPLATE_FOCUS: 10,
  } as const;

  // Helper function for managed timers
  function managedTimeout(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  // Cleanup timers on component destroy
  $effect(() => {
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  });

  // Position popover relative to trigger button
  function positionPopover(popover: HTMLElement, trigger: HTMLElement) {
    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Default spacing above/below trigger
    const spacing = 16;
    const isFileUpload = popover.id === "file-upload-popover";
    const isMobile = viewport.width < 640; // sm breakpoint

    // Calculate horizontal position
    let left: number;

    if (isMobile && !isFileUpload) {
      // On mobile, center the popover in the viewport with 8px margins
      left = 8;
      // Ensure the popover uses full available width (already handled by CSS w-[calc(100vw-16px)])
    } else {
      // Desktop behavior: center-align with trigger
      left = triggerRect.left + (triggerRect.width - popoverRect.width) / 2;
    }

    // Ensure popover doesn't go off screen horizontally
    if (left < 8) {
      left = 8; // 8px margin from left edge
    } else if (left + popoverRect.width > viewport.width - 8) {
      left = viewport.width - popoverRect.width - 8; // 8px margin from right edge
    }

    if (isFileUpload) {
      // File upload popover: anchor bottom edge above trigger (grows upward)
      const bottom = viewport.height - triggerRect.top + spacing;

      // Ensure popover doesn't go off screen at the top
      const maxBottom = viewport.height - 8; // 8px margin from top
      const finalBottom = Math.min(bottom, maxBottom);

      popover.style.bottom = `${finalBottom}px`;
      popover.style.top = "auto";
    } else {
      // Model selector popover: intelligent positioning
      let top: number;

      if (isMobile) {
        // On mobile, prefer positioning above the trigger with more space
        const spaceAbove = triggerRect.top - spacing;
        const spaceBelow = viewport.height - triggerRect.bottom - spacing;
        const popoverHeight = Math.min(
          popoverRect.height,
          viewport.height * 0.7
        ); // Max 70% of viewport height

        if (spaceAbove >= popoverHeight) {
          // Position above
          top = triggerRect.top - popoverHeight - spacing;
        } else if (spaceBelow >= popoverHeight) {
          // Position below
          top = triggerRect.bottom + spacing;
        } else {
          // Use the larger space and adjust height
          if (spaceAbove > spaceBelow) {
            top = 8; // Near top of screen
            popover.style.maxHeight = `${triggerRect.top - 24}px`; // Leave space for trigger
          } else {
            top = triggerRect.bottom + spacing;
            popover.style.maxHeight = `${viewport.height - triggerRect.bottom - 24}px`;
          }
        }
      } else {
        // Desktop logic: try above first, then below
        top = triggerRect.top - popoverRect.height - spacing;

        // If not enough space above, position below
        if (top < 8) {
          top = triggerRect.bottom + spacing;
        }

        // Ensure popover doesn't go off screen vertically
        if (top + popoverRect.height > viewport.height - 8) {
          top = viewport.height - popoverRect.height - 8; // 8px margin from bottom
        }
      }

      popover.style.top = `${top}px`;
      popover.style.bottom = "auto";
    }

    // Apply horizontal positioning for both types
    popover.style.left = `${left}px`;
  }

  // Setup popover positioning when component mounts
  $effect(() => {
    if (!mounted.current) return;

    const modelPopover = document.getElementById("model-selector-popover");
    const modelTrigger = document.getElementById("model-selector-trigger");
    const filePopover = document.getElementById("file-upload-popover");
    const fileTrigger = document.getElementById("file-upload-trigger");

    const cleanupHandlers: (() => void)[] = [];

    // Debounced resize handler to improve performance
    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Reposition open popovers when screen size changes
        if (modelPopover?.matches(":popover-open") && modelTrigger) {
          requestAnimationFrame(() => {
            positionPopover(modelPopover, modelTrigger);
          });
        }
        if (filePopover?.matches(":popover-open") && fileTrigger) {
          requestAnimationFrame(() => {
            positionPopover(filePopover, fileTrigger);
          });
        }
      }, 150); // 150ms debounce
    };

    // Add resize and orientation change listeners
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    cleanupHandlers.push(() => {
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    });

    // Setup model selector popover positioning
    if (modelPopover && modelTrigger) {
      const handleModelBeforeToggle = (event: Event) => {
        const toggleEvent = event as ToggleEvent;
        if (toggleEvent.newState === "open") {
          // Small delay to ensure popover dimensions are available
          requestAnimationFrame(() => {
            positionPopover(modelPopover, modelTrigger);
          });
        }
      };

      modelPopover.addEventListener("beforetoggle", handleModelBeforeToggle);
      cleanupHandlers.push(() => {
        modelPopover.removeEventListener(
          "beforetoggle",
          handleModelBeforeToggle
        );
      });
    }

    // Setup file upload popover positioning
    if (filePopover && fileTrigger) {
      const handleFileBeforeToggle = (event: Event) => {
        const toggleEvent = event as ToggleEvent;
        if (toggleEvent.newState === "open") {
          // Small delay to ensure popover dimensions are available
          requestAnimationFrame(() => {
            positionPopover(filePopover, fileTrigger);
          });
        }
      };

      filePopover.addEventListener("beforetoggle", handleFileBeforeToggle);
      cleanupHandlers.push(() => {
        filePopover.removeEventListener("beforetoggle", handleFileBeforeToggle);
      });
    }

    // Cleanup all handlers
    return () => {
      cleanupHandlers.forEach((cleanup) => cleanup());
    };
  });

  // Create scroll state for textarea
  const textareaScrollState = new ScrollState({
    element: () => textarea,
    behavior: "smooth",
  });

  // Track if textarea is at bottom with debounced state
  const notAtBottom = new Debounced(
    () =>
      mounted.current && textarea ? !textareaScrollState.arrived.bottom : false,
    250
  );

  // Enhanced textarea disabled state
  const textareaDisabled = $derived(chatState.isLoading);

  // Check if send button should be disabled (empty content after cleaning)
  const sendButtonDisabled = $derived.by(() => {
    if (chatState.isLoading) return true;
    if (chatState.isUploadingFiles) return true; // Disable while uploading files

    // Allow sending if there are attached files (even without text)
    const hasAttachedFiles = chatState.attachedFiles.length > 0;
    const hasValidText = chatState.prompt && chatState.cleanMessageContent(chatState.prompt);

    // Must have either valid text OR attached files
    if (!hasValidText && !hasAttachedFiles) return true;

    // Disable for guests who have reached their limit
    if (!chatState.canGuestSendMessage()) return true;

    return false;
  });

  // Function to check if cursor is at the end of the text
  function isCursorAtEnd(): boolean {
    if (!textarea) return false;
    const cursorPosition = textarea.selectionStart;
    const textLength = chatState.prompt.length;
    return cursorPosition === textLength;
  }

  // Auto-scroll textarea to bottom when content or size changes (only if cursor is at end)
  $effect(() => {
    const shouldScroll =
      mounted.current &&
      textarea &&
      isCursorAtEnd() &&
      (chatState.prompt || textareaSize.height);

    if (shouldScroll) {
      managedTimeout(() => {
        if (textarea) {
          textareaScrollState.scrollToBottom();
        }
      }, TIMING.TEXTAREA_SCROLL);
    }
  });

  // Smooth scroll to bottom
  function scrollToBottom() {
    if (!chatContainer) return;

    // Use requestAnimationFrame for better timing with browser rendering
    requestAnimationFrame(() => {
      if (chatContainer) {
        chatContainer.scrollTo({
          top: chatContainer.scrollHeight,
          behavior: "smooth",
        });
      }
    });
  }

  // Auto-scroll when messages change or loading state changes
  $effect(() => {
    if (chatState.messages.length > 0 || chatState.isLoading) {
      // Longer delay to allow images to start loading (now eager loading)
      managedTimeout(scrollToBottom, TIMING.CHAT_SCROLL);
    }
  });

  // Apply syntax highlighting when messages change
  $effect(() => {
    if (chatState.messages.length > 0) {
      // Small delay to ensure DOM has updated with new content
      managedTimeout(() => {
        applySyntaxHighlighting(chatContainer);
      }, TIMING.SYNTAX_HIGHLIGHTING);
    }
  });

  // Setup model change detection
  chatState.setupModelChangeDetection();

  // Handle file upload
  function handleFilesSelected(files: any[]) {
    const attachedFiles: AttachedFile[] = files.map((f) => ({
      id: f.id,
      file: f.file,
      name: f.name,
      size: f.size,
      type: f.type,
      dataUrl: f.dataUrl,
      content: f.content,
    }));
    chatState.addAttachedFiles(attachedFiles);
  }

  // Helper functions for image handling
  function getImageCount(message: any): number {
    if (message.images?.length) return message.images.length;
    if (message.imageIds?.length) return message.imageIds.length;
    if (message.imageId || message.imageUrl || message.imageData) return 1;
    return 0;
  }

  function getAllImages(message: any) {
    if (message.images?.length) return message.images;
    if (message.imageIds?.length)
      return message.imageIds.map((id: string) => ({
        imageId: id,
        mimeType: "",
      }));
    if (message.imageId || message.imageData)
      return [
        {
          imageId: message.imageId,
          imageData: message.imageData,
          mimeType: message.mimeType || "",
        },
      ];
    return [];
  }

  // Group models by provider for display - memoized for performance
  const aiModelGroups = $derived(
    chatState.models.reduce(
      (groups, model) => {
        const provider = model.provider;
        const group = groups.find((g) => g.provider === provider);
        const modelData = {
          value: model.name,
          label: model.displayName,
          capabilities: getCapabilities(model),
          architecture: model.architecture, // Include architecture data for UI enhancements
        };

        if (group) {
          group.models.push(modelData);
        } else {
          groups.push({
            provider,
            models: [modelData],
          });
        }

        return groups;
      },
      [] as {
        provider: string;
        models: {
          value: string;
          label: string;
          capabilities: Capability[];
          architecture?: import("$lib/ai/types.js").ArchitectureObject;
        }[];
      }[]
    )
  );

  // Filtered model groups based on selected filter
  const filteredModelGroups = $derived(
    aiModelGroups
      .map((group) => {
        const filteredModels = group.models.filter((model) => {
          const foundModel = chatState.models.find(
            (m) => m.name === model.value
          );
          if (!foundModel) return false;

          switch (modelFilter) {
            case "images":
              return foundModel.supportsImageGeneration === true;
            case "videos":
              return foundModel.supportsVideoGeneration === true;
            case "all":
            default:
              return true;
          }
        });

        return {
          ...group,
          models: filteredModels,
        };
      })
      .filter((group) => group.models.length > 0) // Only show groups that have models
  );

  function getCapabilities(model: AIModelConfig): Capability[] {
    const caps: Capability[] = [];

    // Architecture-first approach: Use architecture data when available (OpenRouter models)
    if (model.architecture) {
      // Text capability: Check if model outputs text
      if (model.architecture.output_modalities.includes("text")) {
        caps.push("text");
      }

      // Image capability: Check if model accepts image/file inputs OR supports image generation
      if (
        model.architecture.input_modalities.includes("image") ||
        model.architecture.input_modalities.includes("file") ||
        model.supportsImageGeneration // Still check boolean for image generation
      ) {
        caps.push("image");
      }

      // Video capability: Architecture doesn't specify video, use boolean fallback
      if (model.supportsVideoGeneration) {
        caps.push("video");
      }
    } else {
      // Boolean fallback approach: For providers without architecture data (Google Gemini, etc.)

      // Text capability: Check boolean flag
      if (model.supportsTextGeneration) {
        caps.push("text");
      }

      // Image capability: Check multiple boolean flags
      if (
        model.supportsFunctions ||
        model.supportsImageGeneration ||
        model.supportsImageInput
      ) {
        caps.push("image");
      }

      // Video capability: Check boolean flag
      if (model.supportsVideoGeneration) {
        caps.push("video");
      }
    }

    return caps;
  }

  // Capability types and configuration
  type Capability = "text" | "image" | "video" | "file";

  const capabilityConfig: Record<
    Capability,
    { icon: any; bgColor: string; iconColor: string; tooltip: string }
  > = {
    text: {
      icon: TypeIcon,
      bgColor: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-700 dark:text-blue-300",
      tooltip: m["interface.supports_text"](),
    },
    image: {
      icon: ImageIcon,
      bgColor: "bg-green-100 dark:bg-green-900/30",
      iconColor: "text-green-700 dark:text-green-300",
      tooltip: m["interface.supports_image"](),
    },
    video: {
      icon: VideoIcon,
      bgColor: "bg-purple-100 dark:bg-purple-900/30",
      iconColor: "text-purple-700 dark:text-purple-300",
      tooltip: m["interface.supports_video"](),
    },
    file: {
      icon: FileIcon,
      bgColor: "bg-orange-100 dark:bg-orange-900/30",
      iconColor: "text-orange-700 dark:text-orange-300",
      tooltip: m["interface.file_support"](),
    },
  };

  // Function to get modality styling configuration
  function getModalityConfig(modality: string) {
    const modalityKey = modality.toLowerCase() as Capability;
    return capabilityConfig[modalityKey] || capabilityConfig.text; // Default to text config
  }

  // Function to create synthetic architecture data for models without native architecture data
  function getSyntheticArchitecture(
    model: AIModelConfig
  ): import("$lib/ai/types.js").ArchitectureObject {
    const input_modalities: string[] = [];
    const output_modalities: string[] = [];

    // Map input capabilities to modalities
    if (model.supportsTextInput) input_modalities.push("text");
    if (model.supportsImageInput) input_modalities.push("image");
    if (model.supportsVideoInput) input_modalities.push("video");
    if (model.supportsAudioInput) input_modalities.push("audio");

    // Map output capabilities to modalities
    if (model.supportsTextGeneration) output_modalities.push("text");
    if (model.supportsImageGeneration) output_modalities.push("image");
    if (model.supportsVideoGeneration) output_modalities.push("video");
    if (model.supportsAudioGeneration) output_modalities.push("audio");

    return {
      input_modalities,
      output_modalities,
      tokenizer: model.provider || "Unknown",
      instruct_type: null,
    };
  }

  // Prompt templates configuration - 正崴財報相關問題
  const PROMPT_TEMPLATES = [
    {
      id: "revenue",
      title: m["prompts.creative_writing.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-100 dark:bg-blue-900/30",
      prompt: m["prompts.creative_writing.description"](),
      description: m["prompts.creative_writing.short_description"](),
    },
    {
      id: "margin",
      title: m["prompts.code_review.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-100 dark:bg-green-900/30",
      prompt: m["prompts.code_review.description"](),
      description: m["prompts.code_review.short_description"](),
    },
    {
      id: "eps",
      title: m["prompts.analysis_research.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-100 dark:bg-orange-900/30",
      prompt: m["prompts.analysis_research.description"](),
      description: m["prompts.analysis_research.short_description"](),
    },
    {
      id: "rd",
      title: m["prompts.general_discussion.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-100 dark:bg-purple-900/30",
      prompt: m["prompts.general_discussion.description"](),
      description: m["prompts.general_discussion.short_description"](),
    },
    {
      id: "cash_flow",
      title: m["prompts.cash_flow.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-cyan-600 dark:text-cyan-400",
      bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
      prompt: m["prompts.cash_flow.description"](),
      description: m["prompts.cash_flow.short_description"](),
    },
    {
      id: "roe",
      title: m["prompts.roe_analysis.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-pink-600 dark:text-pink-400",
      bgColor: "bg-pink-100 dark:bg-pink-900/30",
      prompt: m["prompts.roe_analysis.description"](),
      description: m["prompts.roe_analysis.short_description"](),
    },
    {
      id: "debt",
      title: m["prompts.debt_ratio.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-100 dark:bg-red-900/30",
      prompt: m["prompts.debt_ratio.description"](),
      description: m["prompts.debt_ratio.short_description"](),
    },
    {
      id: "inventory",
      title: m["prompts.inventory_turnover.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-100 dark:bg-amber-900/30",
      prompt: m["prompts.inventory_turnover.description"](),
      description: m["prompts.inventory_turnover.short_description"](),
    },
    {
      id: "dividend",
      title: m["prompts.dividend_policy.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
      prompt: m["prompts.dividend_policy.description"](),
      description: m["prompts.dividend_policy.short_description"](),
    },
    {
      id: "profit",
      title: m["prompts.profit_structure.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-indigo-600 dark:text-indigo-400",
      bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
      prompt: m["prompts.profit_structure.description"](),
      description: m["prompts.profit_structure.short_description"](),
    },
    {
      id: "capex",
      title: m["prompts.capex.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-violet-600 dark:text-violet-400",
      bgColor: "bg-violet-100 dark:bg-violet-900/30",
      prompt: m["prompts.capex.description"](),
      description: m["prompts.capex.short_description"](),
    },
    {
      id: "revenue_breakdown",
      title: m["prompts.revenue_breakdown.title"](),
      icon: AnalyticsIcon,
      iconColor: "text-teal-600 dark:text-teal-400",
      bgColor: "bg-teal-100 dark:bg-teal-900/30",
      prompt: m["prompts.revenue_breakdown.description"](),
      description: m["prompts.revenue_breakdown.short_description"](),
    },
  ] as const;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatState.handleSubmit();
    }
  }

  // Function to handle clicking on prompt templates
  function handlePromptTemplate(template: string) {
    chatState.prompt = template;
    // Focus the textarea after setting the prompt
    managedTimeout(() => {
      if (textarea) {
        textarea.focus();
        // Move cursor to end of text
        textarea.setSelectionRange(template.length, template.length);
      }
    }, TIMING.PROMPT_TEMPLATE_FOCUS);
  }

  // Function to handle keyboard events on prompt templates
  function handlePromptTemplateKeydown(event: KeyboardEvent, template: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlePromptTemplate(template);
    }
  }

  // Function to generate interactive knowledge graph
  async function generateInteractiveGraph() {
    generatingGraph = true;
    kgError = '';
    try {
      const response = await fetch(`/api/rag/graph/interactive?max_nodes=${maxNodes}&min_degree=${minDegree}`);
      if (!response.ok) throw new Error('Failed to generate graph');

      const data = await response.json();
      if (data.success) {
        graphGenerated = true;
        graphUrl = data.view_url;
      }
    } catch (error) {
      console.error('Failed to generate graph:', error);
      kgError = 'Failed to generate interactive graph';
    } finally {
      generatingGraph = false;
    }
  }

  // Focus textarea on mount
  $effect(() => {
    if (textarea && mounted.current) {
      // Focus textarea after scroll completes (scroll happens at 100ms, so focus at 225ms)
      managedTimeout(() => {
        if (textarea) {
          textarea.focus();
        }
      }, TIMING.FOCUS_AFTER_MOUNT);
    }
  });

  // Focus textarea after AI responds
  $effect(() => {
    if (!chatState.isLoading && chatState.messages.length > 0) {
      // Focus textarea after any scrolling completes (scroll at 100ms, focus at 200ms)
      managedTimeout(() => {
        if (textarea) {
          textarea.focus();
        }
      }, TIMING.FOCUS_AFTER_RESPONSE);
    }
  });
</script>

<!-- Main content area -->
<main class="flex flex-col h-full w-full">
  <!-- Main chat area -->
  <div
    class="flex-1 overflow-auto scroll-smooth min-h-0 overflow-x-hidden relative"
    bind:this={chatContainer}
  >
    {#if chatState.isLoadingChat}
      <div class="flex items-center justify-center p-6 h-full">
        <div class="w-full xl:max-w-4xl mx-auto text-center">
          <div class="flex items-center justify-center gap-2">
            <div class="flex items-center space-x-4">
              <div class="space-y-2">
                <Skeleton class="h-5 w-lg" />
                <Skeleton class="h-5 w-xl" />
                <Skeleton class="h-5 w-sm" />
                <Skeleton class="h-5 w-md" />
                <Skeleton class="h-5 w-xl" />
                <Skeleton class="h-5 w-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    {:else if chatState.messages.length === 0}
      <div class="flex items-center justify-center p-6 h-full">
        <div class="w-full xl:max-w-4xl mx-auto">
          <div class="text-center mb-8">
            <h1 class="text-4xl font-bold mb-4">
              {m["interface.welcome_heading"]()}
            </h1>
            <p class="text-muted-foreground text-lg mb-2">
              {m["interface.welcome_subtitle"]()}
            </p>
            <div class="text-sm text-muted-foreground">
              {m["interface.welcome_description"]()}
            </div>
          </div>

          <!-- Prompt Templates Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {#each PROMPT_TEMPLATES as template}
              <div
                class="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
                role="button"
                tabindex="0"
                onclick={() => handlePromptTemplate(template.prompt)}
                onkeydown={(e) =>
                  handlePromptTemplateKeydown(e, template.prompt)}
              >
                <div class="flex items-center gap-3 mb-2">
                  <div class="p-2 rounded-full {template.bgColor}">
                    <template.icon class="w-4 h-4 {template.iconColor}" />
                  </div>
                  <h3 class="font-medium text-sm">{template.title}</h3>
                </div>
                <p
                  class="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
                >
                  {template.description}
                </p>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="w-full xl:max-w-4xl mx-auto p-6">
        <div class="space-y-6">
          {#each chatState.messages as message}
            {#if message.role === "user"}
              <!-- User message - gray bubble for both modes -->
              <div class="flex justify-end">
                <div class="max-w-[75%] flex flex-col items-end gap-3">
                  <!-- Text bubble -->
                  <div
                    class="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-2xl px-4 py-3"
                  >
                    <div
                      class="text-sm font-medium mb-1 text-slate-600 dark:text-slate-400 italic"
                    >
                      You
                    </div>
                    <div
                      class="prose prose-slate dark:prose-invert max-w-none overflow-hidden markdown-content"
                      style="word-wrap: break-word; word-break: normal;"
                    >
                      {@html parseMarkdown(message.content || "")}
                    </div>
                  </div>

                  <!-- File attachments display (PDFs, etc.) -->
                  {#if message.files && message.files.length > 0}
                    <div class="flex flex-col gap-2 w-full">
                      {#each message.files as file}
                        <div
                          class="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm"
                        >
                          <svg
                            class="w-4 h-4 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                            />
                          </svg>
                          <span class="truncate flex-1">{file.name}</span>
                          <span class="text-xs text-gray-500">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  <!-- User message image attachments (outside bubble) -->
                  {#if message.type === "image" && (message.imageId || message.imageUrl || message.imageData || message.imageIds || message.images)}
                    {@const imageCount = getImageCount(message)}
                    {@const allImages = getAllImages(message)}

                    {#if imageCount >= 2}
                      <!-- Multiple images - use carousel -->
                      <Carousel.Root class="w-full max-w-sm mx-8">
                        <Carousel.Content>
                          {#each allImages as image}
                            <Carousel.Item>
                              <div class="border rounded-lg overflow-hidden">
                                <img
                                  src={image.imageId
                                    ? `/api/images/${image.imageId}`
                                    : image.imageData
                                      ? `data:${image.mimeType};base64,${image.imageData}`
                                      : ""}
                                  alt={m["interface.uploaded_attachment"]()}
                                  class="w-full h-auto"
                                  loading="eager"
                                />
                              </div>
                            </Carousel.Item>
                          {/each}
                        </Carousel.Content>
                        <Carousel.Previous />
                        <Carousel.Next />
                      </Carousel.Root>
                    {:else if imageCount === 1}
                      <!-- Single image -->
                      <div class="border rounded-lg overflow-hidden max-w-sm">
                        <img
                          src={message.imageId
                            ? `/api/images/${message.imageId}`
                            : message.imageUrl ||
                              `data:${message.mimeType};base64,${message.imageData}`}
                          alt={m["interface.uploaded_attachment"]()}
                          class="w-full h-auto"
                          loading="eager"
                        />
                      </div>
                    {/if}
                  {/if}
                </div>
              </div>
            {:else}
              <!-- AI message - full width, no bubble -->
              <div class="w-full">
                {#if message.content || (!chatState.isLoading && !chatState.isStreamingContent)}
                  <div
                    class="text-sm font-medium mb-2 text-slate-600 dark:text-slate-400 italic"
                  >
                    {chatState.getModelDisplayName(
                      (message as any).model || chatState.selectedModel
                    )}
                  </div>
                {/if}

                {#if message.type === "image" && (message.imageId || message.imageUrl || message.imageData || message.imageIds || message.images)}
                  {@const imageCount = getImageCount(message)}
                  {@const allImages = getAllImages(message)}

                  <!-- Image message -->
                  <div class="space-y-3">
                    <div
                      class="prose prose-slate dark:prose-invert max-w-none overflow-hidden markdown-content"
                      style="word-wrap: break-word; word-break: normal;"
                    >
                      {@html parseMarkdown(message.content || "")}
                    </div>

                    {#if imageCount >= 2}
                      <!-- Multiple images - use carousel -->
                      <Carousel.Root class="w-full max-w-lg">
                        <Carousel.Content>
                          {#each allImages as image}
                            <Carousel.Item>
                              <div class="border rounded-lg overflow-hidden">
                                <img
                                  src={image.imageId
                                    ? `/api/images/${image.imageId}`
                                    : image.imageData
                                      ? `data:${image.mimeType};base64,${image.imageData}`
                                      : ""}
                                  alt=""
                                  class="w-full h-auto"
                                  loading="eager"
                                />
                              </div>
                            </Carousel.Item>
                          {/each}
                        </Carousel.Content>
                        <Carousel.Previous />
                        <Carousel.Next />
                      </Carousel.Root>
                    {:else if imageCount === 1}
                      <!-- Single image -->
                      <div class="border rounded-lg overflow-hidden max-w-lg">
                        <img
                          src={message.imageId
                            ? `/api/images/${message.imageId}`
                            : message.imageUrl ||
                              `data:${message.mimeType};base64,${message.imageData}`}
                          alt=""
                          class="w-full h-auto"
                          loading="eager"
                        />
                      </div>
                    {/if}
                  </div>
                {:else if message.type === "video" && message.videoId}
                  <!-- Video message -->
                  <div class="space-y-3">
                    <div
                      class="prose prose-slate dark:prose-invert max-w-none overflow-hidden markdown-content"
                      style="word-wrap: break-word; word-break: normal;"
                    >
                      {@html parseMarkdown(message.content || "")}
                    </div>
                    <div class="border rounded-lg overflow-hidden max-w-2xl">
                      <video
                        src={`/api/videos/${message.videoId}`}
                        class="w-full h-auto max-h-96"
                        controls
                        preload="metadata"
                        poster=""
                      >
                        Your browser does not support the video tag.
                        <track kind="captions" />
                      </video>
                    </div>
                  </div>
                {:else}
                  <!-- Text message -->
                  {#if message.content}
                    <div
                      class="prose prose-slate dark:prose-invert max-w-none overflow-hidden markdown-content"
                      style="word-wrap: break-word; word-break: normal;"
                    >
                      {@html parseMarkdown(message.content || "")}
                    </div>
                  {:else if chatState.isLoading && !chatState.isStreamingContent}
                    <!-- Show loading indicator for empty assistant message -->
                    <div class="flex items-center gap-3">
                      <Spinner class="size-6" />
                      <span class="text-sm text-muted-foreground">
                        {m["interface.generating_response"]()}
                      </span>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          {/each}

          {#if chatState.error}
            <div class="flex justify-center">
              <div
                class="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-4 py-2 text-sm"
              >
                Error: {chatState.error}
              </div>
            </div>
          {/if}

          <!-- Suggested Questions (shown after messages) -->
          {#if !chatState.isLoading}
            <div class="mt-6 pt-4 border-t border-border/50">
              <p class="text-xs text-muted-foreground mb-3">建議問題：</p>
              <div class="flex flex-wrap gap-2">
                {#each PROMPT_TEMPLATES as template}
                  <button
                    onclick={() => handlePromptTemplate(template.prompt)}
                    class="px-3 py-1.5 text-sm bg-muted/50 hover:bg-muted border border-border/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {template.title}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Chat input area -->
  <div class="flex-shrink-0 p-4 w-full flex justify-center">
    <div class="w-full max-w-3xl">
      <!-- Character Preset Selector & System Prompt Editor -->
      <div class="mb-3">
        <button
          onclick={() => (showSystemPrompt = !showSystemPrompt)}
          class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          {#if showSystemPrompt}
            <ChevronUpIcon class="w-4 h-4" />
          {:else}
            <ChevronDownIcon class="w-4 h-4" />
          {/if}
          <UsersIcon class="w-4 h-4" />
          <span>角色設定</span>
          {#if chatState.selectedCharacterPreset}
            <span
              class="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full"
            >
              {chatState.selectedCharacterPreset.name}
            </span>
          {:else if chatState.systemPrompt && !showSystemPrompt}
            <span
              class="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full"
            >
              自訂
            </span>
          {/if}
        </button>

        {#if showSystemPrompt}
          <div
            class="border rounded-lg p-3 bg-card space-y-3 animate-in fade-in duration-200"
          >
            <!-- Character Presets Section (only for logged-in users) -->
            {#if chatState.userId}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium">角色預設</span>
                  <button
                    onclick={() => chatState.openCharacterPresetModal()}
                    class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <PlusIcon class="w-3 h-3" />
                    新增角色
                  </button>
                </div>

                {#if chatState.isLoadingCharacterPresets}
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner class="w-4 h-4" />
                    載入中...
                  </div>
                {:else if chatState.characterPresets.length > 0}
                  <div class="space-y-3">
                    <!-- Preset buttons row -->
                    <div class="flex flex-wrap gap-2">
                      <!-- No selection option -->
                      <button
                        onclick={() => chatState.selectCharacterPreset(null)}
                        class="px-3 py-1.5 text-sm rounded-full border transition-colors {!chatState.selectedCharacterPresetId
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background hover:bg-accent border-border'}"
                      >
                        無
                      </button>
                      {#each chatState.characterPresets as preset}
                        <div class="group relative">
                          <button
                            onclick={() => chatState.selectCharacterPreset(preset.id)}
                            class="px-3 py-1.5 text-sm rounded-full border transition-colors {chatState.selectedCharacterPresetId === preset.id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-accent border-border'} {preset.isDefault ? 'ring-2 ring-yellow-400 ring-offset-1' : ''}"
                          >
                            {preset.name}
                            {#if preset.isDefault}
                              <span class="ml-1 text-xs">⭐</span>
                            {/if}
                          </button>
                          <!-- Edit/Delete buttons on hover -->
                          <div class="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                            <button
                              onclick={(e) => {
                                e.stopPropagation();
                                chatState.openCharacterPresetModal(preset);
                              }}
                              class="p-0.5 bg-background border rounded-full shadow-sm hover:bg-accent"
                              title="編輯"
                            >
                              <PencilIcon class="w-3 h-3" />
                            </button>
                            <button
                              onclick={(e) => {
                                e.stopPropagation();
                                if (confirm(`確定要刪除角色「${preset.name}」嗎？`)) {
                                  chatState.deleteCharacterPreset(preset.id);
                                }
                              }}
                              class="p-0.5 bg-background border rounded-full shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                              title="刪除"
                            >
                              <TrashIcon class="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>

                    <!-- Set as default button (only show when a non-default preset is selected) -->
                    {#if chatState.selectedCharacterPresetId}
                      {@const selectedPreset = chatState.characterPresets.find(p => p.id === chatState.selectedCharacterPresetId)}
                      {#if selectedPreset && !selectedPreset.isDefault}
                        <button
                          onclick={() => chatState.updateCharacterPreset(selectedPreset.id, { isDefault: true })}
                          class="text-sm px-3 py-1.5 border border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 rounded-lg transition-colors flex items-center gap-1"
                        >
                          ⭐ 將「{selectedPreset.name}」設為預設角色
                        </button>
                      {/if}
                    {/if}
                  </div>
                {:else}
                  <p class="text-xs text-muted-foreground">
                    尚無角色預設。點擊「新增角色」來建立你的第一個角色。
                  </p>
                {/if}
              </div>
              <div class="border-t pt-3"></div>
            {/if}

            <!-- Custom System Prompt -->
            <div class="space-y-2">
              <span class="text-sm font-medium">自訂 System Prompt</span>
              <textarea
                bind:value={chatState.systemPrompt}
                placeholder="輸入自訂的 system prompt 來個性化 AI 的行為（例如：「你是一個專業的程式設計助手，擅長解釋複雜的概念」）"
                class="w-full min-h-24 max-h-48 resize-y p-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              ></textarea>
              <div class="flex justify-between items-center">
                <p class="text-xs text-muted-foreground">
                  自訂此對話中 AI 的回應方式
                </p>
                {#if chatState.systemPrompt}
                  <button
                    onclick={() => {
                      chatState.systemPrompt = "";
                      chatState.selectedCharacterPresetId = null;
                    }}
                    class="text-xs text-muted-foreground hover:text-foreground"
                  >
                    清除
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Character Preset Modal -->
      {#if chatState.showCharacterPresetModal}
        {@const editingPreset = chatState.editingCharacterPreset}
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div class="bg-background border rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div class="p-4 border-b">
              <h3 class="text-lg font-semibold">
                {editingPreset ? '編輯角色' : '新增角色'}
              </h3>
            </div>
            {#key editingPreset?.id}
              <form
                onsubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const formData = new FormData(form);
                  const name = formData.get('name') as string;
                  const systemPrompt = formData.get('systemPrompt') as string;
                  const description = formData.get('description') as string;
                  const isDefault = formData.get('isDefault') === 'on';

                  let success: boolean;
                  if (editingPreset) {
                    success = await chatState.updateCharacterPreset(editingPreset.id, {
                      name,
                      systemPrompt,
                      description: description || undefined,
                      isDefault
                    });
                  } else {
                    success = await chatState.createCharacterPreset({
                      name,
                      systemPrompt,
                      description: description || undefined,
                      isDefault
                    });
                  }

                  if (success) {
                    chatState.closeCharacterPresetModal();
                  }
                }}
                class="p-4 space-y-4"
              >
                <div class="space-y-2">
                  <label for="preset-name" class="text-sm font-medium">角色名稱 *</label>
                  <input
                    id="preset-name"
                    name="name"
                    type="text"
                    required
                    value={editingPreset?.name ?? ''}
                    placeholder="例如：貓娘、專業顧問、傲嬌助手"
                    class="w-full p-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div class="space-y-2">
                  <label for="preset-prompt" class="text-sm font-medium">System Prompt *</label>
                  <textarea
                    id="preset-prompt"
                    name="systemPrompt"
                    required
                    placeholder="描述這個角色的個性、說話方式、專長等..."
                    class="w-full min-h-32 resize-y p-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >{editingPreset?.systemPrompt ?? ''}</textarea>
                </div>
                <div class="space-y-2">
                  <label for="preset-description" class="text-sm font-medium">描述（選填）</label>
                  <input
                    id="preset-description"
                    name="description"
                    type="text"
                    value={editingPreset?.description ?? ''}
                    placeholder="簡短描述這個角色的用途"
                    class="w-full p-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <input
                    id="preset-default"
                    name="isDefault"
                    type="checkbox"
                    checked={editingPreset?.isDefault ?? false}
                    class="rounded border-border"
                  />
                  <label for="preset-default" class="text-sm">設為預設角色</label>
                </div>
                <div class="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onclick={() => chatState.closeCharacterPresetModal()}
                  >
                    取消
                  </Button>
                  <Button type="submit">
                    {editingPreset ? '儲存' : '建立'}
                  </Button>
                </div>
              </form>
            {/key}
          </div>
        </div>
      {/if}

      <!-- Guest limitation indicator -->
      {#if !chatState.userId}
        <div class="mb-2 px-2 text-sm text-muted-foreground">
          <div class="flex items-center justify-between">
            <span>
              {m["interface.guest_mode_usage"]({
                used: chatState.guestMessageCount.toString(),
                limit: GUEST_MESSAGE_LIMIT.toString(),
              })}
            </span>
            {#if chatState.canGuestSendMessage()}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => (window.location.href = "/login")}
                class="h-7 underline px-2 cursor-pointer hover:bg-accent"
              >
                {m["interface.guest_login_prompt"]()}
              </Button>
            {:else}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => (window.location.href = "/login")}
                class="h-7 underline px-2 cursor-pointer hover:bg-accent text-orange-600 dark:text-orange-400"
              >
                {m["interface.guest_limit_reached"]()}
              </Button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Textarea with embedded model selector and send button -->
      <div class="relative w-full border bg-card rounded-2xl shadow-lg">
        <!-- Knowledge Graph button (top-right of input box) -->
        <button
          onclick={() => showKgDialog = true}
          class="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
        >
          <BrainIcon class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Knowledge Graph</span>
        </button>

        <textarea
          bind:this={textarea}
          bind:value={chatState.prompt}
          disabled={textareaDisabled}
          class="text-foreground placeholder:text-muted-foreground/60 max-h-80 min-h-36 w-full resize-none !overflow-y-auto bg-transparent px-5 pt-5 pb-14 text-base leading-6 outline-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 scrollbar-thin"
          placeholder={chatState.isLoading
            ? m["interface.generating_response"]()
            : m["interface.type_message_here"]()}
          name="message"
          onkeydown={handleKeyDown}
          autocomplete="off"
          {@attach autosize.attachment}
        ></textarea>

        <!-- Scroll to bottom button for textarea -->
        {#if notAtBottom.current}
          <button
            onclick={() => textareaScrollState.scrollToBottom()}
            class="absolute right-3 top-3 opacity-60 hover:opacity-100 transition-opacity mr-5 p-1 rounded bg-background/80 backdrop-blur-sm"
            type="button"
            aria-label={m["interface.scroll_to_bottom"]()}
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              ></path>
            </svg>
          </button>
        {/if}

        <!-- Controls wrapper with background to prevent text overlap -->
        <div
          class="absolute bottom-0 left-0 right-0 px-2 mx-3 h-14 bg-card pointer-events-none"
        >
          <!-- File Upload, Model selector, Tools buttons container -->
          <div
            class="absolute bottom-2 flex items-center gap-2 m-1 pointer-events-auto"
          >
            <!-- Upload button positioned in bottom left -->
            <div class="pointer-events-auto">
              <div class="relative">
                <button
                  id="file-upload-trigger"
                  popovertarget="file-upload-popover"
                  class="h-6 {chatState.attachedFiles.length > 0
                    ? 'w-auto px-3 bg-blue-500 hover:bg-blue-600 text-white'
                    : 'w-6 bg-transparent'} border-transparent cursor-pointer flex items-center rounded-md justify-center gap-1 transition-all duration-300 ease-in-out"
                  onclick={() => {
                    // Ensure positioning happens when button is clicked
                    const popover = document.getElementById(
                      "file-upload-popover"
                    );
                    const trigger = document.getElementById(
                      "file-upload-trigger"
                    );
                    if (popover && trigger) {
                      requestAnimationFrame(() => {
                        positionPopover(popover, trigger);
                      });
                    }
                  }}
                >
                  <SquarePlusIcon class="w-5 h-5 flex-shrink-0" />
                  {#if chatState.attachedFiles.length > 0}
                    <span class="text-xs font-medium whitespace-nowrap">
                      {chatState.attachedFiles.length}
                      {chatState.attachedFiles.length === 1
                        ? m["interface.file_singular"]()
                        : m["interface.files_plural"]()}
                    </span>
                  {/if}
                </button>

                <div
                  id="file-upload-popover"
                  popover="auto"
                  class="file-upload-popover w-80 max-h-[300px] overflow-y-auto p-4 bg-popover text-popover-foreground border rounded-md shadow-md"
                >
                  <div class="flex justify-between items-center mb-3">
                    <h3 class="text-sm font-medium cursor-default">
                      {m["interface.attach_files"]()}
                    </h3>
                    <button
                      class="text-muted-foreground hover:text-foreground"
                      onclick={() => {
                        document
                          .getElementById("file-upload-popover")
                          ?.hidePopover();
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <!-- File upload area - always at top -->
                  <FileUpload
                    onFilesSelected={handleFilesSelected}
                    acceptedTypes={[
                      "image/png",
                      "image/jpeg",
                      "image/jpg",
                      "image/gif",
                      "image/webp",
                      "text/plain",
                      "text/markdown",
                      "text/csv",
                      "application/json",
                      "application/pdf",
                    ]}
                    maxFiles={3 - chatState.attachedFiles.length}
                    class="mb-3"
                  />

                  <!-- Attached files list - below upload area -->
                  {#if chatState.attachedFiles.length > 0}
                    <div class="border-t pt-3 mt-3">
                      <h4 class="text-sm font-medium mb-2 cursor-default">
                        Attached Files ({chatState.attachedFiles.length})
                      </h4>
                      <div class="space-y-2 mb-3">
                        {#each chatState.attachedFiles as file}
                          <div
                            class="flex items-center justify-between gap-2 bg-muted/50 rounded px-3 py-2 cursor-default"
                          >
                            <div class="flex items-center gap-2 flex-1 min-w-0">
                              <span class="text-sm truncate">{file.name}</span>
                              <span class="text-xs text-muted-foreground"
                                >({(file.size / 1024).toFixed(1)}KB)</span
                              >
                            </div>
                            <button
                              onclick={() =>
                                chatState.removeAttachedFile(file.id)}
                              class="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-muted"
                              type="button"
                              aria-label={m["interface.remove_file"]()}
                            >
                              ✕
                            </button>
                          </div>
                        {/each}

                        <!-- Clear all button -->
                        <div class="flex justify-end pt-2">
                          <button
                            onclick={() => {
                              chatState.clearAttachedFiles();
                            }}
                            class="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded"
                          >
                            {m["interface.remove_all"]()}
                          </button>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Separate tooltip overlay -->
                <Tooltip.Provider>
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      class="absolute inset-0 pointer-events-none"
                    >
                      <span class="sr-only"
                        >{m["interface.attach_files_tooltip"]()}</span
                      >
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <p>{m["interface.attach_files_tooltip"]()}</p>
                    </Tooltip.Content>
                  </Tooltip.Root>
                </Tooltip.Provider>
              </div>
            </div>

            <!-- Model selector -->
            <button
              id="model-selector-trigger"
              popovertarget="model-selector-popover"
              class="text-sm h-6 border-transparent cursor-pointer ml-3 flex items-center gap-1"
              disabled={chatState.isLoadingModels}
              onclick={() => {
                // Ensure positioning happens when button is clicked
                const popover = document.getElementById(
                  "model-selector-popover"
                );
                const trigger = document.getElementById(
                  "model-selector-trigger"
                );
                if (popover && trigger) {
                  requestAnimationFrame(() => {
                    positionPopover(popover, trigger);
                  });
                }
              }}
            >
              <span
                class="truncate {chatState.isLoadingModels ? 'italic' : ''}"
              >
                {chatState.isLoadingModels
                  ? m["interface.loading"]()
                  : chatState.getModelDisplayName(chatState.selectedModel) ||
                    m["interface.select"]()}
              </span>
              <ChevronDownIcon class="w-4 h-4 flex-shrink-0" />
            </button>

            {#if !chatState.isLoadingModels}
              <div
                id="model-selector-popover"
                popover="auto"
                class="model-selector-popover w-[calc(100vw-16px)] sm:w-[580px] lg:w-[620px] max-w-[620px] max-h-96 overflow-y-auto p-4 bg-popover text-popover-foreground border rounded-md shadow-md"
              >
                <!-- Filter Header -->
                <div class="mb-4 pb-3 border-b">
                  <div class="flex items-center gap-6">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        bind:group={modelFilter}
                        value="all"
                        class="w-4 h-4 text-primary cursor-pointer"
                      />
                      <span class="text-sm font-light">All</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        bind:group={modelFilter}
                        value="images"
                        class="w-4 h-4 text-primary cursor-pointer"
                      />
                      <span class="text-sm font-light">Image generation</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        bind:group={modelFilter}
                        value="videos"
                        class="w-4 h-4 text-primary cursor-pointer"
                      />
                      <span class="text-sm font-light">Video generation</span>
                    </label>
                  </div>
                </div>

                <div class="space-y-4">
                  {#each filteredModelGroups as group}
                    <!-- Provider Group Header -->
                    <div class="space-y-3 cursor-default">
                      <div
                        class="flex items-center gap-2 p-2 bg-muted/50 rounded-md"
                      >
                        <div
                          class="inline-flex items-center justify-center w-5 h-5 rounded-full overflow-hidden"
                        >
                          {#if providerConfig[group.provider]?.iconPath}
                            <img
                              src={providerConfig[group.provider].iconPath}
                              alt="{group.provider} icon"
                              class="w-4 h-4 object-contain"
                            />
                          {:else}
                            <span class="text-xs">🤖</span>
                          {/if}
                        </div>
                        <span class="font-medium text-sm">{group.provider}</span
                        >
                      </div>

                      <!-- Model Cards Grid -->
                      <div
                        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                      >
                        {#each group.models as model}
                          {@const foundModel = chatState.models.find(
                            (m) => m.name === model.value
                          )}
                          {@const effectiveArchitecture = foundModel
                            ? model.architecture ||
                              getSyntheticArchitecture(foundModel)
                            : null}
                          {@const isSelected =
                            chatState.selectedModel === model.value}

                          {@const isLocked = foundModel?.isLocked || false}
                          <button
                            data-model-selector
                            onclick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();

                              // Validate and select model (includes lock validation)
                              if (!chatState.selectModel(model.value)) {
                                return;
                              }

                              // Close the popover after successful selection
                              document
                                .getElementById("model-selector-popover")
                                ?.hidePopover();
                            }}
                            disabled={isLocked}
                            class="p-3 border rounded-lg bg-card transition-colors text-left relative group {isSelected
                              ? 'ring-2 ring-primary bg-primary/5'
                              : ''} {isLocked
                              ? 'opacity-50 cursor-not-allowed bg-muted/50'
                              : 'cursor-pointer hover:bg-accent/50'}"
                          >
                            <!-- Provider icon (top-right corner) -->
                            <div
                              class="absolute top-2 right-2 w-4 h-4 group-hover:opacity-100
                              {isSelected ? 'opacity-100' : 'opacity-60'}"
                            >
                              {#if providerConfig[group.provider]?.iconPath}
                                <img
                                  src={providerConfig[group.provider].iconPath}
                                  alt="{group.provider} icon"
                                  class="w-full h-full object-contain"
                                />
                              {:else}
                                <span class="text-xs">🤖</span>
                              {/if}
                            </div>

                            <!-- Selected indicator -->
                            {#if isSelected}
                              <div class="absolute bottom-2 right-2">
                                <CircleCheckIcon class="w-6 h-6 text-primary" />
                              </div>
                            {/if}

                            <!-- Model name -->
                            <div class="pr-6 mb-3">
                              <h3
                                class="font-medium text-sm leading-tight truncate {isLocked
                                  ? 'text-muted-foreground'
                                  : ''}"
                                title={model.label}
                              >
                                {model.label}
                              </h3>
                              <!-- Always render lock message area for consistent layout -->
                              <p
                                class="text-xs text-muted-foreground mt-1 min-h-[16px]"
                              >
                                {#if isLocked}
                                  {#if !chatState.userId}
                                    {m["interface.sign_up_to_unlock"]()}
                                  {:else if chatState.userId && foundModel?.isDemoMode}
                                    {m["interface.not_available_in_demo"]()}
                                  {:else}
                                    {m["interface.sign_up_to_unlock"]()}
                                  {/if}
                                {:else}
                                  <!-- Empty space to maintain layout consistency -->
                                  &nbsp;
                                {/if}
                              </p>
                            </div>

                            <!-- Modality indicators -->
                            {#if effectiveArchitecture && (effectiveArchitecture.input_modalities.length > 0 || effectiveArchitecture.output_modalities.length > 0)}
                              <div class="space-y-1">
                                <!-- Input modalities -->
                                {#if effectiveArchitecture.input_modalities.length > 0}
                                  <div class="flex items-center gap-1">
                                    <span class="text-sm text-muted-foreground"
                                      >{m["interface.input_label"]()}:</span
                                    >
                                    <div class="flex gap-1">
                                      {#each effectiveArchitecture.input_modalities.slice(0, 4) as modality}
                                        {@const modalityConfig =
                                          getModalityConfig(modality)}
                                        <span
                                          class="inline-flex items-center justify-center w-5 h-5 rounded-full {modalityConfig.bgColor}"
                                          title={modalityConfig.tooltip}
                                        >
                                          <modalityConfig.icon
                                            class="w-2.5 h-2.5 {modalityConfig.iconColor}"
                                          />
                                        </span>
                                      {/each}
                                      {#if effectiveArchitecture.input_modalities.length > 4}
                                        <span
                                          class="text-xs text-muted-foreground"
                                          >+{effectiveArchitecture
                                            .input_modalities.length - 4}</span
                                        >
                                      {/if}
                                    </div>
                                  </div>
                                {/if}

                                <!-- Output modalities -->
                                {#if effectiveArchitecture.output_modalities.length > 0}
                                  <div class="flex items-center gap-1">
                                    <span class="text-sm text-muted-foreground"
                                      >{m["interface.output_label"]()}:</span
                                    >
                                    <div class="flex gap-1">
                                      {#each effectiveArchitecture.output_modalities.slice(0, 4) as modality}
                                        {@const modalityConfig =
                                          getModalityConfig(modality)}
                                        <span
                                          class="inline-flex items-center justify-center w-5 h-5 rounded-full {modalityConfig.bgColor}"
                                          title={modalityConfig.tooltip}
                                        >
                                          <modalityConfig.icon
                                            class="w-2.5 h-2.5 {modalityConfig.iconColor}"
                                          />
                                        </span>
                                      {/each}
                                      {#if effectiveArchitecture.output_modalities.length > 4}
                                        <span
                                          class="text-xs text-muted-foreground"
                                          >+{effectiveArchitecture
                                            .output_modalities.length - 4}</span
                                        >
                                      {/if}
                                    </div>
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Tools selector -->
            <Select.Root type="single" bind:value={chatState.selectedTool}>
              <Select.Trigger
                class="h-6 text-sm {chatState.selectedTool
                  ? 'border-dashed border-blue-500'
                  : 'border-transparent'} cursor-pointer bg-transparent dark:bg-transparent hover:bg-transparent dark:hover:bg-transparent [&>svg:last-child]:hidden"
              >
                <Settings2Icon />
              </Select.Trigger>
              <Select.Content class="max-h-40">
                {#each getAllToolNames() as toolName}
                  <Select.Item value={toolName} class="cursor-pointer">
                    <div class="flex flex-col">
                      <span class="font-medium"
                        >{getToolDisplayName(toolName)}</span
                      >
                    </div>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>

            <!-- Selected tool display button (only visible when tool is selected) -->
            {#if chatState.selectedTool}
              <Button
                variant="secondary"
                size="sm"
                onclick={() => chatState.clearSelectedTool()}
                class="h-7 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl hidden sm:flex items-center gap-1 text-xs cursor-pointer"
                aria-label="Clear tool selection: {getToolDisplayName(
                  chatState.selectedTool
                )}"
              >
                <span class="truncate max-w-25"
                  >{getToolDisplayName(chatState.selectedTool)}</span
                >
                <XIcon class="w-3 h-3 flex-shrink-0" />
              </Button>
            {/if}
          </div>

          <!-- Send button positioned in bottom right -->
          <Button
            onclick={() => chatState.handleSubmit()}
            disabled={sendButtonDisabled}
            class="absolute bottom-2 right-2 h-9 w-9 m-1 bg-primary/90 hover:bg-primary backdrop-blur-sm rounded-lg cursor-pointer disabled:pointer-events-auto disabled:cursor-not-allowed pointer-events-auto"
            size="icon"
            aria-label={chatState.isLoading
              ? m["interface.sending"]()
              : m["interface.send_message"]()}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  </div>

  <!-- Knowledge Graph Dialog -->
  {#if showKgDialog}
    <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick={() => showKgDialog = false}>
      <div class="bg-background border rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col" onclick={(e) => e.stopPropagation()}>
        <!-- Header -->
        <div class="flex justify-between items-center p-4 border-b">
          <h2 class="text-xl font-semibold">Interactive Knowledge Graph</h2>
          <button onclick={() => showKgDialog = false} class="text-muted-foreground hover:text-foreground">
            <XIcon class="w-5 h-5" />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-auto p-4">
          {#if !graphGenerated}
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium mb-2">Max Nodes</label>
                  <input
                    type="number"
                    bind:value={maxNodes}
                    min="10"
                    max="500"
                    class="w-full px-3 py-2 border rounded-lg bg-background"
                  />
                  <p class="text-xs text-muted-foreground mt-1">Number of nodes to display (10-500)</p>
                </div>
                <div>
                  <label class="block text-sm font-medium mb-2">Min Degree</label>
                  <input
                    type="number"
                    bind:value={minDegree}
                    min="0"
                    max="10"
                    class="w-full px-3 py-2 border rounded-lg bg-background"
                  />
                  <p class="text-xs text-muted-foreground mt-1">Filter nodes by minimum connections</p>
                </div>
              </div>
              <button
                onclick={generateInteractiveGraph}
                disabled={generatingGraph}
                class="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingGraph ? 'Generating...' : 'Generate Interactive Visualization'}
              </button>
              {#if kgError}
                <p class="text-sm text-red-500">{kgError}</p>
              {/if}
            </div>
          {:else}
            <div class="space-y-4">
              <div class="border rounded-lg overflow-hidden">
                <iframe
                  src="/api/rag{graphUrl}"
                  title="Interactive Knowledge Graph"
                  class="w-full h-[600px]"
                  sandbox="allow-scripts allow-same-origin"
                ></iframe>
              </div>
              <p class="text-sm text-muted-foreground text-center">
                Zoom with mouse wheel, drag to pan, click and drag nodes to explore the knowledge graph
              </p>
              <button
                onclick={() => {
                  graphGenerated = false;
                  graphUrl = '';
                }}
                class="w-full px-4 py-2 border rounded-lg hover:bg-muted"
              >
                Generate New Visualization
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  /* Native HTML Popover Positioning and Performance Optimization */
  .model-selector-popover:popover-open {
    position: fixed;
    max-height: 550px;
    z-index: 50;

    /* Performance optimizations for Firefox scroll lag */
    will-change: transform, scroll-position;
    contain: layout style paint;
    transform: translateZ(0); /* Force hardware acceleration fallback */

    /* Smooth scrolling optimizations */
    -webkit-overflow-scrolling: touch; /* iOS Safari smooth scrolling */
    scroll-behavior: smooth;
    overscroll-behavior: contain;

    /* Initial positioning - will be overridden by JavaScript */
    top: 0;
    left: 0;
  }

  .file-upload-popover:popover-open {
    position: fixed;
    max-height: 415px;
    z-index: 50;

    /* Performance optimizations */
    will-change: transform;
    contain: layout style paint;
    transform: translateZ(0);

    /* Initial positioning - will be overridden by JavaScript */
    left: 0;
  }

  /* Optimize individual model cards for paint performance */
  .model-selector-popover [data-model-selector] {
    contain: paint;
    /* Avoid triggering layout/paint during scroll */
    will-change: auto;
  }

  /* Reduce paint complexity on hover to prevent scroll lag */
  .model-selector-popover [data-model-selector]:hover {
    transform: translateZ(0);
  }
</style>
