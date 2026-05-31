import {
  loadConfig,
  saveConfig,
} from '../../../config.js';
import { parseSandboxMode } from '../../../runtime-options.js';
import {
  configToPayload,
  mergeConfig,
} from '../../../ui/application/config.js';
import { normalizeReasoningEffort } from './aliases.js';
import {
  buildCommandFields,
  formatReasoningEffort,
} from './presentation.js';

type ConfigPayload = ReturnType<typeof configToPayload>;

interface SettingDefinition {
  key: string;
  aliases: string[];
  label: string;
  usage: string;
  read(payload: ConfigPayload): string;
  write(payload: Record<string, unknown>, rawValue: string): { ok: true } | { ok: false; message: string };
}

function parseBoolean(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(token)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(token)) return false;
  return null;
}

function parsePositiveInt(raw: string): number | null {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function maskToken(value: string): string {
  if (!value) return '-';
  if (value.length <= 6) return '******';
  return `${'*'.repeat(Math.max(6, value.length - 4))}${value.slice(-4)}`;
}

function formatBool(value: boolean): string {
  return value ? 'on' : 'off';
}

function writeString(field: string, options: { allowDefault?: boolean } = {}) {
  return (payload: Record<string, unknown>, rawValue: string): { ok: true } => {
    const value = rawValue.trim();
    payload[field] = options.allowDefault && ['default', 'reset', 'unset', 'none'].includes(value.toLowerCase())
      ? ''
      : value;
    return { ok: true };
  };
}

function writeBoolean(field: string) {
  return (payload: Record<string, unknown>, rawValue: string): { ok: true } | { ok: false; message: string } => {
    const parsed = parseBoolean(rawValue);
    if (parsed === null) return { ok: false, message: '值必须是 on/off、true/false 或 1/0。' };
    payload[field] = parsed;
    return { ok: true };
  };
}

function writePositiveInt(field: string, min: number, max?: number) {
  return (payload: Record<string, unknown>, rawValue: string): { ok: true } | { ok: false; message: string } => {
    const parsed = parsePositiveInt(rawValue);
    if (parsed === null || parsed < min || (max !== undefined && parsed > max)) {
      return { ok: false, message: max === undefined ? `值必须是大于等于 ${min} 的整数。` : `值必须是 ${min}-${max} 的整数。` };
    }
    payload[field] = parsed;
    return { ok: true };
  };
}

const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'defaultWorkspaceRoot',
    aliases: ['workspace', 'workspaceRoot', 'root', 'newRoot'],
    label: '/new 相对路径根目录',
    usage: '/set defaultWorkspaceRoot /abs/path',
    read: (payload) => payload.defaultWorkspaceRoot || '-',
    write: writeString('defaultWorkspaceRoot', { allowDefault: true }),
  },
  {
    key: 'defaultModel',
    aliases: ['model'],
    label: '默认模型',
    usage: '/set defaultModel gpt-5 或 /set defaultModel default',
    read: (payload) => payload.defaultModel || '-',
    write: writeString('defaultModel', { allowDefault: true }),
  },
  {
    key: 'defaultMode',
    aliases: ['mode'],
    label: '默认模式',
    usage: '/set defaultMode normal|yolo',
    read: (payload) => payload.defaultMode || 'normal',
    write(payload, rawValue) {
      const token = rawValue.trim().toLowerCase();
      if (token === 'normal' || token === 'code') {
        payload.defaultMode = 'normal';
        return { ok: true };
      }
      if (token === 'yolo') {
        payload.defaultMode = 'yolo';
        return { ok: true };
      }
      return { ok: false, message: '默认模式必须是 normal 或 yolo。' };
    },
  },
  {
    key: 'historyMessageLimit',
    aliases: ['history', 'hisLimit'],
    label: '历史消息条数',
    usage: '/set historyMessageLimit 8',
    read: (payload) => `${payload.historyMessageLimit}`,
    write: writePositiveInt('historyMessageLimit', 1, 20),
  },
  {
    key: 'streamStatusIdleStartSeconds',
    aliases: ['streamIdle', 'idleStart'],
    label: '流式状态启动秒数',
    usage: '/set streamStatusIdleStartSeconds 180',
    read: (payload) => `${payload.streamStatusIdleStartSeconds}`,
    write: writePositiveInt('streamStatusIdleStartSeconds', 1),
  },
  {
    key: 'streamStatusCheckIntervalSeconds',
    aliases: ['streamCheck', 'statusInterval'],
    label: '流式状态检查间隔秒数',
    usage: '/set streamStatusCheckIntervalSeconds 10',
    read: (payload) => `${payload.streamStatusCheckIntervalSeconds}`,
    write: writePositiveInt('streamStatusCheckIntervalSeconds', 1),
  },
  {
    key: 'codexSkipGitRepoCheck',
    aliases: ['skipGitRepoCheck', 'skipGitCheck'],
    label: '跳过 Git 仓库检查',
    usage: '/set codexSkipGitRepoCheck on|off',
    read: (payload) => formatBool(payload.codexSkipGitRepoCheck),
    write: writeBoolean('codexSkipGitRepoCheck'),
  },
  {
    key: 'codexSandboxMode',
    aliases: ['sandbox', 'sandboxMode'],
    label: 'Codex 文件系统权限',
    usage: '/set codexSandboxMode read-only|workspace-write|danger-full-access',
    read: (payload) => payload.codexSandboxMode,
    write(payload, rawValue) {
      const parsed = parseSandboxMode(rawValue.trim());
      if (!parsed) return { ok: false, message: 'sandbox 必须是 read-only、workspace-write 或 danger-full-access。' };
      payload.codexSandboxMode = parsed;
      return { ok: true };
    },
  },
  {
    key: 'codexNetworkAccess',
    aliases: ['network', 'networkAccess', 'net'],
    label: 'Codex 网络访问',
    usage: '/set codexNetworkAccess on|off',
    read: (payload) => formatBool(payload.codexNetworkAccess),
    write: writeBoolean('codexNetworkAccess'),
  },
  {
    key: 'codexReasoningEffort',
    aliases: ['reasoning', 'reasoningEffort'],
    label: 'Codex 思考级别',
    usage: '/set codexReasoningEffort minimal|low|medium|high|xhigh',
    read: (payload) => formatReasoningEffort(payload.codexReasoningEffort),
    write(payload, rawValue) {
      const parsed = normalizeReasoningEffort(rawValue);
      if (!parsed) return { ok: false, message: 'reasoning 必须是 minimal、low、medium、high、xhigh 或 1-5。' };
      payload.codexReasoningEffort = parsed;
      return { ok: true };
    },
  },
  {
    key: 'sdkToolCallDetailsInText',
    aliases: ['toolDetails', 'tools', 'sdkDetails'],
    label: 'SDK 工具详情',
    usage: '/set sdkToolCallDetailsInText on|off',
    read: (payload) => formatBool(payload.sdkToolCallDetailsInText),
    write: writeBoolean('sdkToolCallDetailsInText'),
  },
  {
    key: 'uiAllowLan',
    aliases: ['allowLan', 'uiLan'],
    label: 'UI 允许 LAN 访问',
    usage: '/set uiAllowLan on|off',
    read: (payload) => formatBool(payload.uiAllowLan),
    write: writeBoolean('uiAllowLan'),
  },
  {
    key: 'uiAccessToken',
    aliases: ['accessToken', 'uiToken'],
    label: 'UI 访问 token',
    usage: '/set uiAccessToken <token>',
    read: (payload) => maskToken(payload.uiAccessToken || ''),
    write: writeString('uiAccessToken'),
  },
];

