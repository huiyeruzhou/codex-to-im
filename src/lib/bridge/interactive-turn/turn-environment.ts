import type { BridgeSession } from '../host.js';
import type {
  ChannelAddress,
  ChannelBinding,
} from '../types.js';
import { buildInteractiveStreamKey } from '../mirror-formatters.js';
import { buildStreamContextTags } from '../streaming-metadata.js';
import { classifyInteractiveTurn } from '../turns/turn-classifier.js';
import type { BridgeTurnClassification } from '../turns/turn-types.js';

export interface InteractiveStreamConfig {
  intervalMs: number;
  minDeltaChars: number;
  maxChars: number;
}

export interface InteractiveStreamStatusTimingConfig {
  idleStartMs: number;
  heartbeatMs: number;
}

export interface InteractiveTurnRuntimeSettings {
  stream: InteractiveStreamConfig;
  statusTiming: InteractiveStreamStatusTimingConfig;
  writeSdkToolDetailsInText: boolean;
}

export type ReadInteractiveTurnSetting = (key: string) => string | null | undefined;

export type ResolveInteractiveTurnRuntimeSettings = (
  channelType?: string,
) => InteractiveTurnRuntimeSettings;

export interface InteractiveTurnEnvironment {
  binding: ChannelBinding;
  initialSession: BridgeSession | null;
  classification: BridgeTurnClassification;
  codexThreadId?: string;
  streamKey: string;
}

export interface BuildInteractiveTurnEnvironmentOptions {
  binding: ChannelBinding;
  initialSession: BridgeSession | null;
  classification: BridgeTurnClassification;
  messageId: string;
}

export type ResolveInteractiveTurnEnvironment = (
  address: ChannelAddress,
  messageId: string,
) => InteractiveTurnEnvironment;

export interface ResolveInteractiveTurnEnvironmentPorts {
  resolveBinding(address: ChannelAddress): ChannelBinding;
  getBridgeSession(sessionId: string): BridgeSession | null;
  codexThreadExists(threadId: string): boolean;
}

export interface InteractiveTurnDisplayInfo {
  title: string;
  bridgeSessionId?: string | null;
  threadId?: string | null;
  executionProvider?: string | null;
  creatorKind?: string | null;
}

export type ResolveInteractiveTurnDisplayInfo = (binding: ChannelBinding) => InteractiveTurnDisplayInfo;

export type ListInteractiveTurnBindings = (channelType: ChannelAddress['channelType']) => ChannelBinding[];

export interface StaleTaskCompletionNoticePorts {
  listChannelBindings?: ListInteractiveTurnBindings;
  resolveDisplayInfo?: ResolveInteractiveTurnDisplayInfo;
}

const SYNTHETIC_BINDING_PREFIXES = ['auto:'] as const;

const STREAM_DEFAULTS: Record<string, InteractiveStreamConfig> = {
  default: { intervalMs: 1000, minDeltaChars: 30, maxChars: 4000 },
};

const STREAM_STATUS_IDLE_START_MS = 180_000;
const STREAM_STATUS_HEARTBEAT_MS = 10_000;

