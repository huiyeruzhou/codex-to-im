import type { LLMProvider, StreamChatParams } from '../lib/bridge/host.js';
import type { PendingPermissions } from '../permission-gateway.js';
import { CodexProvider } from './provider.js';
import { CodexTmuxProvider, shouldUseCodexTmuxTui } from './tmux-provider.js';

export type CodexProviderChoice = 'sdk' | 'tmux';

function normalizeProviderChoice(value: unknown): CodexProviderChoice | null {
  if (value === 'sdk' || value === 'tmux') return value;
  return null;
}

export class CodexRoutingProvider implements LLMProvider {
  private readonly sdkProvider: LLMProvider;
  private readonly tmuxProvider: LLMProvider;
  private readonly defaultProvider: CodexProviderChoice;

  constructor(pendingPerms?: PendingPermissions, defaultProvider?: CodexProviderChoice) {
    this.sdkProvider = new CodexProvider(pendingPerms);
    this.tmuxProvider = new CodexTmuxProvider();
    this.defaultProvider = defaultProvider || (shouldUseCodexTmuxTui() ? 'tmux' : 'sdk');
  }

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const choice = normalizeProviderChoice(params.codexProvider) || this.defaultProvider;
    console.log('[codex-routing-provider] Route Codex request:', {
      bridge_session_id: params.sessionId,
      provider: choice,
      configured_provider: params.codexProvider || null,
      default_provider: this.defaultProvider,
    });
    return (choice === 'tmux' ? this.tmuxProvider : this.sdkProvider).streamChat(params);
  }
}