const SETTING_BY_NAME = new Map<string, SettingDefinition>();
for (const definition of SETTING_DEFINITIONS) {
  SETTING_BY_NAME.set(definition.key.toLowerCase(), definition);
  for (const alias of definition.aliases) {
    SETTING_BY_NAME.set(alias.toLowerCase(), definition);
  }
}

function findSetting(raw: string): SettingDefinition | undefined {
  return SETTING_BY_NAME.get(raw.trim().toLowerCase());
}

function parseSetArgs(raw: string): { action: 'show-all' } | { action: 'show-one'; key: string } | { action: 'set'; key: string; value: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { action: 'show-all' };

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex > 0) {
    return {
      action: 'set',
      key: trimmed.slice(0, eqIndex).trim(),
      value: trimmed.slice(eqIndex + 1).trim(),
    };
  }

  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) return { action: 'show-all' };
  const key = match[1];
  const value = match[2]?.trim();
  return value ? { action: 'set', key, value } : { action: 'show-one', key };
}

function buildSettingsFields(payload: ConfigPayload, definitions: SettingDefinition[] = SETTING_DEFINITIONS): Array<[string, string]> {
  return definitions.map((definition) => [
    `${definition.label} (${definition.key})`,
    definition.read(payload),
  ]);
}

function buildUsageNotes(): string[] {
  return [
    '发送 `/set <key> <value>` 或 `/set <key>=<value>` 修改配置；配置保存方式与 UI 设置页相同。',
    '示例：`/set defaultWorkspaceRoot ~/cx2im`、`/set defaultMode yolo`、`/set codexNetworkAccess off`。',
    `可用 key：${SETTING_DEFINITIONS.map((definition) => definition.key).join(', ')}`,
  ];
}

export function handleSetCommand(options: {
  args: string;
  markdown: boolean;
}): string {
  const parsed = parseSetArgs(options.args);
  const currentConfig = loadConfig();
  const currentPayload = configToPayload(currentConfig);

  if (parsed.action === 'show-all') {
    return buildCommandFields('全局配置', buildSettingsFields(currentPayload), buildUsageNotes(), options.markdown);
  }

  const definition = findSetting(parsed.key);
  if (!definition) {
    return buildCommandFields(
      '未知配置项',
      [['配置项', parsed.key]],
      buildUsageNotes(),
      options.markdown,
    );
  }

  if (parsed.action === 'show-one') {
    return buildCommandFields(
      '全局配置',
      buildSettingsFields(currentPayload, [definition]),
      [`用法：\`${definition.usage}\``],
      options.markdown,
    );
  }

  const nextPayload: Record<string, unknown> = { ...currentPayload };
  const written = definition.write(nextPayload, parsed.value);
  if (!written.ok) {
    return buildCommandFields(
      '配置未更新',
      [
        ['配置项', definition.key],
        ['输入值', parsed.value],
      ],
      [written.message, `用法：\`${definition.usage}\``],
      options.markdown,
    );
  }

  const nextConfig = mergeConfig(currentConfig, nextPayload);
  saveConfig(nextConfig);
  const savedPayload = configToPayload(loadConfig());
  return buildCommandFields(
    '已更新全局配置',
    buildSettingsFields(savedPayload, [definition]),
    ['配置已保存到 `~/.codex-to-im/config.env` 与 `config.v2.json`；后续 `/new` 和 Codex 请求会读取新的全局默认值。'],
    options.markdown,
  );
}
