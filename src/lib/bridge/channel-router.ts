/**
 * Channel Router — resolves IM addresses to BridgeSessions.
 *
 * When a message arrives from an IM channel, the router finds or creates
 * the corresponding ChannelBinding (and underlying chat_session).
 */

import type { ChannelAddress, ChannelBinding, ChannelType } from './types.js';
import { getBridgeContext } from './context.js';
import { SessionRegistryService } from './session-registry.js';
import { getOrCreateDraftSession } from '../../internal-sessions.js';
import { recordBindingChange } from './binding-audit.js';

/**
 * Resolve an inbound address to a ChannelBinding.
 * If no binding exists, auto-creates a new session and binding.
 */
export function resolve(address: ChannelAddress): ChannelBinding {
  const { store } = getBridgeContext();
  const registry = new SessionRegistryService(store);
  const existing = store.getChannelBinding(address.channelType, address.chatId);
  if (existing) {
    // Verify the linked session still exists; if not, create a new one
    const session = store.getSession(existing.bridgeSessionId);
    if (session) {
      const updates: Partial<ChannelBinding> = {};
      if (address.userId && address.userId !== existing.chatUserId) {
        updates.chatUserId = address.userId;
      }
      if (address.displayName && address.displayName !== existing.chatDisplayName) {
        updates.chatDisplayName = address.displayName;
      }
      if (Object.keys(updates).length > 0) {
        store.updateChannelBinding(existing.id, updates);
        return store.getChannelBinding(address.channelType, address.chatId) || { ...existing, ...updates };
      }
      return existing;
    }
    // Session was deleted — recreate
    const created = createBinding(address);
    recordBindingChange(store, {
      action: 'auto_recreate_missing_session',
      address,
      fromBinding: existing,
      toBinding: created,
      reason: 'bound session was missing',
    });
    return created;
  }
  const channelDefaultTarget = store.getChannelDefaultTarget(address.channelType);
  if (channelDefaultTarget) {
    try {
      const created = registry.bindChatToBridgeSession(address, channelDefaultTarget.bridgeSessionId);
      if (!created) {
        throw new Error('Session not found.');
      }
      store.deleteChannelDefaultTarget(address.channelType);
      recordBindingChange(store, {
        action: 'auto_create_prebound',
        address,
        fromBinding: null,
        toBinding: created,
        reason: `channel default bridge session ${channelDefaultTarget.bridgeSessionId}`,
      });
      return created;
    } catch (error) {
      store.deleteChannelDefaultTarget(address.channelType);
      console.warn(
        `[channel-router] Failed to apply channel default target for ${address.channelType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const created = createBinding(address);
  recordBindingChange(store, {
    action: 'auto_create_draft',
    address,
    fromBinding: null,
    toBinding: created,
    reason: channelDefaultTarget
      ? `channel default bridge session ${channelDefaultTarget.bridgeSessionId} was unavailable`
      : 'no existing binding',
  });
  return created;
}

/**
 * Create a new binding.
 * Without a working directory it starts in the hidden draft thread (/t 0).
 * With a working directory it creates a regular visible code session.
 */
export function createBinding(
  address: ChannelAddress,
  workingDirectory?: string,
): ChannelBinding {
  const { store } = getBridgeContext();
  const defaultProviderId = store.getSetting('bridge_default_provider_id') || '';
  const defaultModel = store.getSetting('bridge_default_model') || '';
  const session = workingDirectory
    ? store.createSession(
        `Bridge: ${address.displayName || address.chatId}`,
        defaultModel,
        undefined,
        workingDirectory,
        undefined,
      )
    : getOrCreateDraftSession(store, address);

  if (defaultProviderId) {
    store.updateSessionProviderId(session.id, defaultProviderId);
  }

  return store.upsertChannelBinding({
    channelType: address.channelType,
    chatId: address.chatId,
    chatUserId: address.userId,
    chatDisplayName: address.displayName,
    bridgeSessionId: session.id,
    workingDirectory: session.working_directory,
    model: session.model,
    mode: session.preferred_mode || (workingDirectory ? 'code' : 'ask'),
  });
}

/**
 * Bind an IM chat to an existing BridgeSession.
 */
export function bindToSession(
  address: ChannelAddress,
  bridgeSessionId: string,
  opts?: { active?: boolean },
): ChannelBinding | null {
  return new SessionRegistryService(getBridgeContext().store)
    .bindChatToBridgeSession(address, bridgeSessionId, opts);
}

/**
 * Bind an IM chat to an existing Codex thread, importing it into the bridge store on demand.
 */
export function bindToCodexThread(
  address: ChannelAddress,
  codexThreadId: string,
  opts?: { workingDirectory?: string; model?: string; displayName?: string; name?: string; codexTitle?: string; active?: boolean },
): ChannelBinding {
  return new SessionRegistryService(getBridgeContext().store)
    .importCodexThreadForChat(address, codexThreadId, opts);
}

/**
 * Update properties of an existing binding.
 */
export function updateBinding(
  id: string,
  updates: Partial<Pick<ChannelBinding, 'workingDirectory' | 'model' | 'mode' | 'active'>>,
): void {
  getBridgeContext().store.updateChannelBinding(id, updates);
}

/**
 * List all bindings, optionally filtered by channel type.
 */
export function listBindings(channelType?: ChannelType): ChannelBinding[] {
  return getBridgeContext().store.listChannelBindings(channelType);
}
