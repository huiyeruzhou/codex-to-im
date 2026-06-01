import type {
  TaskProgressInfo,
  ToolCallInfo,
} from '../types.js';
import { stripFinalOnlyBlocksForStreaming } from '../turns/response-assembler.js';
import {
  recordStreamActivity,
  recordStreamContentResponse,
  updateStreamStatusNote,
  type StreamState,
} from '../turns/stream-state.js';
import type { ContextUsageInfo } from '../context-usage.js';
import type {
  InteractiveStreamFeedback,
  InteractiveStreamUiController,
} from './stream-ui-controller.js';
import {
  applyCodexTurnEventToTools,
  codexTurnEventFromSdkToolEvent,
} from '../codex-turn-events.js';

export interface InteractiveSdkStreamEventTaskState {
  lastActivityAt: number;
  lastResponseAt?: number | null;
  lastContentResponseAt?: number | null;
}

export interface CreateInteractiveSdkStreamEventsControllerParams {
  sessionId: string;
  taskId: string;
  streamState: StreamState;
  taskState: InteractiveSdkStreamEventTaskState;
  streamUi: InteractiveStreamUiController;
  streamFeedback: InteractiveStreamFeedback;
  showToolCallDetails: boolean;
  nowMs(): number;
  isCurrentTask(sessionId: string, taskId: string): boolean;
  touchTask(sessionId: string, taskId: string): void;
  recordHealthProgress(sessionId: string, type: 'text' | 'permission_wait', detail?: string): void;
  recordHealthTool(sessionId: string, toolId: string, toolName: string, status: 'running' | 'complete' | 'error'): void;
  previewOnPartialText?(fullText: string): void;
}

export interface InteractiveSdkStreamEventsController {
  onPartialText(fullText: string): void;
  onToolEvent(
    toolId: string,
    toolName: string,
    status: 'running' | 'complete' | 'error',
    detail?: { input?: unknown; output?: string; isError?: boolean },
  ): void;
  onTaskEvent(tasks: TaskProgressInfo[]): void;
  onStatusNote(note: string | null): void;
  onContextUsage(contextUsage: ContextUsageInfo): void;
  onPermissionWait(toolName: string): void;
  pushFinalCardText(text: string): void;
}

export function createInteractiveSdkStreamEventsController(
  params: CreateInteractiveSdkStreamEventsControllerParams,
): InteractiveSdkStreamEventsController {
  const toolCallTracker = new Map<string, ToolCallInfo>();
  let latestTasks: TaskProgressInfo[] = [];

  const isCurrentTask = () => params.isCurrentTask(params.sessionId, params.taskId);

  const markActivity = () => {
    const now = params.nowMs();
    recordStreamActivity(params.streamState, now);
    params.taskState.lastActivityAt = params.streamState.lastActivityAtMs;
    params.touchTask(params.sessionId, params.taskId);
  };

  const markContentResponse = () => {
    const now = params.nowMs();
    recordStreamContentResponse(params.streamState, now);
    params.taskState.lastActivityAt = params.streamState.lastActivityAtMs;
    params.taskState.lastResponseAt = params.streamState.lastContentResponseAtMs;
    params.taskState.lastContentResponseAt = params.streamState.lastContentResponseAtMs;
    params.touchTask(params.sessionId, params.taskId);
  };

  const pushRunningStatus = () => {
    params.streamUi.pushRunningStatus();
    params.streamUi.syncSnapshot();
  };

  const pushStreamingText = (fullText: string) => {
    if (!params.streamUi.hasStreamingCards) return;
    params.streamFeedback.pushText(
      stripFinalOnlyBlocksForStreaming(fullText),
    );
  };

  return {
    onPartialText(fullText) {
      if (!isCurrentTask()) return;
      if (fullText.trim()) {
        markContentResponse();
      }
      params.recordHealthProgress(params.sessionId, 'text');
      params.previewOnPartialText?.(fullText);
      pushStreamingText(fullText);
      pushRunningStatus();
    },
    onToolEvent(toolId, toolName, status, detail) {
      if (!isCurrentTask()) return;
      markActivity();
      params.recordHealthTool(params.sessionId, toolId, toolName, status);
      applyCodexTurnEventToTools(toolCallTracker, codexTurnEventFromSdkToolEvent(
        toolId,
        toolName,
        status,
        detail,
      ), {
        showToolCallDetails: params.showToolCallDetails,
      });
      if (params.streamUi.hasStreamingCards) {
        params.streamFeedback.pushTools(Array.from(toolCallTracker.values()));
      }
      pushRunningStatus();
    },
    onTaskEvent(tasks) {
      if (!isCurrentTask()) return;
      markActivity();
      latestTasks = tasks;
      if (params.streamUi.hasStreamingCards) {
        params.streamFeedback.pushTasks(latestTasks);
      }
      pushRunningStatus();
    },
    onStatusNote(note) {
      if (!isCurrentTask()) return;
      updateStreamStatusNote(params.streamState, note, params.nowMs());
      if (params.streamState.statusNote) markActivity();
      pushRunningStatus();
    },
    onContextUsage(contextUsage) {
      if (!isCurrentTask()) return;
      params.streamState.contextUsage = contextUsage;
      markActivity();
      pushRunningStatus();
    },
    onPermissionWait(toolName) {
      params.recordHealthProgress(
        params.sessionId,
        'permission_wait',
        `当前正在等待工具 ${toolName} 的权限确认。`,
      );
      markActivity();
      pushRunningStatus();
    },
    pushFinalCardText(text) {
      if (!params.streamUi.hasStreamingCards || !text.trim()) return;
      params.streamFeedback.pushText(text);
      params.streamUi.syncSnapshot();
    },
  };
}
