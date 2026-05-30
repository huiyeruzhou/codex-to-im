/**
 * Minimal Mock Host Example
 *
 * Demonstrates how to wire up the Codex-to-IM bridge with mock implementations
 * of all host interfaces. This runs the full bridge pipeline without
 * any real database, LLM, or permission system.
 *
 * Usage:
 *   npx tsx src/lib/bridge/examples/mock-host.ts
 *
 * This example:
 * 1. Creates an in-memory store
 * 2. Creates a mock LLM that echoes back messages
 * 3. Initializes the bridge context
 * 4. Simulates processing a message through the pipeline
 */

import { initBridgeContext } from '../context.js';
import * as router from '../channel-router.js';
import * as engine from '../interactive-turn/sdk-conversation-engine.js';
import { consumeSseEvents } from '../sse-stream-decoder.js';
import {
  normalizeReasoningEffort,
  normalizeSandboxMode,
} from '../../../runtime-options.js';
import type {
  BridgeStore,
  LLMProvider,
  StreamChatParams,
  BridgeSession,
  BridgeMessage,
} from '../host.js';
import type { ChannelBinding, ChannelDefaultTarget, ChannelType } from '../types.js';

// ── In-memory Store ─────────────────────────────────────────

class InMemoryStore implements BridgeStore {
  private settings = new Map<string, string>();
  private sessions = new Map<string, BridgeSession>();
  private bindings = new Map<string, ChannelBinding>();
  private channelDefaultTargets = new Map<string, ChannelDefaultTarget>();
  private messages = new Map<string, BridgeMessage[]>();
  private nextId = 1;

  getSetting(key: string) { return this.settings.get(key) ?? null; }

  getChannelBinding(channelType: string, chatId: string) {
    return Array.from(this.bindings.values()).find((binding) => (
      binding.channelType === channelType
      && binding.chatId === chatId
      && binding.active !== false
    )) ?? null;
  }