export function resolveInteractiveTurnRuntimeSettings(
  channelType = 'default',
  readSetting: ReadInteractiveTurnSetting,
): InteractiveTurnRuntimeSettings {
  const defaults = STREAM_DEFAULTS[channelType] || STREAM_DEFAULTS.default;
  const prefix = `bridge_${channelType}_stream_`;
  const intervalMs = parseInt(readSetting(`${prefix}interval_ms`) || '', 10) || defaults.intervalMs;
  const minDeltaChars = parseInt(readSetting(`${prefix}min_delta_chars`) || '', 10) || defaults.minDeltaChars;
  const maxChars = parseInt(readSetting(`${prefix}max_chars`) || '', 10) || defaults.maxChars;
  const idleStartSeconds = parseInt(readSetting('bridge_stream_status_idle_start_seconds') || '', 10);
  const heartbeatSeconds = parseInt(readSetting('bridge_stream_status_check_interval_seconds') || '', 10);
  return {
    stream: { intervalMs, minDeltaChars, maxChars },
    statusTiming: {
      idleStartMs: Math.max(
        0,
        (Number.isFinite(idleStartSeconds) && idleStartSeconds > 0 ? idleStartSeconds : STREAM_STATUS_IDLE_START_MS / 1000) * 1000,
      ),
      heartbeatMs: Math.max(
        1_000,
        (Number.isFinite(heartbeatSeconds) && heartbeatSeconds > 0 ? heartbeatSeconds : STREAM_STATUS_HEARTBEAT_MS / 1000) * 1000,
      ),
    },
    writeSdkToolDetailsInText: readSetting('bridge_sdk_tool_call_details_in_text') !== 'false',
  };
}

export function buildInteractiveTurnEnvironment(
  options: BuildInteractiveTurnEnvironmentOptions,
): InteractiveTurnEnvironment {
  return {
    binding: options.binding,
    initialSession: options.initialSession,
    classification: options.classification,
    codexThreadId: options.classification.codexThreadId,
    streamKey: buildInteractiveStreamKey(options.binding.bridgeSessionId, options.messageId),
  };
}

export function resolveInteractiveTurnEnvironment(
  address: ChannelAddress,
  messageId: string,
  ports: ResolveInteractiveTurnEnvironmentPorts,
): InteractiveTurnEnvironment {
  const binding = ports.resolveBinding(address);
  const initialSession = ports.getBridgeSession(binding.bridgeSessionId);
  const classification = classifyInteractiveTurn(
    binding,
    initialSession,
    ports.codexThreadExists,
  );
  return buildInteractiveTurnEnvironment({
    binding,
    initialSession,
    classification,
    messageId,
  });
}

export function buildFallbackInteractiveTurnDisplayInfo(binding: ChannelBinding): InteractiveTurnDisplayInfo {
  const title = binding.chatDisplayName?.trim()
    || lastPathSegment(binding.workingDirectory)
    || binding.bridgeSessionId.slice(0, 8);
  return {
    title,
    bridgeSessionId: binding.bridgeSessionId,
    threadId: '',
    executionProvider: 'default',
    creatorKind: 'bridge',
  };
}

function lastPathSegment(value: string | null | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || '';
}

export function buildInteractiveStreamCardMetadata(
  binding: ChannelBinding,
  resolveDisplayInfo: ResolveInteractiveTurnDisplayInfo = buildFallbackInteractiveTurnDisplayInfo,
) {
  const display = resolveDisplayInfo(binding);
  return {
    title: display.title,
    tags: buildStreamContextTags({
      bindingId: binding.id,
      bridgeSessionId: display.bridgeSessionId,
      codexThreadId: display.threadId,
      executionProvider: display.executionProvider,
      creatorKind: display.creatorKind,
      source: 'sdk',
    }),
  };
}

export function buildStaleTaskCompletionNotice(
  address: ChannelAddress,
  binding: ChannelBinding,
  ports: StaleTaskCompletionNoticePorts = {},
): string | null {
  const bindings = ports.listChannelBindings?.(address.channelType);
  if (!bindings) return null;
  const isSyntheticBinding = SYNTHETIC_BINDING_PREFIXES.some((prefix) => binding.id.startsWith(prefix));
  const stillBound = bindings.some((item) => (
    item.chatId === address.chatId
    && (item.id === binding.id || (isSyntheticBinding && item.bridgeSessionId === binding.bridgeSessionId))
    && item.bridgeSessionId === binding.bridgeSessionId
  ));
  if (stillBound) return null;
  const taskName = (ports.resolveDisplayInfo || buildFallbackInteractiveTurnDisplayInfo)(binding).title;
  return `旧会话「${taskName}」任务已结束，但当前聊天已解绑该会话，回复已跳过。`;
}
