export function formatStreamContextId(value: string | null | undefined, fallback = ''): string {
  const normalized = value?.trim() || fallback.trim();
  return normalized ? normalized.slice(0, 8) : '';
}

export function buildStreamContextTags(context: {
  bindingId?: string | null;
  fallbackId?: string | null;
  bridgeSessionId?: string | null;
  codexThreadId?: string | null;
  executionProvider?: string | null;
  creatorKind?: string | null;
  source?: 'sdk' | 'mirror' | null;
}): string[] {
  const bindingId = formatStreamContextId(context.bindingId, context.fallbackId || '');
  return [
    bindingId ? `binding_id:${bindingId}` : '',
    context.source || '',
  ].filter(Boolean);
}
