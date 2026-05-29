/**
 * Bridge system types — shared across all bridge modules.
 *
 * The bridge connects external IM channels (Feishu/Lark, Weixin)
 * to local chat sessions, allowing users to interact with the configured LLM
 * from their preferred messaging platform.
 */

// Re-export bridge-local types from host.ts so consumers can import from one place
export type { FileAttachment } from './host.js';

// ── Channel Types ──────────────────────────────────────────────

/**
 * Channel type identifier.
 * Extensible — any string is valid so new adapters can register without
 * modifying this definition. Well-known values: 'feishu', 'weixin'.
 */
export type ChannelType = string;

/** Unique address of a user within a channel */
export interface ChannelAddress {
  channelType: ChannelType;
  channelProvider?: string;
  channelAlias?: string;
  chatId: string;        // Platform-specific chat/channel identifier
  userId?: string;       // Platform-specific user identifier (optional for group chats)
  displayName?: string;  // Human-readable name for audit logs
}

/** Composite key for routing: channelType + chatId */
export interface SessionKey {
  channelType: ChannelType;
  chatId: string;
}

// ── Messages ───────────────────────────────────────────────────

/** Inbound message from an IM channel */
export interface InboundMessage {
  /** Platform-specific message ID (for dedup and reference) */
  messageId: string;
  /** Address of the sender */
  address: ChannelAddress;
  /** Plain text content of the message */
  text: string;
  /** Timestamp of the message (ISO string or unix epoch ms) */
  timestamp: number;
  /** If this is a callback query (inline button press), the callback data */
  callbackData?: string;
  /** For callback queries: the message ID of the original message that triggered the callback */
  callbackMessageId?: string;
  /** Platform-specific raw update object (for adapter-specific handling) */
  raw?: unknown;
  /** Adapter-specific update ID for deferred offset acknowledgement */
  updateId?: number;
  /** File attachments (images, documents) from the IM channel */
  attachments?: import('./host.js').FileAttachment[];
}

/** Outbound message to send to an IM channel */
export interface OutboundMessage {
  /** Target address */
  address: ChannelAddress;
  /** Message text, optionally using the channel's selected parse mode. */
  text: string;
  /** Parse mode for the text */
  parseMode?: 'HTML' | 'Markdown' | 'plain';
  /** Optional local artifacts to upload and send through the channel. */
  attachments?: OutboundAttachment[];
  /** Inline keyboard buttons */
  inlineButtons?: InlineButton[][];
  /** Optional rich command/result card. Unsupported channels should ignore it and send text. */
  richCard?: OutboundRichCard;
  /** Existing platform message whose rich card should be updated in-place. */
  richCardUpdateMessageId?: string;
  /** If replying to a specific message */
  replyToMessageId?: string;
}

/** A local artifact that the bridge should send back to the IM channel. */
export interface OutboundAttachment {
  kind: 'image' | 'file';
  path: string;
  caption?: string;
  name?: string;
}

/** Inline keyboard button for permission prompts */
export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface OutboundCardActionButton {
  text: string;
  callbackData: string;
  type?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}

export interface OutboundCardActionSelectOption {
  text: string;
  callbackData: string;
}

export interface OutboundCardActionSelect {
  id?: string;
  placeholder: string;
  selectedCallbackData?: string;
  options: OutboundCardActionSelectOption[];
}

export interface OutboundRichCardSection {
  title?: string;
  text?: string;
  fields?: Array<[string, string | null | undefined]>;
  code?: {
    text: string;
    language?: string;
  };
  actions?: OutboundCardActionButton[][];
}

export interface OutboundRichCardTableColumn {
  name: string;
  displayName: string;
  width?: string;
  dataType?: 'text' | 'lark_md' | 'markdown' | 'number';
  horizontalAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'center' | 'bottom';
}

export interface OutboundRichCardTable {
  columns: OutboundRichCardTableColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
  pageSize?: number;
  rowHeight?: 'low' | 'middle' | 'medium' | 'high' | 'auto' | `${number}px`;
  freezeFirstColumn?: boolean;
}

