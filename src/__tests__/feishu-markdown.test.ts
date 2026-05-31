import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalCardJson,
  buildRichCardContent,
  buildTaskProgressMarkdown,
  buildToolProgressMarkdown,
} from '../lib/bridge/markdown/feishu.js';

describe('buildToolProgressMarkdown', () => {
  it('renders recent tool calls and includes input/output blocks when available', () => {
    const rendered = buildToolProgressMarkdown([
      { id: '1', name: 'shell_command', status: 'running', input: '{\"cmd\":\"ls\"}', output: 'file1\\nfile2' },
      { id: '2', name: 'apply_patch', status: 'error', input: '{\"file\":\"a.ts\"}', output: 'patch failed' },
    ]);

    assert.match(rendered, /🔄 `shell_command`（运行中）/);
    assert.match(rendered, /输入：/);
    assert.match(rendered, /```json/);
    assert.match(rendered, /输出：/);
    assert.match(rendered, /```text/);
    assert.match(rendered, /❌ `apply_patch`（异常）/);
  });

  it('normalizes terminal tool state so final cards do not show running tools', () => {
    const rendered = buildToolProgressMarkdown([
      { id: '1', name: 'shell_command', status: 'running' },
      { id: '2', name: 'apply_patch', status: 'running' },
    ], { terminalStatus: 'completed' });

    assert.doesNotMatch(rendered, /运行中/);
    assert.match(rendered, /✅ `shell_command`（完成）/);
    assert.match(rendered, /✅ `apply_patch`（完成）/);
  });
});

describe('buildTaskProgressMarkdown', () => {
  it('keeps waiting state visible while streaming but not after terminal completion', () => {
    const tasks = [
      { text: '读取日志', status: 'completed' as const },
      { text: '分析原因', status: 'in_progress' as const },
      { text: '补测试', status: 'pending' as const },
    ];

    const streaming = buildTaskProgressMarkdown(tasks);
    const terminal = buildTaskProgressMarkdown(tasks, { terminalStatus: 'completed' });

    assert.match(streaming, /分析原因（执行中）/);
    assert.match(streaming, /补测试（等待中）/);
    assert.doesNotMatch(terminal, /执行中|等待中/);
    assert.match(terminal, /分析原因（已结束）/);
    assert.match(terminal, /补测试（已结束）/);
  });
});

describe('buildFinalCardJson', () => {
  it('renders terminal task and tool states without active waiting labels', () => {
    const cardJson = buildFinalCardJson(
      '最终回复',
      [
        { text: '读取日志', status: 'completed' },
        { text: '补测试', status: 'pending' },
      ],
      [
        { id: 'tool-1', name: 'shell_command', status: 'running' },
      ],
      { status: '✅ Completed', elapsed: '1m 0s' },
      'completed',
    );

    assert.doesNotMatch(cardJson, /等待中|运行中/);
    assert.match(cardJson, /补测试（已结束）/);
    assert.match(cardJson, /`shell_command`/);
  });

  it('renders title metadata as Feishu card header tags', () => {
    const cardJson = buildFinalCardJson(
      '最终回复',
      [],
      [],
      null,
      'completed',
      [],
      'chat-1',
      { title: '当前线程', tags: ['binding_id:abc12345', 'sdk', 'mirror'] },
    );

    const parsed = JSON.parse(cardJson) as any;
    assert.equal(parsed.header.title.content, '当前线程');
    assert.equal(parsed.header.template, 'blue');
    assert.equal(parsed.header.text_tag_list[0].text.content, 'binding_id:abc12345');
    assert.equal(parsed.header.text_tag_list[0].color, 'blue');
    assert.equal(parsed.header.text_tag_list[1].text.content, 'sdk');
    assert.equal(parsed.header.text_tag_list[1].color, 'green');
    assert.equal(parsed.header.text_tag_list[2].text.content, 'mirror');
    assert.equal(parsed.header.text_tag_list[2].color, 'yellow');
  });
});