  upsertChannelBinding(data: { channelType: string; chatId: string; bridgeSessionId: string; workingDirectory: string; model: string; mode?: string; active?: boolean }) {
    const existing = Array.from(this.bindings.values()).find((binding) => (
      binding.channelType === data.channelType
      && binding.chatId === data.chatId
      && binding.bridgeSessionId === data.bridgeSessionId
    ));
    const id = existing?.id || `binding-${this.nextId++}`;
    const shouldActivate = data.active !== false;
    const binding: ChannelBinding = {
      id,
      channelType: data.channelType,
      chatId: data.chatId,
      bridgeSessionId: data.bridgeSessionId,
      workingDirectory: data.workingDirectory ?? existing?.workingDirectory ?? '',
      model: data.model ?? existing?.model ?? '',
      mode: (data.mode as ChannelBinding['mode']) ?? existing?.mode ?? 'code',
      active: shouldActivate ? true : existing?.active ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.bindings.set(id, binding);
    const siblings = Array.from(this.bindings.values()).filter((item) => (
      item.channelType === data.channelType && item.chatId === data.chatId
    ));
    const active = shouldActivate
      ? binding
      : siblings.find((item) => item.active !== false) || binding;
    for (const sibling of siblings) {
      this.bindings.set(sibling.id, { ...sibling, active: sibling.id === active.id });
    }
    return binding;
  }

  deleteChannelBinding(id: string) {
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    const next = Array.from(this.bindings.values()).find((item) => (
      item.channelType === binding.channelType && item.chatId === binding.chatId
    ));
    if (next) this.bindings.set(next.id, { ...next, active: true });
  }

  updateChannelBinding(id: string, updates: Partial<ChannelBinding>) {
    const existing = this.bindings.get(id);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    this.bindings.set(id, updated);
    if (updates.active === true) {
      for (const binding of this.bindings.values()) {
        if (binding.channelType === updated.channelType && binding.chatId === updated.chatId && binding.id !== id) {
          this.bindings.set(binding.id, { ...binding, active: false });
        }
      }
    }
  }

  listChannelBindings(_channelType?: ChannelType) { return Array.from(this.bindings.values()); }
  getChannelDefaultTarget(channelType: string) { return this.channelDefaultTargets.get(channelType) ?? null; }
  upsertChannelDefaultTarget(data: { channelType: string; channelProvider?: string; channelAlias?: string; bridgeSessionId: string }) {
    const existing = this.channelDefaultTargets.get(data.channelType);
    const target: ChannelDefaultTarget = {
      id: existing?.id || `channel-default-${this.nextId++}`,
      channelType: data.channelType,
      channelProvider: data.channelProvider ?? existing?.channelProvider,
      channelAlias: data.channelAlias ?? existing?.channelAlias,
      bridgeSessionId: data.bridgeSessionId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.channelDefaultTargets.set(data.channelType, target);
    return target;
  }
  deleteChannelDefaultTarget(channelType: string) { this.channelDefaultTargets.delete(channelType); }
  listChannelDefaultTargets() { return Array.from(this.channelDefaultTargets.values()); }

  getSession(id: string) { return this.sessions.get(id) ?? null; }

  listSessions() { return Array.from(this.sessions.values()); }

  findSessionByCodexThreadId(codexThreadId: string) {
    return Array.from(this.sessions.values()).find((session) => (
      session.codex_thread_id === codexThreadId
    )) ?? null;
  }

  createSession(
    name: string,
    model: string,
    _sp?: string,
    cwd?: string,
    _mode?: string,
    options?: {
      reasoningEffort?: BridgeSession['reasoning_effort'];
      sessionType?: BridgeSession['session_type'];
      hidden?: boolean;
      parentSessionId?: string;
      expiresAt?: string;
    },
  ) {
    const now = new Date().toISOString();
    const session: BridgeSession = {
      id: `session-${this.nextId++}`,
      name,
      working_directory: cwd || '/tmp',
      model,
      preferred_mode: (_mode as BridgeSession['preferred_mode']) || 'code',
      reasoning_effort: options?.reasoningEffort,
      session_type: options?.sessionType || 'normal',
      hidden: options?.hidden === true,
      parent_session_id: options?.parentSessionId,
      expires_at: options?.expiresAt,
      created_at: now,
      updated_at: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  updateSessionProviderId() {}
  updateSession(sessionId: string, updates: Partial<BridgeSession>, options?: { touch?: boolean }) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      ...updates,
      id: session.id,
      updated_at: options?.touch === false ? session.updated_at : new Date().toISOString(),
    });
  }
  deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    for (const [key, binding] of this.bindings) {
      if (binding.bridgeSessionId === sessionId) {
        this.bindings.delete(key);
      }
    }
  }
  addMessage(sessionId: string, role: string, content: string) {
    const msgs = this.messages.get(sessionId) || [];
    msgs.push({ role, content });
    this.messages.set(sessionId, msgs);
  }
  getMessages(sessionId: string) { return { messages: this.messages.get(sessionId) || [] }; }
  acquireSessionLock() { return true; }
  renewSessionLock() {}
  releaseSessionLock() {}
  setSessionRuntimeStatus() {}
  updateSessionCodexThreadId(sessionId: string, codexThreadId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.codex_thread_id = codexThreadId || undefined;
    }
  }
  updateSessionModel() {}
  syncSdkTasks() {}
  getProvider() { return undefined; }
  getDefaultProviderId() { return null; }
  insertAuditLog() {}
  checkDedup() { return false; }
  insertDedup() {}
  cleanupExpiredDedup() {}
  insertOutboundRef() {}
  insertPermissionLink() {}
  getPermissionLink() { return null; }
  markPermissionLinkResolved() { return false; }
  listPendingPermissionLinksByChat() { return []; }
  getChannelOffset() { return '0'; }
  setChannelOffset() {}
}

// ── Echo LLM (returns user input as response) ───────────────

class EchoLLM implements LLMProvider {
  streamChat(params: StreamChatParams): ReadableStream<string> {
    const response = `Echo: ${params.prompt}`;
    return new ReadableStream({
      start(controller) {
        // Emit text event
        controller.enqueue(`data: ${JSON.stringify({ type: 'text', data: response })}\n`);
        // Emit result event
        controller.enqueue(`data: ${JSON.stringify({
          type: 'result',
          data: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }),
        })}\n`);
        controller.close();
      },
    });
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('=== Codex-to-IM Bridge Mock Host Example ===\n');

  // 1. Initialize context
  const store = new InMemoryStore();
  const llm = new EchoLLM();
  initBridgeContext({
    store,
    llm,
    permissions: { resolvePendingPermission: () => true },
    lifecycle: {
      onBridgeStart: () => console.log('[lifecycle] Bridge started'),
      onBridgeStop: () => console.log('[lifecycle] Bridge stopped'),
    },
  });

  // 2. Simulate an inbound message
  const address = { channelType: 'feishu-default', chatId: '12345', displayName: 'Test User' };

  console.log('Resolving channel binding...');
  const binding = router.resolve(address);
  console.log(`  Session: ${binding.bridgeSessionId}`);
  console.log(`  CWD: ${binding.workingDirectory}\n`);

  // 3. Process message through conversation engine
  console.log('Processing message: "Hello, Codex!"');
  const result = await engine.processMessage(
    binding,
    'Hello, Codex!',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      store,
      llm,
      consumeSseEvents,
      normalizeSandboxMode,
      normalizeReasoningEffort,
    },
  );

  console.log(`\nResult:`);
  console.log(`  Response: "${result.responseText}"`);
  console.log(`  Has error: ${result.hasError}`);
  console.log(`  Token usage: ${JSON.stringify(result.tokenUsage)}`);

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