export interface OutboundRichCard {
  title: string;
  subtitle?: string;
  table?: OutboundRichCardTable;
  sections: OutboundRichCardSection[];
  footer?: string[];
  selects?: OutboundCardActionSelect[];
  actions?: OutboundCardActionButton[][];
  template?: 'blue' | 'green' | 'red' | 'yellow' | 'grey';
  /** Maximum number of sections to render in rich IM cards before folding the rest into a summary. */
  maxSections?: number;
  /**
   * Stable key used by adapters that can update an existing rich card in-place.
   * If omitted, adapters should send a new card message.
   */
  updateKey?: string;
  /** Local adapter cache TTL for in-place updates; null disables local expiry. */
  updateTtlMs?: number | null;
}

/** Result of sending a message via an adapter */
export interface SendResult {
  ok: boolean;
  /** Platform-specific message ID of the sent message */
  messageId?: string;
  error?: string;
}

// ── Bindings ───────────────────────────────────────────────────

export type ChannelBindingMode = 'normal' | 'yolo' | 'code' | 'plan' | 'ask';

/** Links an IM chat to a CodePilot session */
export interface ChannelBinding {
  id: string;
  channelType: ChannelType;
  channelProvider?: string;
  channelAlias?: string;
  chatId: string;
  chatUserId?: string;
  chatDisplayName?: string;
  /** CodePilot session ID this chat is bound to */
  codepilotSessionId: string;
  /** SDK session ID for resume (cached from last conversation) */
  sdkSessionId: string;
  /** Working directory for this binding */
  workingDirectory: string;
  /** Model override for this binding */
  model: string;
  /** Chat mode */
  mode: ChannelBindingMode;
  /** Whether this binding is currently active */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One-shot default target for the next new chat on a channel instance. */
export interface ChannelDefaultTarget {
  id: string;
  channelType: ChannelType;
  channelProvider?: string;
  channelAlias?: string;
  targetKey: string;
  createdAt: string;
  updatedAt: string;
}

// ── Bridge Status ──────────────────────────────────────────────

/** Overall bridge system status */
export interface BridgeStatus {
  running: boolean;
  startedAt: string | null;
  adapters: AdapterStatus[];
}

/** Status of a single channel adapter */
export interface AdapterStatus {
  channelType: ChannelType;
  channelProvider?: string;
  channelAlias?: string;
  running: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
}

// ── Audit & Dedup ──────────────────────────────────────────────

/** Audit log entry */
export interface AuditLogEntry {
  id: string;
  channelType: ChannelType;
  chatId: string;
  direction: 'inbound' | 'outbound';
  messageId: string;
  summary: string;
  createdAt: string;
}

/** Permission link: maps permissionRequestId to an IM message for callback handling */
export interface PermissionLink {
  id: string;
  permissionRequestId: string;
  channelType: ChannelType;
  chatId: string;
  messageId: string;
  createdAt: string;
}

// ── Streaming Preview ─────────────────────────────────────────

/** Capabilities of a channel adapter's streaming preview support */
export interface PreviewCapabilities {
  supported: boolean;
  privateOnly: boolean;
}

/** Mutable state for an in-flight streaming preview */
export interface StreamingPreviewState {
  draftId: number;           // non-zero 31-bit random integer, reused within one answer cycle
  chatId: string;
  lastSentText: string;      // last text actually sent as draft
  lastSentAt: number;        // timestamp (ms) of last sent draft
  degraded: boolean;         // set true after API failure → skip further previews
  throttleTimer: ReturnType<typeof setTimeout> | null;
  pendingText: string;       // latest accumulated text (may not yet be sent due to throttle)
}

// ── Tool Call Info ─────────────────────────────────────────────

/** Tool call tracking for streaming card progress display */
export interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  input?: string | null;
  output?: string | null;
}

export type TaskProgressStatus = 'in_progress' | 'pending' | 'completed';

/** Structured task / plan progress for product-style streaming UIs. */
export interface TaskProgressInfo {
  text: string;
  status: TaskProgressStatus;
}

// ── Config ─────────────────────────────────────────────────────

/** Platform-specific message length limits */
export const PLATFORM_LIMITS: Record<string, number> = {
  feishu: 30000,
  weixin: 4000,
};