describe('buildRichCardContent', () => {
  it('renders command sections and callback buttons', () => {
    const cardJson = buildRichCardContent({
      title: '最近 1 条本地 Codex 会话',
      subtitle: '点击按钮或发送纯文本命令。',
      sections: [{
        title: '1. Project A',
        fields: [
          ['目录', '/repo/a'],
          ['命令', '`/t 1`'],
        ],
        actions: [[{
          text: '接管',
          callbackData: 'cti-command::%2Ft%201',
          type: 'primary',
        }]],
      }],
      footer: ['纯文本命令：`/t 1`'],
    }, 'chat-1');

    const parsed = JSON.parse(cardJson) as any;
    assert.equal(parsed.header.title.content, '最近 1 条本地 Codex 会话');
    const content = JSON.stringify(parsed);
    assert.match(content, /Project A/);
    assert.match(content, /column_set/);
    assert.match(content, /目录/);
    assert.match(content, /\/repo\/a/);
    assert.doesNotMatch(content, /\| 项 \| 值 \|/);
    assert.doesNotMatch(content, /目录\*\*：/);
    assert.match(content, /cti-command::%2Ft%201/);
    assert.match(content, /chat-1/);
  });

  it('preserves raw markdown sections in rich cards', () => {
    const cardJson = buildRichCardContent({
      title: 'Bridge 已启动',
      template: 'turquoise',
      sections: [{
        markdown: '**全局状态**\n\n```text\nAdapter 1/1 running\n```',
      }],
    }, 'chat-1');

    const parsed = JSON.parse(cardJson) as any;
    assert.equal(parsed.header.title.content, 'Bridge 已启动');
    assert.equal(parsed.header.template, 'turquoise');
    const content = JSON.stringify(parsed);
    assert.match(content, /全局状态/);
    assert.match(content, /Adapter 1\/1 running/);
  });

  it('compresses long rich-card lists in the card body', () => {
    const cardJson = buildRichCardContent({
      title: '本地 Codex 会话',
      maxSections: 2,
      sections: [
        { title: '1. A', fields: [['目录', '/repo/a']] },
        { title: '2. B', fields: [['目录', '/repo/b']] },
        { title: '3. C', fields: [['目录', '/repo/c']] },
      ],
    });

    const parsed = JSON.parse(cardJson) as any;
    const content = JSON.stringify(parsed);
    assert.match(content, /1\. A/);
    assert.match(content, /2\. B/);
    assert.doesNotMatch(content, /3\. C/);
    assert.match(content, /已压缩显示前 2 条，折叠 1 条/);
  });

  it('renders native table components for command cards', () => {
    const cardJson = buildRichCardContent({
      title: 'tmux session 选择',
      subtitle: '点击按钮或发送纯文本命令。',
      table: {
        pageSize: 10,
        freezeFirstColumn: true,
        columns: [
          { name: 'session', displayName: 'session', width: '260px' },
          { name: 'command', displayName: '命令', width: '320px' },
          { name: 'windows', displayName: '窗口', width: '72px', horizontalAlign: 'right' },
        ],
        rows: [{
          session: '1. very-long-session-name',
          command: '/tmux-attach very-long-session-name',
          windows: 3,
        }],
      },
      sections: [],
      selects: [{
        id: 'tmux_select',
        placeholder: '选择要绑定的 tmux session',
        selectedCallbackData: 'cti-command::%2Ftmux-attach%20very-long-session-name',
        options: [{
          text: '1. very-long-session-name',
          callbackData: 'cti-command::%2Ftmux-attach%20very-long-session-name',
        }],
      }],
    }, 'chat-1');

    const parsed = JSON.parse(cardJson) as any;
    const table = parsed.body.elements.find((element: any) => element.tag === 'table');
    const select = parsed.body.elements.find((element: any) => element.tag === 'select_static');
    assert.equal(table.freeze_first_column, true);
    assert.equal(table.page_size, 10);
    assert.equal(table.columns[1].width, '320px');
    assert.equal(table.columns[2].width, '80px');
    assert.equal(table.rows[0].command, '/tmux-attach very-long-session-name');
    assert.equal(select.element_id, 'tmux_select');
    assert.equal(select.width, 'fill');
    assert.equal(select.initial_option, 'cti-command::%2Ftmux-attach%20very-long-session-name');
    assert.equal(select.options[0].value, 'cti-command::%2Ftmux-attach%20very-long-session-name');
    assert.equal(select.behaviors[0].value.chatId, 'chat-1');
  });
});
