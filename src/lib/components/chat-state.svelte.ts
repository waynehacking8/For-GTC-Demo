import { goto } from "$app/navigation";
import { browser } from "$app/environment";
import type { AIModelConfig, AIMessage, AIResponse } from "$lib/ai/types.js";
import { isMultimodal } from "$lib/ai/types.js";
import { toast } from "svelte-sonner";
import { GUEST_MESSAGE_LIMIT, GUEST_ALLOWED_MODELS } from "$lib/constants/guest-limits.js";

// File attachment types
export interface AttachedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  content?: string; // For text files
  uploadedImageId?: string; // After upload to server
  uploadedImageUrl?: string; // Public URL after upload (presigned R2 URL or static path)
  uploadedToRAG?: boolean; // For PDF files uploaded to RAG
  ragDocumentId?: string; // RAG document ID after upload
}

export class ChatState {
  // Chat state
  prompt = $state("");
  selectedModel = $state("google/gemma-3-27b-it:free");
  isLoading = $state(false);
  isStreamingContent = $state(false);
  messages = $state<AIMessage[]>([]);
  error = $state<string | null>(null);
  models = $state<AIModelConfig[]>([]);
  currentChatId = $state<string | null>(null);
  userId = $state<string | null>(null);
  systemPrompt = $state<string>("");
  chatHistory = $state<
    Array<{
      id: string;
      title: string;
      model: string;
      pinned: boolean;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);

  // Loading states
  isLoadingChat = $state(false);
  isLoadingChatData = $state(false);
  isLoadingModels = $state(true); // Add loading state for models

  // UI states
  editingChatId = $state<string | null>(null);
  editingTitle = $state("");
  deletingChatId = $state<string | null>(null);
  showModelChangeDialog = $state(false);
  pendingModelChange = $state<string | null>(null);

  // Track previous model to detect changes
  previousModel = $state<string | null>(null);

  // File attachment state
  attachedFiles = $state<AttachedFile[]>([]);
  isUploadingFiles = $state(false);

  // Guest user limitations
  guestMessageCount = $state(0);

  // Tool selection
  selectedTool = $state<string | undefined>(undefined);

  // Track fresh chat creation to preserve tool selection
  isFreshChat = $state(false);

  // Character presets
  characterPresets = $state<Array<{
    id: string;
    name: string;
    systemPrompt: string;
    description?: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  }>>([]);
  selectedCharacterPresetId = $state<string | null>(null);
  isLoadingCharacterPresets = $state(false);
  showCharacterPresetModal = $state(false);
  editingCharacterPreset = $state<{
    id: string;
    name: string;
    systemPrompt: string;
    description?: string;
    isDefault: boolean;
  } | null>(null);

  constructor() {
    // Auto-load models when state is created
    if (browser) {
      this.loadModels();
      this.loadGuestMessageCount();
      // Note: chat history will be loaded when session is established
    }
  }

  // Set up session reactivity - call this from the layout when session changes
  setupSessionReactivity(getSession: () => any) {
    if (!browser) return;

    let previousSessionId: string | null = null;

    $effect(() => {
      const session = getSession();
      const currentSessionId = session?.user?.id || null;

      // Update userId state
      this.userId = currentSessionId;

      // Only reload if session actually changed
      if (currentSessionId !== previousSessionId) {
        previousSessionId = currentSessionId;
        if (currentSessionId) {
          // User logged in, load chat history, character presets, and reset guest count
          this.loadChatHistory();
          this.loadCharacterPresets();
          this.resetGuestMessageCount();
          this.loadModels(); // Reload models to get full access
        } else {
          // User logged out, clear chat history and character presets, load guest count
          this.chatHistory = [];
          this.characterPresets = [];
          this.selectedCharacterPresetId = null;
          this.loadGuestMessageCount();
          this.loadModels(); // Reload models to get restricted access
        }
      }
    });
  }

  // Function to clean and normalize message content
  cleanMessageContent(content: string): string {
    return content
      .trim() // Remove leading/trailing whitespace
      .replace(/[ \t]{3,}/g, " ") // Replace 3+ consecutive spaces/tabs with single space
      .replace(/\n{3,}/g, "\n\n") // Replace 3+ consecutive newlines with double newline
      .replace(/[ \t]+\n/g, "\n") // Remove trailing spaces before newlines
      .replace(/\n[ \t]+/g, "\n"); // Remove leading spaces after newlines
  }

