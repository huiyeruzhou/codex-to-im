import { SessionRegistryService } from '../../lib/bridge/session-registry.js';
import type { JsonFileStore } from '../../store.js';

export class UiBindingApplication {
  private readonly registry: SessionRegistryService;

  constructor(private readonly store: JsonFileStore) {
    this.registry = new SessionRegistryService(store);
  }

  switchBindingTarget(options: {
    bindingId: string;
    bridgeSessionId?: string;
    codexThreadId?: string;
  }) {
    return options.bridgeSessionId
      ? this.registry.switchBindingToBridgeSession(options.bindingId, options.bridgeSessionId)
      : this.registry.switchBindingToCodexThread(options.bindingId, options.codexThreadId!);
  }

  setChannelDefaultTarget(options: {
    channelType: string;
    bridgeSessionId?: string;
    codexThreadId?: string;
  }) {
    return options.bridgeSessionId
      ? this.registry.setChannelDefaultBridgeSession(options.channelType, options.bridgeSessionId)
      : this.registry.setChannelDefaultCodexThread(options.channelType, options.codexThreadId!);
  }

  removeChannelDefaultTarget(channelType: string): void {
    this.registry.removeChannelDefaultTarget(channelType);
  }

  removeBinding(bindingId: string): void {
    this.registry.removeBinding(bindingId);
  }
}
