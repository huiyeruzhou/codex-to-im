export interface MirrorRegistryBinding {
  id: string;
  channelType: string;
  bridgeSessionId: string;
  active?: boolean;
}

export interface MirrorRegistrySession {
  codex_thread_id?: string | null;
}

export interface MirrorSubscriptionRegistryPlan<TBinding extends MirrorRegistryBinding> {
  upsertBindings: TBinding[];
  removeBindingIds: string[];
}

export function buildMirrorSubscriptionRegistryPlan<TBinding extends MirrorRegistryBinding>(
  bindings: TBinding[],
  activeChannelTypes: Iterable<string>,
  existingBindingIds: Iterable<string>,
  getSession: (sessionId: string) => MirrorRegistrySession | null | undefined,
): MirrorSubscriptionRegistryPlan<TBinding> {
  const activeChannels = new Set(activeChannelTypes);
  const upsertBindings = bindings.filter((binding) => {
    if (!activeChannels.has(binding.channelType)) return false;
    const session = getSession(binding.bridgeSessionId);
    return Boolean(session?.codex_thread_id?.trim());
  });
  const desiredIds = new Set(upsertBindings.map((binding) => binding.id));
  const removeBindingIds = Array.from(existingBindingIds).filter((bindingId) => !desiredIds.has(bindingId));

  return {
    upsertBindings,
    removeBindingIds,
  };
}