  // Load models from API
  async loadModels() {
    try {
      this.isLoadingModels = true;
      const response = await fetch("/api/models");
      if (response.ok) {
        const data = await response.json();
        this.models = data.models;

        // Set default model based on user login status
        if (this.models.length > 0) {
          if (!this.userId) {
            // Non-logged in user: try to use first configured guest model
            const firstConfiguredGuestModel = GUEST_ALLOWED_MODELS.find(modelName =>
              this.models.some(m => m.name === modelName)
            );

            if (firstConfiguredGuestModel) {
              this.selectedModel = firstConfiguredGuestModel;
            } else {
              // Fallback: find first guest-allowed model from the models list
              const firstGuestAllowed = this.models.find(m => m.isGuestAllowed);
              if (firstGuestAllowed) {
                this.selectedModel = firstGuestAllowed.name;
                console.warn(`Configured guest models not found, using fallback: ${firstGuestAllowed.name}`);
              } else {
                // Last resort: use first available model but log warning
                this.selectedModel = this.models[0].name;
                console.warn(`No guest-allowed models found, using fallback: ${this.models[0].name}`);
              }
            }
          } else if (!this.selectedModel) {
            // Logged in user: use first available model if none selected
            this.selectedModel = this.models[0].name;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      // Add a small delay to ensure model enrichment completes
      setTimeout(() => {
        this.isLoadingModels = false;
      }, 1500); // Wait for OpenRouter enrichment to complete
    }
  }

  // Load guest message count from sessionStorage
  loadGuestMessageCount() {
    if (!browser || this.userId) return;

    try {
      const stored = sessionStorage.getItem('guestMessageCount');
      this.guestMessageCount = stored ? parseInt(stored, 10) : 0;
    } catch (err) {
      console.warn('Failed to load guest message count:', err);
      this.guestMessageCount = 0;
    }
  }

  // Save guest message count to sessionStorage
  saveGuestMessageCount() {
    if (!browser || this.userId) return;

    try {
      sessionStorage.setItem('guestMessageCount', this.guestMessageCount.toString());
    } catch (err) {
      console.warn('Failed to save guest message count:', err);
    }
  }

  // Check if guest has reached message limit
  canGuestSendMessage(): boolean {
    if (this.userId) return true; // Logged in users have no limit
    return this.guestMessageCount < GUEST_MESSAGE_LIMIT;
  }

  // Increment guest message count
  incrementGuestMessageCount() {
    if (!this.userId) {
      this.guestMessageCount++;
      this.saveGuestMessageCount();
    }
  }

  // Reset guest message count (when user logs in)
  resetGuestMessageCount() {
    this.guestMessageCount = 0;
    if (browser) {
      try {
        sessionStorage.removeItem('guestMessageCount');
      } catch (err) {
        console.warn('Failed to clear guest message count:', err);
      }
    }
  }

  // Validate model selection using server-provided flags
  validateModelSelection(modelName: string): boolean {
    const model = this.models.find(m => m.name === modelName);
    if (!model) {
      console.warn(`Model ${modelName} not found in available models`);
      return false;
    }

    // Use the isLocked flag that's set by the server based on user status and demo mode
    return !model.isLocked;
  }

  // Safe model selection with validation
  selectModel(modelName: string): boolean {
    if (!this.validateModelSelection(modelName)) {
      const model = this.models.find(m => m.name === modelName);
      let errorMsg: string;

      if (!this.userId) {
        // Guest user error message
        errorMsg = "Guest users can only use the allowed guest models. Please sign up for access to all models.";
      } else if (this.userId && model?.isDemoMode) {
        // Demo mode error message (logged in user in demo mode)
        errorMsg = "This model is not available in Demo Mode. Contact administrator for full access.";
      } else {
        // Fallback error message
        errorMsg = "This model is not available with your current access level.";
      }

      this.error = errorMsg;
      toast.error(errorMsg);
      return false;
    }

    this.selectedModel = modelName;
    this.error = null;
    return true;
  }

  // Load chat history from API
  async loadChatHistory() {
    try {
      const response = await fetch("/api/chats");
      if (response.ok) {
        const data = await response.json();
        this.chatHistory = data.chats;
      } else if (response.status === 401) {
        // User not authenticated, clear chat history
        this.chatHistory = [];
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  }

  // Refresh chat history (useful when auth state changes)
  async refreshChatHistory() {
    await this.loadChatHistory();
  }

  // Generate chat title from first message
  generateChatTitle(content: string): string {
    const words = content.trim().split(" ").slice(0, 6);
    return (
      words.join(" ") + (content.trim().split(" ").length > 6 ? "..." : "")
    );
  }

  // Format date for display (shows in user's local timezone)
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    // Normalize dates to start of day for accurate comparison
    const normalizeDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const normalizedDate = normalizeDate(date);
    const normalizedToday = normalizeDate(today);
    const normalizedYesterday = normalizeDate(yesterday);

    if (normalizedDate.getTime() === normalizedToday.getTime()) {
      return "Today";
    } else if (normalizedDate.getTime() === normalizedYesterday.getTime()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString();
    }
  }

  // Load chat from URL (no URL update needed)
  async loadChatFromId(chatId: string) {
    if (this.isLoadingChat) return;

    try {
      this.isLoadingChat = true;
      this.isLoadingChatData = true;

      const response = await fetch(`/api/chats/${chatId}`);
      if (response.ok) {
        const data = await response.json();

        // Clear current state first for smooth transition
        this.messages = [];
        this.error = null;
        this.currentChatId = chatId;
        this.clearSelectedTool(); // Clear tool selection when loading existing chat
        this.resetFreshChatFlag(); // Reset fresh chat flag for existing chat loads

        // Small delay to ensure smooth transition
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Set model first, then messages to avoid triggering the dialog
        this.selectedModel = data.chat.model;
        this.previousModel = data.chat.model; // Update previous model to match
        // Load system prompt
        this.systemPrompt = data.chat.systemPrompt || '';
        // Clean all message content when loading from database
        this.messages = data.chat.messages.map((msg: AIMessage) => ({
          ...msg,
          content: this.cleanMessageContent(msg.content || ''),
        }));

        // Refresh chat history to show updated order
        this.loadChatHistory();
        return true;
      } else {
        return false; // Chat not found or unauthorized
      }
    } catch (err) {
      console.error("Failed to load chat:", err);
      this.error = "Failed to load chat";
      return false;
    } finally {
      this.isLoadingChat = false;
      this.isLoadingChatData = false;
    }
  }

  // Load chat and update URL (for navigation from sidebar)
  async loadChat(chatId: string) {
    // Skip loading if this chat is already active
    if (this.currentChatId === chatId) {
      // Still ensure URL is correct
      goto(`/chat/${chatId}`, { replaceState: true, noScroll: true });
      return;
    }

    const success = await this.loadChatFromId(chatId);
    if (success) {
      // Update URL to new route structure
      goto(`/chat/${chatId}`, { replaceState: true, noScroll: true });
    }
  }

  // Start new chat
  startNewChat() {
    // Set loading flag to prevent model change dialog
    this.isLoadingChatData = true;
    // Clear chat state
    this.currentChatId = null;
    this.messages = [];
    this.error = null;
    this.clearSelectedTool(); // Clear tool selection when starting new chat
    this.resetFreshChatFlag(); // Reset fresh chat flag when starting new chat
    // Sync previous model with current selection
    this.previousModel = this.selectedModel;

    // Apply default character preset for new chat
    const defaultPreset = this.characterPresets.find(p => p.isDefault);
    if (defaultPreset) {
      this.selectedCharacterPresetId = defaultPreset.id;
      this.systemPrompt = defaultPreset.systemPrompt;
    } else {
      // No default preset, clear system prompt
      this.selectedCharacterPresetId = null;
      this.systemPrompt = '';
    }

    // Navigate to new chat page
    goto("/newchat", { replaceState: true, noScroll: true });
    // Reset loading flag
    this.isLoadingChatData = false;
  }

  // Save or update chat
  async saveChat() {
    if (this.messages.length === 0) return;

    try {
      const title = this.generateChatTitle(this.messages[0].content || 'Untitled Chat');

      if (this.currentChatId) {
        // Update existing chat
        const response = await fetch(`/api/chats/${this.currentChatId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model: this.selectedModel,
            messages: this.messages,
            systemPrompt: this.systemPrompt || null,
          }),
        });

        if (response.ok) {
          const updatedChat = await response.json();

          // Update the chat in local state immediately for better UX
          const chatIndex = this.chatHistory.findIndex(
            (chat) => chat.id === this.currentChatId
          );
          if (chatIndex !== -1) {
            // Update the existing chat and move it to the top
            const updated = { ...this.chatHistory[chatIndex], ...updatedChat.chat };
            this.chatHistory = [
              updated,
              ...this.chatHistory.filter((chat) => chat.id !== this.currentChatId),
            ];
          }
          // Also refresh from server to ensure consistency
          this.loadChatHistory();
        }
      } else {
        // Create new chat
        const response = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model: this.selectedModel,
            messages: this.messages,
            systemPrompt: this.systemPrompt || null,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          this.currentChatId = data.chat.id;
          this.markAsFreshChat(); // Mark as fresh chat to preserve tool selection
          // Update URL to reflect the new chat with new route structure
          goto(`/chat/${data.chat.id}`, {
            replaceState: true,
            noScroll: true,
          });
          this.loadChatHistory(); // Refresh chat history
        }
      }
    } catch (err) {
      console.error("Failed to save chat:", err);
    }
  }

  // Save or update a specific chat by ID (used to prevent race conditions)
  async saveChatById(chatId: string | null, messages: AIMessage[], model: string): Promise<{ chatId: string | null }> {
    if (messages.length === 0) return { chatId };

    try {
      const title = this.generateChatTitle(messages[0].content || 'Untitled Chat');

      if (chatId) {
        // Update existing chat
        const response = await fetch(`/api/chats/${chatId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model,
            messages,
          }),
        });

        if (response.ok) {
          const updatedChat = await response.json();

          // Only update local state if this is still the current chat
          if (this.currentChatId === chatId) {
            const chatIndex = this.chatHistory.findIndex(
              (chat) => chat.id === chatId
            );
            if (chatIndex !== -1) {
              const updated = { ...this.chatHistory[chatIndex], ...updatedChat.chat };
              this.chatHistory = [
                updated,
                ...this.chatHistory.filter((chat) => chat.id !== chatId),
              ];
            }
          }

          // Refresh chat history for consistency
          this.loadChatHistory();
          return { chatId };
        }
      } else {
        // Create new chat
        const response = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            model,
            messages
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const newChatId = data.chat.id;

          // Only update current state if user hasn't navigated away
          if (this.currentChatId === null) {
            this.currentChatId = newChatId;
            this.markAsFreshChat();
            goto(`/chat/${newChatId}`, {
              replaceState: true,
              noScroll: true,
            });
          }

          this.loadChatHistory();
          return { chatId: newChatId };
        }
      }

      return { chatId };
    } catch (err) {
      console.error("Failed to save chat by ID:", err);
      return { chatId };
    }
  }

  // Start delete process - show confirmation dialog
  startDeleteChat(chatId: string) {
    this.deletingChatId = chatId;
  }

  // Cancel delete process
  cancelDelete() {
    this.deletingChatId = null;
  }

  // Handle model change confirmation
  confirmModelChange() {
    if (this.pendingModelChange) {
      this.selectedModel = this.pendingModelChange;
      this.previousModel = this.pendingModelChange;
      this.startNewChat();
    }
    this.showModelChangeDialog = false;
    this.pendingModelChange = null;
  }

  // Cancel model change
  cancelModelChange() {
    this.showModelChangeDialog = false;
    this.pendingModelChange = null;
  }

  // Confirm and delete chat
  async confirmDeleteChat() {
    if (!this.deletingChatId) return;

    try {
      const response = await fetch(`/api/chats/${this.deletingChatId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Show success toast
        toast.success("Chat deleted successfully");

        // If deleting current chat, clear state and go to new chat
        if (this.currentChatId === this.deletingChatId) {
          this.currentChatId = null;
          this.messages = [];
          this.error = null;
          goto("/newchat", { replaceState: true, noScroll: true });
        }
        this.loadChatHistory();
      } else {
        // Show error toast for failed deletion
        toast.error("Failed to delete chat");
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
      toast.error("Failed to delete chat");
    } finally {
      this.deletingChatId = null;
    }
  }

  // Toggle pin status for a chat
  async toggleChatPin(chatId: string) {
    try {
      const response = await fetch(`/api/chats/${chatId}/pin`, {
        method: "PATCH",
      });

      if (response.ok) {
        const { chat } = await response.json();
        // Show success toast
        toast.success(chat.pinned ? "Chat pinned" : "Chat unpinned");
        // Refresh chat history to reflect changes
        this.loadChatHistory();
      } else {
        toast.error("Failed to update pin status");
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      toast.error("Failed to update pin status");
    }
  }

  // Derived state for pinned chats
  get pinnedChats() {
    return this.chatHistory.filter(chat => chat.pinned);
  }

  // Derived state for unpinned chats (recent chats)
  get recentChats() {
    return this.chatHistory.filter(chat => !chat.pinned);
  }

  // Start editing chat title
  startEditingTitle(chatId: string, currentTitle: string) {
    this.editingChatId = chatId;
    this.editingTitle = currentTitle;
  }

  // Cancel editing
  cancelEditing() {
    this.editingChatId = null;
    this.editingTitle = "";
  }

  // Save renamed chat title
  async saveRenamedTitle(chatId: string) {
    if (!this.editingTitle.trim()) return;

    try {
      // Get the full chat data first
      const chatResponse = await fetch(`/api/chats/${chatId}`);
      if (!chatResponse.ok) {
        toast.error("Failed to rename chat");
        return;
      }

      const chatData = await chatResponse.json();

      const response = await fetch(`/api/chats/${chatId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: this.editingTitle.trim(),
          model: chatData.chat.model,
          messages: chatData.chat.messages,
        }),
      });

      if (response.ok) {
        toast.success("Chat renamed successfully");
        this.cancelEditing();
        this.loadChatHistory();
      } else {
        toast.error("Failed to rename chat");
      }
    } catch (err) {
      console.error("Failed to rename chat:", err);
      toast.error("Failed to rename chat");
    }
  }

  // File attachment methods
  addAttachedFiles(files: AttachedFile[]) {
    this.attachedFiles = [...this.attachedFiles, ...files];
  }

  removeAttachedFile(fileId: string) {
    this.attachedFiles = this.attachedFiles.filter(f => f.id !== fileId);
  }

  clearAttachedFiles() {
    this.attachedFiles = [];
  }

  async uploadAttachedFiles(): Promise<void> {
    if (this.attachedFiles.length === 0) return;

    this.isUploadingFiles = true;

    try {
      for (const file of this.attachedFiles) {
        if (file.type.startsWith('image/') && !file.uploadedImageId) {
          // Upload image files to server
          const formData = new FormData();
          formData.append('file', file.file);

          // Convert file to base64 for API
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1]; // Remove data URL prefix
              resolve(base64Data);
            };
            reader.onerror = reject;
          });
          reader.readAsDataURL(file.file);

          const base64Data = await base64Promise;

          const response = await fetch('/api/images', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imageData: base64Data,
              mimeType: file.type,
              filename: file.name,
              chatId: this.currentChatId
            })
          });

          if (response.ok) {
            const result = await response.json();
            file.uploadedImageId = result.imageId;
            file.uploadedImageUrl = result.imageUrl;
          } else {
            throw new Error(`Failed to upload ${file.name}`);
          }
        } else if (file.type === 'application/pdf' && !file.uploadedToRAG) {
          // Upload PDF files to RAG API (SvelteKit proxy expects 'files')
          const formData = new FormData();
          formData.append('files', file.file);  // SvelteKit proxy handles conversion to 'file' for single uploads

          const response = await fetch('/api/rag/documents/upload', {
            method: 'POST',
            body: formData
          });

          if (response.ok) {
            const result = await response.json();
            file.uploadedToRAG = true;
            file.ragDocumentId = result.file_path || result.document_id;
            // Store OCR extracted content if available
            if (result.stats && result.stats.content) {
              file.content = result.stats.content;
            }
          } else {
            const errorText = await response.text();
            throw new Error(`Failed to upload PDF ${file.name}: ${errorText}`);
          }
        }
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error('Failed to upload files');
      throw error;
    } finally {
      this.isUploadingFiles = false;
    }
  }

  // Check if selected model supports image input
  selectedModelSupportsImageInput(): boolean {
    const model = this.models.find(m => m.name === this.selectedModel);
    return model?.supportsImageInput === true;
  }

  // Check if any attached files are images
  hasImageAttachments(): boolean {
    return this.attachedFiles.some(f => f.type.startsWith('image/'));
  }

  // Check if any attached files are text
  hasTextAttachments(): boolean {
    return this.attachedFiles.some(f =>
      f.type.startsWith('text/') || f.type === 'application/json'
    );
  }

  // Tool selection methods
  /**
   * Set the selected tool for the current chat session.
   */
  setSelectedTool(tool: string | undefined) {
    this.selectedTool = tool;
  }

  /**
   * Clear the currently selected tool.
   */
  clearSelectedTool() {
    this.selectedTool = undefined;
  }

  /**
   * Mark the current chat as freshly created to preserve tool selection during navigation.
   * This flag is used to distinguish between new chat creation (tool persists) and
   * existing chat navigation (tool clears).
   */
  markAsFreshChat() {
    this.isFreshChat = true;
  }

  /**
   * Reset the fresh chat flag. This should be called after handling the fresh chat state
   * or when navigating to ensure the flag doesn't persist incorrectly.
   */
  resetFreshChatFlag() {
    this.isFreshChat = false;
  }

  // Character preset methods

  /**
   * Load character presets from API
   */
  async loadCharacterPresets() {
    if (!this.userId) return;

    try {
      this.isLoadingCharacterPresets = true;
      const response = await fetch('/api/character-presets');
      if (response.ok) {
        const data = await response.json();
        this.characterPresets = data.presets;

        // Auto-select default preset if exists and no preset currently selected
        if (!this.selectedCharacterPresetId) {
          const defaultPreset = this.characterPresets.find(p => p.isDefault);
          if (defaultPreset) {
            this.selectCharacterPreset(defaultPreset.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load character presets:', err);
    } finally {
      this.isLoadingCharacterPresets = false;
    }
  }

  /**
   * Select a character preset and apply its system prompt
   * If there's existing conversation history, start a new chat to avoid context confusion
   */
  selectCharacterPreset(presetId: string | null) {
    // Check if we're switching to a different preset and have conversation history
    const isSwitching = presetId !== this.selectedCharacterPresetId;
    const hasConversation = this.messages.length > 0;

    // If switching preset during an active conversation, start a new chat first
    if (isSwitching && hasConversation) {
      // Clear current conversation state without navigating
      this.currentChatId = null;
      this.messages = [];
      this.error = null;
      this.clearSelectedTool();
      this.resetFreshChatFlag();
      this.previousModel = this.selectedModel;

      // Navigate to new chat
      goto("/newchat", { replaceState: true, noScroll: true });
    }

    this.selectedCharacterPresetId = presetId;

    if (presetId) {
      const preset = this.characterPresets.find(p => p.id === presetId);
      if (preset) {
        this.systemPrompt = preset.systemPrompt;
      }
    } else {
      // Clear system prompt when no preset selected
      this.systemPrompt = '';
    }
  }

  /**
   * Create a new character preset
   */
  async createCharacterPreset(data: {
    name: string;
    systemPrompt: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<boolean> {
    try {
      const response = await fetch('/api/character-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        const { preset } = await response.json();
        // Reload presets to get updated list
        await this.loadCharacterPresets();
        toast.success(`角色「${preset.name}」已建立`);
        return true;
      } else {
        const error = await response.json();
        toast.error(error.error || '建立角色失敗');
        return false;
      }
    } catch (err) {
      console.error('Failed to create character preset:', err);
      toast.error('建立角色失敗');
      return false;
    }
  }

  /**
   * Update an existing character preset
   */
  async updateCharacterPreset(id: string, data: {
    name?: string;
    systemPrompt?: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<boolean> {
    try {
      const response = await fetch(`/api/character-presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        const { preset } = await response.json();
        // Reload presets to get updated list
        await this.loadCharacterPresets();

        // If updating currently selected preset, update system prompt
        if (this.selectedCharacterPresetId === id) {
          this.systemPrompt = preset.systemPrompt;
        }

        // If setting this preset as default, automatically select it
        if (data.isDefault && preset.isDefault) {
          this.selectCharacterPreset(preset.id);
        }

        toast.success(`角色「${preset.name}」已更新`);
        return true;
      } else {
        const error = await response.json();
        toast.error(error.error || '更新角色失敗');
        return false;
      }
    } catch (err) {
      console.error('Failed to update character preset:', err);
      toast.error('更新角色失敗');
      return false;
    }
  }

  /**
   * Delete a character preset
   */
  async deleteCharacterPreset(id: string): Promise<boolean> {
    try {
      const preset = this.characterPresets.find(p => p.id === id);
      const response = await fetch(`/api/character-presets/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // If deleting currently selected preset, clear selection
        if (this.selectedCharacterPresetId === id) {
          this.selectedCharacterPresetId = null;
          this.systemPrompt = '';
        }

        // Reload presets
        await this.loadCharacterPresets();
        toast.success(`角色「${preset?.name || ''}」已刪除`);
        return true;
      } else {
        const error = await response.json();
        toast.error(error.error || '刪除角色失敗');
        return false;
      }
    } catch (err) {
      console.error('Failed to delete character preset:', err);
      toast.error('刪除角色失敗');
      return false;
    }
  }

  /**
   * Open the character preset modal for creating/editing
   */
  openCharacterPresetModal(preset?: {
    id: string;
    name: string;
    systemPrompt: string;
    description?: string;
    isDefault: boolean;
  }) {
    if (preset) {
      this.editingCharacterPreset = { ...preset };
    } else {
      this.editingCharacterPreset = null;
    }
    this.showCharacterPresetModal = true;
  }

  /**
   * Close the character preset modal
   */
  closeCharacterPresetModal() {
    this.showCharacterPresetModal = false;
    this.editingCharacterPreset = null;
  }

  /**
   * Get currently selected preset
   */
  get selectedCharacterPreset() {
    if (!this.selectedCharacterPresetId) return null;
    return this.characterPresets.find(p => p.id === this.selectedCharacterPresetId) || null;
  }

  // Submit chat message
  async handleSubmit() {
    if ((!this.prompt && this.attachedFiles.length === 0) || this.isLoading) return;

    // Capture the current chat ID and model at the start of the request
    // This ensures we save to the correct chat even if the user navigates away
    const requestChatId = this.currentChatId;
    const requestModel = this.selectedModel;
    let actualChatId = requestChatId; // Will be updated if a new chat is created

    // Use the ChatState's selectedTool
    const toolToUse = this.selectedTool;

    // Check guest message limits
    if (!this.canGuestSendMessage()) {
      this.error = `You've reached the ${GUEST_MESSAGE_LIMIT} message limit for guest users. Please sign up for an account to continue chatting.`;
      toast.error(this.error);
      return;
    }

    // Check if user is trying to use a locked model
    const selectedModelData = this.models.find(m => m.name === this.selectedModel);
    if (selectedModelData?.isLocked) {
      let errorMsg: string;
      if (!this.userId) {
        errorMsg = "Guest users can only use the allowed guest models. Please sign up for access to all models.";
      } else if (selectedModelData?.isDemoMode) {
        errorMsg = "This model is not available in Demo Mode. Contact administrator for full access.";
      } else {
        errorMsg = "This model is not available with your current access level.";
      }
      this.error = errorMsg;
      toast.error(errorMsg);
      return;
    }

    const cleanedPrompt = this.cleanMessageContent(this.prompt);
    // Don't submit if cleaned content is empty and no files attached
    if (!cleanedPrompt && this.attachedFiles.length === 0) return;

    // Start uploading files in background (don't wait)
    const hasPDFFiles = this.attachedFiles.some(f => f.type === 'application/pdf');
    let pdfUploadPromise = null;

    if (this.attachedFiles.length > 0) {
      pdfUploadPromise = this.uploadAttachedFiles().catch(error => {
        console.error('File upload error:', error);
        toast.error('Failed to upload files');
      });
    }

    try {
      // Create user message with attachments
      let messageContent = cleanedPrompt;

      // Add text file content to the message if present
      const textAttachments = this.attachedFiles.filter(f =>
        f.type.startsWith('text/') || f.type === 'application/json'
      );
      if (textAttachments.length > 0) {
        const fileContents = textAttachments.map(f =>
          `\n\n---\nFile: ${f.name} (${f.type})\n---\n${f.content || ''}`
        ).join('');
        messageContent = cleanedPrompt + fileContents;
      }

      // Store PDF attachments reference for later processing
      const pdfAttachments = this.attachedFiles.filter(f => f.type === 'application/pdf');

      // If no text message provided but has PDFs, add a default message
      if (!messageContent && pdfAttachments.length > 0) {
        messageContent = 'Please analyze this PDF:';
      }

      const userMessage: AIMessage = {
        role: "user",
        content: messageContent,
        type: this.attachedFiles.some(f => f.type.startsWith('image/')) ? "image" : "text",
        // Add all attached files info for display (including PDFs)
        files: this.attachedFiles.length > 0 ? this.attachedFiles.map(f => ({
          name: f.name,
          type: f.type,
          size: f.size
        })) : undefined
      };

      // Add image attachments to message (support multiple images)
      const imageAttachments = this.attachedFiles.filter(f => f.type.startsWith('image/'));
      if (imageAttachments.length > 0) {
        // Handle multiple images
        if (imageAttachments.length === 1) {
          // Single image - use backwards compatible fields
          const imageAttachment = imageAttachments[0];
          if (imageAttachment?.uploadedImageId) {
            userMessage.imageId = imageAttachment.uploadedImageId;
            userMessage.mimeType = imageAttachment.type;
          } else if (imageAttachment?.dataUrl && imageAttachment.type) {
            // If we have base64 data but no uploaded ID, use the data directly
            const base64Data = imageAttachment.dataUrl.split(',')[1]; // Remove data URL prefix
            userMessage.imageData = base64Data;
            userMessage.mimeType = imageAttachment.type;
          }
        } else {
          // Multiple images - use new array fields
          const uploadedImages = imageAttachments.filter(img => img.uploadedImageId);
          const dataImages = imageAttachments.filter(img => !img.uploadedImageId && img.dataUrl);

          if (uploadedImages.length > 0) {
            userMessage.imageIds = uploadedImages.map(img => img.uploadedImageId!);
          }

          if (dataImages.length > 0 || uploadedImages.length > 0) {
            userMessage.images = imageAttachments.map(img => {
              if (img.uploadedImageId) {
                return {
                  imageId: img.uploadedImageId,
                  mimeType: img.type
                };
              } else if (img.dataUrl) {
                const base64Data = img.dataUrl.split(',')[1]; // Remove data URL prefix
                return {
                  imageData: base64Data,
                  mimeType: img.type
                };
              }
              return {
                mimeType: img.type
              };
            }).filter(img => img.imageId || img.imageData); // Filter out incomplete entries
          }
        }
      }

      // Create a local copy of messages for this request to avoid race conditions
      let requestMessages = [...this.messages, userMessage];

      // Add user message to conversation (only if still viewing this chat)
      if (this.currentChatId === requestChatId) {
        this.messages = requestMessages;
      }

      // Increment guest message count for non-logged users
      this.incrementGuestMessageCount();

      this.prompt = "";
      this.clearAttachedFiles(); // Clear attachments after sending
      this.isLoading = true;
      this.isStreamingContent = false; // Reset streaming state for new request
      this.error = null;

      // Save chat immediately after user message to prevent loss on refresh
      // Use the captured requestChatId to ensure it's saved to the correct chat
      try {
        const saveResult = await this.saveChatById(requestChatId, requestMessages, requestModel);
        // Update actualChatId if a new chat was created
        if (saveResult.chatId) {
          actualChatId = saveResult.chatId;
        }
      } catch (saveError) {
        console.warn("Failed to save chat after user message:", saveError);
        // Continue with AI request even if initial save fails
      }

      // Check model capabilities using the captured requestModel to avoid race conditions
      // This ensures we evaluate capabilities for the model that was selected when the request started
      const selectedModelConfig = this.models.find(m => m.name === requestModel);
      const isModelMultimodal = selectedModelConfig ? isMultimodal(selectedModelConfig) : false;
      const isVideoGenerationModel = selectedModelConfig?.supportsVideoGeneration;
      const hasImageInput = selectedModelConfig?.supportsImageInput;
      const hasImageAttachments = userMessage.imageId || (userMessage.imageIds && userMessage.imageIds.length > 0) || (userMessage.images && userMessage.images.length > 0) || userMessage.type === "image";

      // Image generation models with image input support (i2i models like flux-kontext, gemini-2.5-flash-image)
      const isImageGenerationWithImageInput =
        selectedModelConfig?.supportsImageGeneration &&
        selectedModelConfig?.supportsImageInput &&
        hasImageAttachments;

      // Multimodal text chat (vision models that analyze images and return text)
      const isMultimodalTextChat = isModelMultimodal && hasImageAttachments;

      // Use multimodal chat API only for text-based multimodal models
      const useMultimodalApi = isMultimodalTextChat;

      // Use image generation API for pure image gen OR i2i models
      const useImageGenerationApi =
        (selectedModelConfig?.supportsImageGeneration && !isModelMultimodal) ||
        isImageGenerationWithImageInput;

      if (useMultimodalApi && !isVideoGenerationModel) {
        console.log('🔀 Using MULTIMODAL CHAT API path');
        console.log('Reason: hasImageAttachments =', hasImageAttachments);

        // Log frontend message structure before sending
        console.log('📤 [FRONTEND] About to send to /api/chat:');
        console.log('  - Total messages:', requestMessages.length);
        console.log('  - userId:', this.userId);
        console.log('  - Messages with image data:');
        requestMessages.forEach((msg, idx) => {
          if (msg.imageId || msg.imageData || msg.imageIds || msg.images) {
            console.log(`    Message ${idx} (${msg.role}):`, {
              hasImageId: !!msg.imageId,
              hasImageData: !!msg.imageData,
              hasImageIds: !!msg.imageIds,
              imageIdsLength: msg.imageIds?.length || 0,
              hasImages: !!msg.images,
              imagesLength: msg.images?.length || 0,
              imagesDetail: msg.images?.map(img => ({
                hasImageId: !!(img as any).imageId,
                hasImageData: !!(img as any).imageData,
                mimeType: (img as any).mimeType
              }))
            });
          }
        });
        console.log('  - Full request structure:', JSON.stringify({
          model: requestModel,
          messagesCount: requestMessages.length,
          userId: this.userId,
          chatId: actualChatId
        }, null, 2));

        console.log('🔀 Using MULTIMODAL STREAMING path');

        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "text"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Wait for PDF upload (DOTS OCR) to complete so LLM can see the content
        if (pdfUploadPromise) {
          try {
            console.log('⏳ Waiting for PDF processing to complete...');
            await pdfUploadPromise;
            console.log('✅ PDF upload completed, updating message with content');

            // Update request message (for LLM) with actual PDF content
            // BUT keep the user message (for display) clean without OCR text
            const uploadedPDFs = pdfAttachments.filter(f => f.content);
            if (uploadedPDFs.length > 0) {
              const pdfContent = uploadedPDFs.map(f => {
                // Truncate content to avoid exceeding context limits (keep first 10000 chars)
                const truncatedContent = f.content && f.content.length > 10000
                  ? f.content.substring(0, 10000) + '\n\n[... content truncated for length ...]'
                  : f.content;
                return `\n\n---\nPDF Document: ${f.name}\n---\n${truncatedContent}`;
              }).join('');

              // Add PDF content ONLY to the request message sent to LLM
              // Do NOT update userMessage.content (keeps chat bubble clean)
              const updatedContent = userMessage.content + pdfContent;
              const msgIndex = requestMessages.findIndex(m => m === userMessage);
              if (msgIndex >= 0) {
                requestMessages[msgIndex].content = updatedContent;
              }

              console.log('📄 Added PDF content to LLM request (not shown in chat):', {
                pdfCount: uploadedPDFs.length,
                totalContentLength: pdfContent.length,
                displayedMessage: userMessage.content,
                llmMessage: updatedContent.substring(0, 100) + '...'
              });
            }
          } catch (err) {
            console.error('Failed to wait for PDF upload:', err);
            // Continue with LLM request even if PDF upload fails
          }
        }

        // Use streaming chat API for multimodal (same as text-only)
        const response = await fetch("/api/chat-stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            messages: requestMessages,
            maxTokens: 4096,
            temperature: 0.7,
            userId: this.userId,
            chatId: actualChatId,
            selectedTool: toolToUse,
            systemPrompt: this.systemPrompt || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to get multimodal streaming response");
        }

        // Process streaming response (same as text-only streaming)
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = "";

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    console.log('✓ Multimodal streaming completed');
                    continue;
                  }

                  try {
                    const parsed = JSON.parse(data);

                    if (parsed.error) {
                      throw new Error(parsed.error);
                    }

                    if (parsed.content) {
                      // Set streaming content flag on first content arrival
                      if (!this.isStreamingContent) {
                        this.isStreamingContent = true;
                      }

                      // Accumulate the content
                      accumulatedContent += parsed.content;

                      // Update the last message in the UI with accumulated content
                      if (this.currentChatId === actualChatId) {
                        const messagesCopy = [...this.messages];
                        const lastMessage = messagesCopy[messagesCopy.length - 1];

                        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'text') {
                          lastMessage.content = accumulatedContent;
                          this.messages = messagesCopy;
                        }
                      }
                    }

                    // Handle stream completion with final data
                    if (parsed.done) {
                      console.log('✓ Multimodal stream done, final content length:', accumulatedContent.length);
                      break;
                    }
                  } catch (parseError) {
                    console.error('Failed to parse streaming chunk:', parseError);
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        }

        // Update assistantMessage with final content for saving
        assistantMessage.content = accumulatedContent || "No response received";

        // Add to request messages for saving
        requestMessages = [...requestMessages, assistantMessage];
      } else if (useImageGenerationApi) {
        console.log('🖼️ Using IMAGE GENERATION API path');

        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "image"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Wait for PDF upload (DOTS OCR) to complete so LLM can see the content
        if (pdfUploadPromise) {
          try {
            console.log('⏳ Waiting for PDF processing to complete...');
            await pdfUploadPromise;
            console.log('✅ PDF upload completed, updating message with content');

            // Update user message with actual PDF content
            const uploadedPDFs = pdfAttachments.filter(f => f.content);
            if (uploadedPDFs.length > 0) {
              const pdfContent = uploadedPDFs.map(f => {
                const truncatedContent = f.content && f.content.length > 10000
                  ? f.content.substring(0, 10000) + '\n\n[... content truncated for length ...]'
                  : f.content;
                return `\n\n---\nPDF Document: ${f.name}\n---\n${truncatedContent}`;
              }).join('');

              const updatedContent = userMessage.content + pdfContent;

              userMessage.content = updatedContent;
              const msgIndex = requestMessages.findIndex(m => m === userMessage);
              if (msgIndex >= 0) {
                requestMessages[msgIndex].content = updatedContent;
              }

              console.log('📄 Updated user message with PDF content:', {
                pdfCount: uploadedPDFs.length,
                totalContentLength: pdfContent.length
              });
            }
          } catch (err) {
            console.error('Failed to wait for PDF upload:', err);
          }
        }

        // Extract imageUrl from the first image attachment for i2i models
        // Use the uploaded image URL (presigned R2 URL or static path) instead of /api/images/[id]
        const imageUrl = imageAttachments.length > 0 && imageAttachments[0].uploadedImageUrl
          ? imageAttachments[0].uploadedImageUrl
          : undefined;

        // Use image generation API for pure image models (Imagen) or i2i models (flux-kontext, gemini-2.5-flash-image)
        const response = await fetch("/api/image-generation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            prompt: cleanedPrompt,
            chatId: actualChatId,
            imageUrl: imageUrl, // Pass imageUrl for i2i models
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to generate image");
        }

        const imageResponse = await response.json();

        // Update the placeholder assistant message with actual content
        // Use copy-mutate-reassign pattern to trigger Svelte 5 reactivity
        if (this.currentChatId === actualChatId) {
          const messagesCopy = [...this.messages];
          const lastMessage = messagesCopy[messagesCopy.length - 1];

          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'image') {
            lastMessage.content = `Generated image for: "${cleanedPrompt}"`;
            lastMessage.imageId = imageResponse.imageId;
            lastMessage.imageUrl = imageResponse.imageUrl; // Keep for backwards compatibility
            lastMessage.imageData = imageResponse.imageData; // Keep for backwards compatibility
            lastMessage.mimeType = imageResponse.mimeType;
            this.messages = messagesCopy;
          }
        }

        // Add to request messages for saving with updated content
        assistantMessage.content = `Generated image for: "${cleanedPrompt}"`;
        assistantMessage.imageId = imageResponse.imageId;
        assistantMessage.imageUrl = imageResponse.imageUrl;
        assistantMessage.imageData = imageResponse.imageData;
        assistantMessage.mimeType = imageResponse.mimeType;
        requestMessages = [...requestMessages, assistantMessage];
      } else if (isVideoGenerationModel) {
        // Create a placeholder assistant message for better UX
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "video"
        };

        // Add placeholder message to UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Wait for PDF upload (DOTS OCR) to complete so LLM can see the content
        if (pdfUploadPromise) {
          try {
            console.log('⏳ Waiting for PDF processing to complete...');
            await pdfUploadPromise;
            console.log('✅ PDF upload completed, updating message with content');

            const uploadedPDFs = pdfAttachments.filter(f => f.content);
            if (uploadedPDFs.length > 0) {
              const pdfContent = uploadedPDFs.map(f => {
                const truncatedContent = f.content && f.content.length > 10000
                  ? f.content.substring(0, 10000) + '\n\n[... content truncated for length ...]'
                  : f.content;
                return `\n\n---\nPDF Document: ${f.name}\n---\n${truncatedContent}`;
              }).join('');

              const updatedContent = userMessage.content + pdfContent;

              userMessage.content = updatedContent;
              const msgIndex = requestMessages.findIndex(m => m === userMessage);
              if (msgIndex >= 0) {
                requestMessages[msgIndex].content = updatedContent;
              }

              console.log('📄 Updated user message with PDF content');
            }
          } catch (err) {
            console.error('Failed to wait for PDF upload:', err);
          }
        }

        // Use chat API for video generation (handles video generation internally)
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: requestModel,
            messages: requestMessages,
            maxTokens: 4096,
            temperature: 0.7,
            userId: this.userId,
            chatId: actualChatId,
            systemPrompt: this.systemPrompt || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to generate video");
        }

        const videoResponse = await response.json();

        // Update the placeholder assistant message with actual content
        // Use copy-mutate-reassign pattern to trigger Svelte 5 reactivity
        if (this.currentChatId === actualChatId) {
          const messagesCopy = [...this.messages];
          const lastMessage = messagesCopy[messagesCopy.length - 1];

          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'video') {
            lastMessage.content = `Generated video for: "${cleanedPrompt}"`;
            lastMessage.videoId = videoResponse.videoId;
            lastMessage.mimeType = videoResponse.mimeType;
            this.messages = messagesCopy;
          }
        }

        // Add to request messages for saving with updated content
        assistantMessage.content = `Generated video for: "${cleanedPrompt}"`;
        assistantMessage.videoId = videoResponse.videoId;
        assistantMessage.mimeType = videoResponse.mimeType;
        requestMessages = [...requestMessages, assistantMessage];
      } else {
        console.log('💬 Using TEXT CHAT STREAMING API path');

        // Enhanced error recovery with retry logic
        const MAX_RETRIES = 3;
        // No timeout - wait indefinitely for local LLM responses
        let retryCount = 0;
        let accumulatedContent = "";
        let streamSuccessful = false;

        // Create a placeholder assistant message that we'll update as we stream
        const assistantMessage: AIMessage = {
          role: "assistant" as const,
          content: "",
          model: requestModel,
          type: "text"
        };

        // Add the placeholder message to the UI immediately
        if (this.currentChatId === actualChatId) {
          this.messages = [...this.messages, assistantMessage];
        }

        // Wait for PDF upload (DOTS OCR) to complete so LLM can see the content
        if (pdfUploadPromise) {
          try {
            console.log('⏳ Waiting for PDF processing to complete...');
            await pdfUploadPromise;
            console.log('✅ PDF upload completed, updating message with content');

            const uploadedPDFs = pdfAttachments.filter(f => f.content);
            if (uploadedPDFs.length > 0) {
              const pdfContent = uploadedPDFs.map(f => {
                const truncatedContent = f.content && f.content.length > 10000
                  ? f.content.substring(0, 10000) + '\n\n[... content truncated for length ...]'
                  : f.content;
                return `\n\n---\nPDF Document: ${f.name}\n---\n${truncatedContent}`;
              }).join('');

              const updatedContent = userMessage.content + pdfContent;

              userMessage.content = updatedContent;
              const msgIndex = requestMessages.findIndex(m => m === userMessage);
              if (msgIndex >= 0) {
                requestMessages[msgIndex].content = updatedContent;
              }

              console.log('📄 Updated user message with PDF content');
            }
          } catch (err) {
            console.error('Failed to wait for PDF upload:', err);
          }
        }

        while (retryCount < MAX_RETRIES && !streamSuccessful) {
          try {
            // Use streaming text chat API (no timeout for local LLM)
            const response = await fetch("/api/chat-stream", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: requestModel,
                messages: requestMessages,
                maxTokens: 4096,
                temperature: 0.7,
                userId: this.userId,
                chatId: actualChatId,
                selectedTool: toolToUse, // Pass selected tool for function calling
                systemPrompt: this.systemPrompt || undefined,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || "Failed to get response");
            }

            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    streamSuccessful = true;
                    break;
                  }

                  // Decode the chunk
                  const chunk = decoder.decode(value, { stream: true });
                  const lines = chunk.split('\n');

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const data = line.slice(6); // Remove 'data: ' prefix

                      if (data === '[DONE]') {
                        // Stream completed successfully
                        streamSuccessful = true;
                        break;
                      }

                      try {
                        const parsed = JSON.parse(data);

                        if (parsed.error) {
                          throw new Error(parsed.error);
                        }

                        if (parsed.content) {
                          // Set streaming content flag on first content arrival
                          if (!this.isStreamingContent) {
                            this.isStreamingContent = true;
                          }

                          // Accumulate the content
                          accumulatedContent += parsed.content;

                          // Update the last message in the UI with the accumulated content
                          if (this.currentChatId === actualChatId) {
                            const messagesCopy = [...this.messages];
                            const lastMessage = messagesCopy[messagesCopy.length - 1];

                            // Check if placeholder message exists and is correct type
                            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.type === 'text') {
                              lastMessage.content = accumulatedContent;
                              this.messages = messagesCopy;
                            } else {
                              // Defensive recovery: If placeholder was lost (navigation race condition), re-add it
                              console.warn('Streaming placeholder message was lost, recreating...');
                              this.messages = [...this.messages, {
                                role: "assistant" as const,
                                content: accumulatedContent,
                                model: requestModel,
                                type: "text"
                              }];
                            }
                          }
                        }
                      } catch (parseError) {
                        // Ignore parse errors for incomplete chunks
                        if (!(parseError instanceof SyntaxError)) {
                          console.error('Error parsing stream chunk:', parseError);
                        }
                      }
                    }
                  }
                }
              } catch (streamError) {
                console.error(`Stream error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, streamError);

                // Don't retry if we already have partial content (preserve it)
                if (accumulatedContent) {
                  console.log('Preserving partial content from interrupted stream');
                  streamSuccessful = true;
                  break;
                }

                // Increment retry count for next attempt
                retryCount++;

                // Exponential backoff: wait before retrying
                if (retryCount < MAX_RETRIES) {
                  const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
                  console.log(`Retrying in ${backoffMs}ms...`);
                  await new Promise(resolve => setTimeout(resolve, backoffMs));
                }
              } finally {
                reader.releaseLock();
              }
            }
          } catch (fetchError) {
            console.error(`Fetch error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, fetchError);

            // Classify and handle different error types
            if (fetchError instanceof Error) {
              if (fetchError.name === 'AbortError') {
                this.error = "Request timed out. Please try again.";
              } else if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('network')) {
                this.error = "Network error. Please check your connection and try again.";
              } else {
                this.error = fetchError.message;
              }
            }

            // Don't retry if we have partial content
            if (accumulatedContent) {
              console.log('Preserving partial content despite error');
              streamSuccessful = true;
              break;
            }

            retryCount++;

            // Exponential backoff
            if (retryCount < MAX_RETRIES) {
              const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }

        // Update the assistant message with final content (accumulated or partial)
        assistantMessage.content = accumulatedContent || "No response received";

        // If we exhausted all retries and got no content, throw error
        if (!streamSuccessful && !accumulatedContent) {
          throw new Error(this.error || "Failed to get response after multiple attempts");
        }

        // Clear any transient errors if we got content
        if (accumulatedContent) {
          this.error = null;
        }

        // If no content was received during streaming, ensure streaming flag is reset
        if (!accumulatedContent) {
          this.isStreamingContent = false;
        }

        // Add to request messages for saving
        requestMessages = [...requestMessages, assistantMessage];
      }

      // Save chat after successful AI response to the correct chat ID
      // Use actualChatId to ensure response is saved to the original chat
      try {
        await this.saveChatById(actualChatId, requestMessages, requestModel);
      } catch (saveError) {
        console.error("Failed to save chat after AI response:", saveError);
        // Don't throw - we successfully got the AI response, just failed to save
      }
    } catch (err) {
      console.error("Chat error:", err);
      this.error = err instanceof Error ? err.message : "An error occurred";
      // Remove the user message on error (only if still viewing this chat and AI request failed)
      if (this.currentChatId === actualChatId) {
        // Count how many messages were added (user + potential placeholder)
        // For media generation, we add both user message and placeholder assistant message
        // Check if last message is an empty placeholder assistant message
        const messagesToRemove = this.messages.length > 0 &&
          this.messages[this.messages.length - 1].role === 'assistant' &&
          this.messages[this.messages.length - 1].content === '' ? 2 : 1;
        this.messages = this.messages.slice(0, -messagesToRemove);
        // Restore the prompt
        this.prompt = cleanedPrompt;
      }
    } finally {
      this.isLoading = false;
      this.isStreamingContent = false; // Reset streaming state
    }
  }

  // Helper function to get model display name
  getModelDisplayName(modelName: string): string {
    const model = this.models.find((m) => m.name === modelName);
    return model?.displayName || "Select model";
  }

  // Setup model change detection effect
  setupModelChangeDetection() {
    $effect(() => {
      if (
        this.previousModel !== null &&
        this.selectedModel !== this.previousModel &&
        this.messages.length > 0 &&
        !this.isLoadingChatData
      ) {
        // Store the pending model change and revert the selection temporarily
        this.pendingModelChange = this.selectedModel;
        this.selectedModel = this.previousModel;
        this.showModelChangeDialog = true;
      } else {
        this.previousModel = this.selectedModel;
      }
    });
  }
}