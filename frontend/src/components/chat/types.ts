// Shared types for ChatView components

// ImageSource for image blocks
export interface ImageSource {
  type: string;       // "base64", "file", "url"
  media_type?: string; // "image/png", "image/jpeg", etc.
  data: string;       // Base64 data, file path, or URL
}

// Attachment for images sent with messages (frontend-specific with preview data)
export interface Attachment {
  id: string;           // Unique ID for React keys
  type: 'image';        // Currently only images supported
  mediaType: string;    // "image/png", "image/jpeg", "image/gif", "image/webp"
  data: string;         // Base64 data (no data: prefix)
  previewUrl: string;   // Data URL for preview display (data:image/png;base64,...)
  fileName?: string;    // Original filename if from file upload
  size: number;         // File size in bytes
}

// Constants for attachment validation
export const ATTACHMENT_LIMITS = {
  MAX_IMAGES: 100,
  MAX_TOTAL_SIZE: 32 * 1024 * 1024, // 32MB
  SUPPORTED_TYPES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const,
};

// Content block type matches the Go types.ContentBlock
export interface ContentBlock {
  type: string;
  // Text block
  text?: string;
  // Tool use block
  id?: string;        // Tool use ID
  name?: string;      // Tool name
  input?: any;        // Tool input parameters
  // Tool result block
  tool_use_id?: string; // References tool_use block ID
  content?: any;      // Result content (string or structured)
  is_error?: boolean;
  // Image block
  source?: ImageSource;
  // Thinking block
  thinking?: string;
  signature?: string;
}

// PendingQuestion from Go backend - indicates an AskUserQuestion that failed in --print mode
export interface PendingQuestion {
  toolUseId: string;
  questions: any[];
}

// Message type with UI-specific fields
export interface Message {
  uuid: string;
  type: string;
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: string;
  isCompaction?: boolean;
  compactionPreview?: string;
  isPending?: boolean;  // True for optimistic messages sent from ClaudeFu
  isFailed?: boolean;   // True if send failed
  pendingQuestion?: PendingQuestion;  // Non-null if this message contains a failed AskUserQuestion
  isSynthetic?: boolean;  // True if model="<synthetic>" (e.g., "No response requested.")
}

// Props for ChatView component
export interface ChatViewProps {
  agentId: string;
  agentName?: string;
  folder: string;
  sessionId: string;
  onSessionCreated?: (newSessionId: string, initialMessage: string) => void;
  initialMessage?: string;
}
