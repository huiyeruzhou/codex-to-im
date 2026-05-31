import { mainStyles } from './assets.js';

export function renderUiShellHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex to IM</title>
    <style>${mainStyles}</style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <p class="brand-title">Codex to IM</p>
          <p class="brand-copy">本地后台、会话共享、通道绑定和调试都走这里。</p>
        </div>
        <nav class="nav">
          <button type="button" class="nav-link active" data-page="overview">概览</button>
          <button type="button" class="nav-link" data-page="sessions">会话</button>
          <button type="button" class="nav-link" data-page="config">配置</button>
          <button type="button" class="nav-link" data-page="channels">通道</button>
          <button type="button" class="nav-link" data-page="logs">日志</button>
          <button type="button" class="nav-link" data-page="commands">命令说明</button>
        </nav>
      </aside>
      <main class="main">
        <section class="page active" data-page="overview">
          <div class="page-header">
            <div>
              <h1 class="page-title">概览</h1>
              <p class="page-copy">运行状态、后台控制和当前环境集中在这一页。</p>
            </div>
          </div>

          <section class="status-grid">
            <div class="status-card">
              <strong>运行时</strong>
              <div class="status-value" id="runtimeStatus">-</div>
            </div>
            <div class="status-card">
              <strong>Codex 会话</strong>
              <div class="status-value" id="codexSessionCount">-</div>
            </div>
            <div class="status-card">
              <strong>聊天绑定</strong>
              <div class="status-value" id="bindingCount">-</div>
            </div>
          </section>

          <div class="overview-grid">
            <section class="panel">
              <div class="panel-header">
                <div>
                  <h2>运行控制</h2>
                  <p>保存配置后，可以直接在这里启停桥接服务或刷新整体状态。</p>
                </div>
              </div>
              <div class="actions">
                <button class="primary" id="startBridgeBtn">启动桥接服务</button>
                <button id="stopBridgeBtn">停止桥接服务</button>
                <button id="restartBridgeBtn">重启桥接服务</button>
                <button id="refreshBtn">刷新状态</button>
              </div>

              <div class="panel-block">
                <p class="panel-subtitle">当前能力</p>
                <div class="notice">已接通：保存配置、后台启停、飞书凭据测试、微信扫码、Codex 会话发现、IM 绑定查看与网页侧切换。</div>
              </div>

              <div class="panel-block">
                <p class="panel-subtitle">桥接服务开机自启动</p>
                <div class="notice" id="autostartNotice">正在检查当前 Windows 任务计划程序状态…</div>
                <div class="actions" style="margin-top: 12px;">
                  <button id="refreshAutostartBtn">刷新开机自启动状态</button>
                </div>
              </div>

              <div class="panel-block">
                <p class="panel-subtitle">可选 Codex 技能</p>
                <div class="notice">桥接服务不再注入发送附件的提示词。需要让 Codex 知道“可以把本地图片/文件回发到 IM”时，请安装这个可选技能。</div>
                <div class="actions" style="margin-top: 12px;">
                  <button id="installIntegrationBtn">安装可选 Codex 技能</button>
                </div>
              </div>

              <div class="message" id="opsMessage"></div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <div>
                  <h2>当前环境</h2>
                  <p>这里显示本机运行时和关键目录，便于排查部署问题。</p>
                </div>
              </div>
              <div class="info-list">
                <div class="info-item">
                  <strong>包根目录</strong>
                  <div class="mono" id="packageRoot">-</div>
                </div>
                <div class="info-item">
                  <strong>配置目录</strong>
                  <div class="mono" id="overviewHomeStatus">-</div>
                </div>
                <div class="info-item">
                  <strong>Codex 会话根目录</strong>
                  <div class="mono" id="codexRootStatus">-</div>
                </div>
                <div class="info-item">
                  <strong>界面说明</strong>
                  <div>左侧切换页面；“会话”管理 Bridge/IM 会话和本地 Codex thread；“通道”里查看飞书/微信当前绑定并直接切换。</div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section class="page" data-page="sessions">
          <div class="page-header">
            <div>
              <h1 class="page-title">会话</h1>
              <p class="page-copy">点击任意会话可以查看 chat_history，也可以直接删除不需要的会话。</p>
            </div>
            <div class="toolbar">
              <button id="refreshCodexBtn">刷新会话</button>
            </div>
          </div>

          <section class="panel" id="codex">
            <div class="notice">这里展示 Bridge/IM 本地会话和本机 Codex 会话；不再只依赖单一客户端列表。</div>
            <div class="notice" style="margin-top: 12px;">最短路径：找到目标会话后到“通道”页切换绑定；如果会话已有 thread，也可以复制 <code>/thread 019d1da4</code> 这样的命令发给机器人。</div>
            <div class="small" id="codexSessionMeta" style="margin: 14px 0 16px;">正在加载…</div>
            <div class="session-list">
              <section class="session-section">
                <div class="session-section-head">
                  <h2 class="session-section-title">当前已绑定会话</h2>
                  <div class="session-section-meta" id="boundSessionsMeta">正在加载…</div>
                </div>
                <div id="boundSessionsList"></div>
              </section>
              <section class="session-section">
                <div class="session-section-head">
                  <h2 class="session-section-title">全部会话</h2>
                  <div class="session-section-meta" id="allSessionsMeta">正在加载…</div>
                </div>
                <div id="codexSessionsList"></div>
              </section>
            </div>
            <div class="message" id="codexMessage"></div>
          </section>
        </section>

        <section class="page" data-page="session-history">
          <div class="page-header session-history-header">
            <div class="session-history-titlebar">
              <button type="button" class="icon-btn ghost-icon" id="backToSessionsBtn" aria-label="返回会话列表" title="返回会话列表">
                <span aria-hidden="true">←</span>
              </button>
              <div>
                <h1 class="page-title session-history-title" id="sessionHistoryTitle">会话历史</h1>
                <p class="page-copy" id="sessionHistorySubtitle">查看当前 session 的 chat_history。</p>
              </div>
            </div>
            <div class="toolbar icon-toolbar">
              <button type="button" class="icon-btn" id="refreshSessionHistoryBtn" aria-label="刷新历史" title="刷新历史"><span aria-hidden="true">↻</span></button>
              <button type="button" class="icon-btn danger" id="deleteSessionBtn" aria-label="删除会话" title="删除会话"><span aria-hidden="true">⌫</span></button>
            </div>
          </div>

          <section class="panel session-history-layout">
            <div class="session-history-summary" id="sessionHistorySummary"></div>
            <div class="chat-history-list" id="sessionHistoryList">
              <div class="notice">请选择一个会话查看历史。</div>
            </div>
            <div class="message" id="sessionHistoryMessage"></div>
          </section>
        </section>

        <section class="page" data-page="config">
          <div class="page-header">
            <div>
              <h1 class="page-title">配置</h1>
              <p class="page-copy">这里维护默认工作空间、运行模式和全局行为开关。</p>
            </div>
          </div>

          <section class="panel" id="config">
            <div class="panel-header">
              <div>
                <h2>基础配置</h2>
                <p>保存后会写入本地配置目录；Runtime 和“允许在未信任 Git 目录运行 Codex”需要重启 Bridge，其余多数选项会在下一次请求生效。</p>
              </div>
              <div class="toolbar">
                <button class="primary" id="saveConfigBtn">保存配置</button>
              </div>
            </div>

            <div class="fields">
              <div class="field-row triple">
                <label>
                  Runtime
                  <select id="runtime">
                    <option value="codex" selected>codex</option>
                  </select>
                </label>
                <label>
                  默认模式
                  <select id="defaultMode">
                    <option value="normal">normal</option>
                    <option value="yolo">yolo</option>
                  </select>
                </label>
                <label>
                  <span class="field-title">/his 返回条数 <span class="help-tip" tabindex="0" data-tip="控制 IM 中 /his 或 /his msg 默认最多返回多少条最近消息；也可用 /his limit 12 修改，或用 /his msg 5、/his raw 5 临时指定本次条数。">?</span></span>
                  <input id="historyMessageLimit" type="number" min="1" max="20" value="8" />
                </label>
                <label>
                  <span class="field-title">长任务提示延迟（秒） <span class="help-tip" tabindex="0" data-tip="距离上次响应超过这个时长后，飞书长任务底部才开始显示“上次响应距今 X”。">?</span></span>
                  <input id="streamStatusIdleStartSeconds" type="number" min="1" value="180" />
                </label>
                <label>
                  <span class="field-title">长任务提示刷新间隔（秒） <span class="help-tip" tabindex="0" data-tip="长任务提示出现后，每隔多少秒刷新一次“上次响应距今 X”。">?</span></span>
                  <input id="streamStatusCheckIntervalSeconds" type="number" min="1" value="10" />
                </label>
              </div>
              <label>
                <span class="field-title">/new 相对路径根目录 <span class="help-tip" tabindex="0" data-tip="当 /new 使用项目名或相对路径时，会以这里作为根目录；留空时使用 ~/cx2im。">?</span></span>
                <input id="defaultWorkspaceRoot" placeholder="留空时使用 ~/cx2im" />
              </label>
              <div class="field-row triple">
                <label>
                  <span class="field-title">默认模型 <span class="help-tip" tabindex="0" data-tip="留空则跟随 Codex 当前默认模型；隐藏模型不会展示，本机 Codex 不支持的模型会标成“仅 IM”。">?</span></span>
                  <select id="defaultModel"></select>
                </label>
                <label>
                  <span class="field-title">Codex 文件系统权限 <span class="help-tip" tabindex="0" data-tip="设置 Codex 默认 sandbox。IM 会话仍可用命令单独覆盖。">?</span></span>
                  <select id="codexSandboxMode">
                    <option value="workspace-write">workspace-write</option>
                    <option value="read-only">read-only</option>
                    <option value="danger-full-access">danger-full-access</option>
                  </select>
                </label>
                <label>
                  <span class="field-title">Codex 思考级别 <span class="help-tip" tabindex="0" data-tip="设置 Codex 默认 reasoning effort。IM 会话仍可用命令单独覆盖。">?</span></span>
                  <select id="codexReasoningEffort">
                    <option value="medium">medium</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                  </select>
                </label>
                <label>
                  <span class="field-title">Codex 网络访问 <span class="help-tip" tabindex="0" data-tip="允许 Codex 在 workspace-write sandbox 下访问网络；IM 会话仍可用 /net 单独覆盖。">?</span></span>
                  <span class="checkbox checkbox-field">
                    <input id="codexNetworkAccess" type="checkbox" checked />
                    允许 Codex 访问网络
                  </span>
                </label>
              </div>
              <div class="checkbox-row">
                <label class="checkbox"><input id="codexSkipGitRepoCheck" type="checkbox" checked /> 允许在未信任 Git 目录运行 Codex <span class="help-tip" tabindex="0" data-tip="如果新建会话报 Not inside a trusted directory，可以打开这个选项；修改后需要重启 Bridge。">?</span></label>
              </div>
              <div class="checkbox-row" style="margin-top: 12px;">
                <label class="checkbox"><input id="sdkToolCallDetailsInText" type="checkbox" checked /> 显示 SDK 工具输入输出 <span class="help-tip" tabindex="0" data-tip="开启时，SDK 对话会展示工具调用的输入输出并写入文本预览/history；关闭时更接近 mirror，只保留工具名、状态和 Codex 正文。也可用 /ui on|off 修改。">?</span></label>
              </div>
              <div class="checkbox-row" style="margin-top: 12px;">
                <label class="checkbox"><input id="uiAllowLan" type="checkbox" /> 允许局域网访问 Web 控制台 <span class="help-tip" tabindex="0" data-tip="默认仅允许本机访问当前工作台。开启后，局域网设备需要先输入访问 token。">?</span></label>
              </div>
              <div class="notice" id="uiAccessSummary">局域网访问未开启。</div>
              <div id="uiLanDetails" hidden>
                <div class="field-row" style="margin-top: 16px;">
                  <label>
                    访问 token
                    <input id="uiAccessToken" readonly />
                  </label>
                  <div style="display: grid; gap: 10px; align-content: end;">
                    <div class="toolbar">
                      <button type="button" id="copyUiTokenBtn">复制 token</button>
                      <button type="button" id="regenerateUiTokenBtn">重新生成 token</button>
                    </div>
                    <div class="toolbar">
                      <button type="button" id="copyUiLanLinkBtn">复制局域网登录链接</button>
                    </div>
                  </div>
                </div>
                <div class="info-list" id="uiAccessUrls" style="margin-top: 16px;"></div>
              </div>
            </div>

            <div class="message" id="configMessage"></div>
          </section>
        </section>

        <section class="page" data-page="commands">
          <div class="page-header">
            <div>
              <h1 class="page-title">命令说明</h1>
              <p class="page-copy">这里列出当前桥接聊天里可用的命令，飞书和微信共用同一套语义。</p>
            </div>
          </div>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>命令使用说明</h2>
                <p>下面这些命令适用于当前桥接到的聊天通道，飞书和微信共用同一套命令语义。</p>
              </div>
            </div>

            <div class="notice" style="margin-bottom: 16px;">最短使用路径：先发 <code>/t</code> 查看本地 Codex 会话，再发 <code>/t 1</code> 接管；之后直接发送文本即可继续当前会话。</div>

            <div class="command-sections">
              <section class="command-section">
                <h3 class="command-section-title">最常用</h3>
                <div class="command-list">
                  <div class="command-list-head"><div>命令</div><div>原始命令</div><div>说明</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/</code></div><div class="command-col-original">—</div><div class="command-col-desc">查看当前聊天/当前会话诊断。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/status</code></div><div class="command-col-original"><code>/status</code></div><div class="command-col-desc">查看全局状态：通道、Bridge/UI 进程、PID、绑定与会话数量。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/check</code></div><div class="command-col-original"><code>/health</code></div><div class="command-col-desc">查看当前会话健康状态。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/check all</code></div><div class="command-col-original"><code>/health all</code></div><div class="command-col-desc">查看所有运行中会话的健康状态。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>//...</code></div><div class="command-col-original">—</div><div class="command-col-desc">向模型发送以 <code>/</code> 开头的文本，避免被当成桥接命令。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/h</code></div><div class="command-col-original"><code>/help</code></div><div class="command-col-desc">查看帮助。</div></div>
          <div class="command-item"><div class="command-col-command"><code>/t</code></div><div class="command-col-original"><code>/threads</code></div><div class="command-col-desc">文本默认最近 10 条；卡片最多列出 200 条本地 Codex 会话。</div></div>
          <div class="command-item"><div class="command-col-command"><code>/t all</code></div><div class="command-col-original"><code>/threads all</code></div><div class="command-col-desc">文本和卡片都最多列出 200 条本地 Codex 会话。</div></div>
          <div class="command-item"><div class="command-col-command"><code>/t n 100</code></div><div class="command-col-original"><code>/threads n 100</code></div><div class="command-col-desc">列出最近 100 条本地 Codex 会话，最多 200 条。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t &lt;序号|thread id|名称&gt;</code></div><div class="command-col-original"><code>/thread &lt;序号|thread id|名称&gt;</code></div><div class="command-col-desc">按序号、thread id 或唯一名称接管本地 Codex 会话，并设为当前线程。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t ls</code></div><div class="command-col-original"><code>/t ls</code></div><div class="command-col-desc">查看当前聊天已绑定线程；<code>*</code> 标记已绑定，当前激活线程会加粗显示。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t add &lt;序号|thread id|名称&gt;</code></div><div class="command-col-original"><code>/t add &lt;序号|thread id|名称&gt;</code></div><div class="command-col-desc">把Codex thread加入当前聊天，不一定切换当前线程。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t archive [序号|thread id|名称]</code></div><div class="command-col-original"><code>/t archive [序号|thread id|名称]</code></div><div class="command-col-desc">归档当前或指定本地 Codex 会话，并解除相关绑定。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t use &lt;序号|thread id|binding id|名称&gt;</code></div><div class="command-col-original"><code>/t use &lt;序号|thread id|binding id|名称&gt;</code></div><div class="command-col-desc">切换当前聊天的激活线程；序号按 <code>/t ls</code> 的绑定顺序。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t rm &lt;序号|thread id|binding id|名称&gt;</code></div><div class="command-col-original"><code>/t rm &lt;序号|thread id|binding id|名称&gt;</code></div><div class="command-col-desc">移除当前聊天的指定绑定线程；同名时需改用序号或 ID。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t rename &lt;名称&gt;</code></div><div class="command-col-original"><code>/t rename &lt;名称&gt;</code></div><div class="command-col-desc">重命名当前线程；名称不能是纯数字或类似线程/绑定 ID。</div></div>
              <div class="command-item"><div class="command-col-command"><code>/t 序号范围</code></div><div class="command-col-original"><code>/t</code> / <code>/t ls</code></div><div class="command-col-desc"><code>/t</code>、<code>/t add</code> 和 <code>/t archive</code> 使用全局本地 Codex 会话列表序号；<code>/t use</code> 和 <code>/t rm</code> 使用 <code>/t ls</code> 当前聊天局部绑定列表序号。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/n [绝对路径 | 项目名]</code></div><div class="command-col-original"><code>/new [绝对路径 | 项目名]</code></div><div class="command-col-desc">不带参数时在当前正式会话目录下新建线程；相对项目名会在“默认工作空间”下创建目录；当前若是临时草稿线程则会报错。通过 IM 创建的新线程当前只保证在 IM 中可继续，不会自动出现在本机 Codex 会话列表中。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>直接发送文本</code></div><div class="command-col-original">—</div><div class="command-col-desc">继续当前已绑定会话；未绑定时会自动进入临时草稿线程，等同先使用 <code>/t 0</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/his [N]</code></div><div class="command-col-original"><code>/history</code></div><div class="command-col-desc">把最近 N 条消息渲染成卡片发送；优先读取 Codex session JSONL，找不到再退回 Bridge 缓存。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/his msg [N]</code></div><div class="command-col-original"><code>/history msg</code></div><div class="command-col-desc">把最近 N 条消息渲染成卡片发送，可临时指定本次条数。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/his raw [N]</code></div><div class="command-col-original"><code>/history raw</code></div><div class="command-col-desc">查看解析后的纯文本视图，可临时指定本次条数；不是原始 JSONL。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/his json</code></div><div class="command-col-original"><code>/history json</code></div><div class="command-col-desc">直接发送原始 Codex session JSONL 文件，不做二次包装。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/his limit 12</code></div><div class="command-col-original"><code>/history limit 12</code></div><div class="command-col-desc">修改 /his 默认返回条数限制（1-20）。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/shell &lt;command&gt;</code></div><div class="command-col-original"><code>/shell</code></div><div class="command-col-desc">在当前会话目录通过 <code>codex sandbox</code> 直接执行命令；默认 workspace-write，支持 <code>--sandbox read-only</code>，高风险命令需 <code>--force</code>，不允许 danger-full-access。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/auto ls</code></div><div class="command-col-original"><code>/auto ls</code></div><div class="command-col-desc">查看当前 bridge session 的自动化任务；飞书会返回绿色卡片。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/auto new &lt;scriptpath&gt; &lt;times&gt;</code></div><div class="command-col-original"><code>/auto new</code></div><div class="command-col-desc">创建 session 级自动化任务；脚本 stdout 会作为下一轮 Codex prompt。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/auto rm &lt;序号&gt;</code></div><div class="command-col-original"><code>/auto rm</code></div><div class="command-col-desc">按 <code>/auto ls</code> 的序号删除自动化任务。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/auto set &lt;序号&gt; &lt;times&gt;</code></div><div class="command-col-original"><code>/auto set</code></div><div class="command-col-desc">重置触发次数并设置总次数；<code>0</code> 表示暂停。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/auto skill install|uninstall</code></div><div class="command-col-original"><code>/auto skill</code></div><div class="command-col-desc">安装或删除“如何创建 /auto 脚本”的 Codex skill。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-switch</code></div><div class="command-col-original"><code>/tmux-switch</code></div><div class="command-col-desc">列出 tmux sessions，按 <code>/tmux-attach &lt;session&gt;</code> 选择。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-screen 5s</code></div><div class="command-col-original"><code>/tmux-screen [lines] [seconds]s</code></div><div class="command-col-desc">查看当前屏幕；可临时指定行数并按秒定时刷新，例如 <code>/tmux-screen 120 5s</code>。最低 3 秒一次，用 <code>/tmux-screen stop</code> 停止。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux pwd&lt;Enter&gt;</code></div><div class="command-col-original"><code>/tmux ...</code></div><div class="command-col-desc">向当前绑定的 tmux session 发送按键并自动截屏返回。</div></div>
                </div>
              </section>

              <section class="command-section">
                <h3 class="command-section-title">设置与切换</h3>
                <div class="command-list">
                  <div class="command-list-head"><div>命令</div><div>原始命令</div><div>说明</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/m</code></div><div class="command-col-original"><code>/mode</code></div><div class="command-col-desc">查看当前模式；可选 <code>normal</code>、<code>yolo</code>，<code>code</code> 会映射为 <code>normal</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/provider</code></div><div class="command-col-original"><code>/provider</code></div><div class="command-col-desc">查看或切换当前 IM 会话使用的 Codex Provider；可选 <code>sdk</code>、<code>tmux</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/r</code></div><div class="command-col-original"><code>/reasoning</code></div><div class="command-col-desc">查看当前思考级别；可选 <code>1=minimal</code>、<code>2=low</code>、<code>3=medium</code>、<code>4=high</code>、<code>5=xhigh</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/sb</code></div><div class="command-col-original"><code>/sandbox</code></div><div class="command-col-desc">查看或切换当前 IM 会话的 Codex 沙箱；可选 <code>read-only</code>、<code>workspace-write</code>、<code>danger-full-access</code>、<code>default</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/net</code></div><div class="command-col-original"><code>/network</code></div><div class="command-col-desc">查看或切换当前 IM 会话的网络访问；可选 <code>on</code>、<code>off</code>、<code>default</code>。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/ui on|off</code></div><div class="command-col-original">—</div><div class="command-col-desc">查看或切换 SDK 工具输入输出显示；关闭后更接近 mirror，只保留工具名、状态和正文。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/model [slug|default]</code></div><div class="command-col-original"><code>/model [slug|default]</code></div><div class="command-col-desc">查看或切换当前 IM 会话使用的模型；本机 Codex 不支持的模型会标注“仅 IM”，共享 Codex thread 只允许查看不允许切换。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-attach &lt;session&gt;</code></div><div class="command-col-original"><code>/tmux-attach &lt;session&gt;</code></div><div class="command-col-desc">把当前 IM 会话绑定到一个远程 tmux session。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-new [session]</code></div><div class="command-col-original"><code>/tmux-new [session]</code></div><div class="command-col-desc">新建并绑定 tmux session；如果已存在，会提示并直接绑定。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-status</code></div><div class="command-col-original"><code>/tmux-status</code></div><div class="command-col-desc">查看当前 tmux 绑定和自动截屏行数。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-screen stop</code></div><div class="command-col-original"><code>/tmux-screen stop</code></div><div class="command-col-desc">停止当前聊天的 tmux 屏幕定时刷新。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-set lines 120</code></div><div class="command-col-original"><code>/tmux-set lines 120</code></div><div class="command-col-desc">设置 <code>/tmux</code> 返回的截屏行数，范围 0-500。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/tmux-set enter on</code></div><div class="command-col-original"><code>/tmux-set enter on|off</code></div><div class="command-col-desc">设置 <code>/tmux</code> 每次发送内容后是否自动补 Enter。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/t 0</code></div><div class="command-col-original"><code>/thread 0</code></div><div class="command-col-desc">切换到当前聊天的临时草稿线程。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/t 0 reset</code></div><div class="command-col-original"><code>/thread 0 reset</code></div><div class="command-col-desc">丢弃当前草稿上下文并重建一条新的草稿线程。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/stop</code></div><div class="command-col-original"><code>/stop</code></div><div class="command-col-desc">停止当前任务。</div></div>
                </div>
              </section>

              <section class="command-section">
                <h3 class="command-section-title">文件</h3>
                <div class="command-list">
                  <div class="command-list-head"><div>命令</div><div>原始命令</div><div>说明</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/cat &lt;path&gt; [start] [end]</code></div><div class="command-col-original"><code>/cat &lt;path&gt; [start] [end]</code></div><div class="command-col-desc">打印文件内容；未指定行号时默认读取前 200 行。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/file &lt;path&gt;</code></div><div class="command-col-original"><code>/file &lt;path&gt;</code></div><div class="command-col-desc">直接发送本地文件。</div></div>
                </div>
              </section>

              <section class="command-section">
                <h3 class="command-section-title">权限</h3>
                <div class="command-list">
                  <div class="command-list-head"><div>命令</div><div>原始命令</div><div>说明</div></div>
                  <div class="command-item"><div class="command-col-command"><code>/perm allow|allow_session|deny &lt;id&gt;</code></div><div class="command-col-original"><code>/perm allow|allow_session|deny &lt;id&gt;</code></div><div class="command-col-desc">文本方式处理一个待批准权限。</div></div>
                  <div class="command-item"><div class="command-col-command"><code>1 / 2 / 3</code></div><div class="command-col-original">—</div><div class="command-col-desc">快速处理单个待批准权限。</div></div>
                </div>
              </section>
            </div>
          </section>
        </section>

        <section class="page" data-page="channels">
          <div class="page-header">
            <div>
              <h1 class="page-title">通道</h1>
              <p class="page-copy">每个通道都显示当前绑定的会话，并支持在网页里直接改绑。</p>
            </div>
          </div>

        <section class="panel channel-workspace">
          <div class="panel-header">
            <div class="channel-header-copy">
              <h2>通道实例</h2>
              <p>这里管理多个飞书或微信机器人实例。实例只是不同聊天入口，不会改变 Codex 的会话语义。</p>
            </div>
            <div class="channel-header-actions">
              <div class="channel-action-group">
                <div class="channel-action-label">新通道</div>
                <div class="channel-action-row">
                  <select id="newChannelProvider">
                    <option value="feishu">飞书</option>
                    <option value="weixin">微信</option>
                  </select>
                  <button class="primary channel-create-button" id="createChannelBtn">新增通道</button>
                </div>
                <div class="channel-action-hint">先选择通道类型，再创建一个新的机器人实例。</div>
              </div>
              <div class="channel-action-group">
                <div class="channel-action-label">状态同步</div>
                <div class="channel-action-row">
                  <button class="channel-refresh-button" id="refreshChannelsBtn">刷新状态</button>
                </div>
                <div class="channel-action-hint">手动拉取最新通道状态和当前绑定信息。</div>
              </div>
            </div>
          </div>

            <div class="channel-layout">
              <aside class="channel-sidebar">
                <div class="channel-sidebar-meta" id="channelListMeta">正在加载…</div>
                <div class="channel-list" id="channelList"></div>
              </aside>
              <section class="channel-editor" id="channelEditor">
                <div class="binding-empty">正在加载通道配置…</div>
              </section>
            </div>
            <div class="message" id="channelMessage"></div>
          </section>
        </section>

        <section class="page" data-page="logs">
          <div class="page-header">
            <div>
              <h1 class="page-title">日志</h1>
              <p class="page-copy">日志页只负责查看 bridge 日志，便于排查运行和通道问题。</p>
            </div>
            <div class="toolbar">
              <button id="refreshLogsBtn">刷新日志</button>
            </div>
          </div>

          <section class="panel logs-panel" id="logs">
            <div class="logs" id="logsOutput">等待加载日志…</div>
          </section>
        </section>
      </main>
    </div>
    <div id="globalMessageHost" class="global-message-host" aria-live="polite"></div>
    <div id="sessionChannelModal" class="modal-backdrop" hidden>
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="sessionChannelModalTitle">
        <div class="modal-head">
          <div>
            <h2 id="sessionChannelModalTitle">指定通道</h2>
            <p id="sessionChannelModalSubtitle">选择一个聊天入口，将它切换到当前会话。</p>
          </div>
          <button type="button" class="icon-btn ghost-icon" data-action="close-session-channel-modal" aria-label="关闭" title="关闭"><span aria-hidden="true">×</span></button>
        </div>
        <div id="sessionChannelModalList" class="modal-list"></div>
      </section>
    </div>
    <div id="sessionRenameModal" class="modal-backdrop" hidden>
      <section class="modal-card modal-card-narrow" role="dialog" aria-modal="true" aria-labelledby="sessionRenameTitle">
        <div class="modal-head">
          <div>
            <h2 id="sessionRenameTitle">重命名会话</h2>
            <p id="sessionRenameSubtitle">给当前会话设置一个更好识别的名字。</p>
          </div>
          <button type="button" class="icon-btn ghost-icon" data-action="close-session-rename-modal" aria-label="关闭" title="关闭"><span aria-hidden="true">×</span></button>
        </div>
        <label>
          会话名称
          <input id="sessionRenameInput" />
        </label>
        <div class="toolbar modal-actions">
          <button type="button" data-action="close-session-rename-modal">取消</button>
          <button type="button" class="primary" data-action="save-session-rename">保存名称</button>
        </div>
      </section>
    </div>
    <div id="sessionConfigModal" class="modal-backdrop" hidden>
      <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="sessionConfigTitle">
        <div class="modal-head">
          <div>
            <h2 id="sessionConfigTitle">会话配置</h2>
            <p id="sessionConfigSubtitle">这些设置只影响当前会话。</p>
          </div>
          <button type="button" class="icon-btn ghost-icon" data-action="close-session-config-modal" aria-label="关闭" title="关闭"><span aria-hidden="true">×</span></button>
        </div>
        <div class="fields">
          <div class="field-row">
            <label>会话名称<input id="sessionConfigName" /></label>
            <label>工作目录<input id="sessionConfigCwd" /></label>
          </div>
          <div class="field-row triple">
            <label>模型<select id="sessionConfigModel"></select></label>
            <label>默认模式<select id="sessionConfigMode"><option value="normal">normal</option><option value="yolo">yolo</option></select></label>
            <label>Codex Provider<select id="sessionConfigProvider"><option value="">default</option><option value="sdk">sdk</option><option value="tmux">tmux</option></select></label>
            <label>思考级别<select id="sessionConfigReasoning"><option value="">跟随全局</option><option value="medium">medium</option><option value="minimal">minimal</option><option value="low">low</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>
          </div>
          <div class="field-row">
            <label>文件系统权限<select id="sessionConfigSandbox"><option value="">跟随全局</option><option value="workspace-write">workspace-write</option><option value="read-only">read-only</option><option value="danger-full-access">danger-full-access</option></select></label>
            <label>网络访问<span class="checkbox checkbox-field"><input id="sessionConfigNetwork" type="checkbox" /> 允许 Codex 访问网络</span></label>
          </div>
          <label>系统提示<textarea id="sessionConfigPrompt" placeholder="留空则不覆盖系统提示"></textarea></label>
        </div>
        <div class="toolbar modal-actions">
          <button type="button" data-action="close-session-config-modal">取消</button>
          <button type="button" class="primary" data-action="save-session-config">保存配置</button>
        </div>
      </section>
    </div>

    <script>
      const state = {
        config: null,
        availableModels: [],
        uiAccess: null,
        bridgeStatus: null,
        autostartStatus: null,
        codexSessions: [],
        codexSessionCounts: null,
        bindings: [],
        bindingOptions: [],
        channelDefaults: [],
        activeBindingByChannelId: {},
        weixinAccounts: [],
        codexRoot: '',
        activePage: 'overview',
        activeSessionRef: '',
        sessionHistory: null,
        sessionHistoryMessageModes: {},
        activeChannelId: '',
        channelDraft: null,
        activeSessionRenameRef: '',
        activeSessionConfigBridgeSessionId: '',
        creatorDisplayBySessionRef: {},
        channelEditorDrafts: {},
        weixinLoginPollers: {},
        pageRefreshTimer: null,
        pageRefreshInFlight: {},
      };

      function escapeHtml(value) {
        return String(value || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;');
      }

      function setText(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
      }

      function actionIcon(name) {
        const icons = {
          copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8.5A2.5 2.5 0 0 1 10.5 6h7A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-7A2.5 2.5 0 0 1 8 15.5v-7Z"/><path d="M5.5 14H5a2 2 0 0 1-2-2V5.5A2.5 2.5 0 0 1 5.5 3H12a2 2 0 0 1 2 2v.5"/></svg>',
          command: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9 3 3-3 3"/><path d="M13 15h3"/><path d="M4 5h16v14H4z"/></svg>',
          channel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7-6 10-6 10S6 15 6 8Z"/><path d="M10 8a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></svg>',
          swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11"/><path d="m15 4 3 3-3 3"/><path d="M17 17H6"/><path d="m9 14-3 3 3 3"/></svg>',
          edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13 7 4 4"/></svg>',
          settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
          delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
          raw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/></svg>',
          markdown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M7 15V9l3 3 3-3v6"/><path d="M17 9v6"/><path d="m15 13 2 2 2-2"/></svg>',
        };
        return icons[name] || '';
      }

      function iconButton(action, iconName, label, attrs, extraClass) {
        return '<button type="button" class="icon-btn ' + escapeHtml(extraClass || '') + '" data-action="' + escapeHtml(action) + '"'
          + (attrs ? ' ' + attrs : '')
          + ' aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">'
          + actionIcon(iconName)
          + '</button>';
      }

      function disabledIconButton(iconName, label, extraClass) {
        return '<button type="button" class="icon-btn ' + escapeHtml(extraClass || '') + '" disabled aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">'
          + actionIcon(iconName)
          + '</button>';
      }

      function renderDefaultModelOptions(config) {
        const options = Array.isArray(config && config.availableModels) ? config.availableModels : [];
        state.availableModels = options;

        const select = document.getElementById('defaultModel');
        const currentValue = config && typeof config.defaultModel === 'string' ? config.defaultModel : '';
        const codexDefaultModel = config && typeof config.codexDefaultModel === 'string' ? config.codexDefaultModel : '';
        const items = [];
        const seen = new Set();

        items.push(
          '<option value="">' + escapeHtml(
            codexDefaultModel
              ? '跟随 Codex 默认模型（当前 ' + codexDefaultModel + '）'
              : '跟随 Codex 默认模型'
          ) + '</option>'
        );

        for (const model of options) {
          if (!model || typeof model.slug !== 'string' || !model.slug) continue;
          if (seen.has(model.slug)) continue;
          seen.add(model.slug);
          const label = model.slug + (model.supportedInApi === false ? '（仅 IM）' : '');
          items.push(
            '<option value="' + escapeHtml(model.slug) + '">' + escapeHtml(label) + '</option>'
          );
        }

        if (currentValue && !seen.has(currentValue)) {
          items.push(
            '<option value="' + escapeHtml(currentValue) + '">当前配置值（已不可用）：' + escapeHtml(currentValue) + '</option>'
          );
        }

        select.innerHTML = items.join('');
        select.value = currentValue;
      }

      function renderModelOptionsForSelect(select, currentValue, emptyLabel) {
        const config = state.config || {};
        const options = Array.isArray(state.availableModels) ? state.availableModels : [];
        const codexDefaultModel = typeof config.codexDefaultModel === 'string' ? config.codexDefaultModel : '';
        const value = typeof currentValue === 'string' ? currentValue : '';
        const items = [];
        const seen = new Set();
        items.push('<option value="">' + escapeHtml(emptyLabel || (codexDefaultModel ? '跟随全局 / Codex 默认（当前 ' + codexDefaultModel + '）' : '跟随全局 / Codex 默认')) + '</option>');
        for (const model of options) {
          if (!model || typeof model.slug !== 'string' || !model.slug) continue;
          if (seen.has(model.slug)) continue;
          seen.add(model.slug);
          items.push('<option value="' + escapeHtml(model.slug) + '">' + escapeHtml(model.slug + (model.supportedInApi === false ? '（仅 IM）' : '')) + '</option>');
        }
        if (value && !seen.has(value)) {
          items.push('<option value="' + escapeHtml(value) + '">当前会话值（已不可用）：' + escapeHtml(value) + '</option>');
        }
        select.innerHTML = items.join('');
        select.value = value;
      }

      function shortId(value) {
        if (!value) return '-';
        return value.length > 14 ? value.slice(0, 8) + '...' + value.slice(-4) : value;
      }

      function shortThreadCommand(value) {
        if (!value) return '/thread';
        return '/thread ' + value.slice(0, 12);
      }

      function canConfigureSession(session) {
        return Boolean(session && (session.kind === 'bridge' || session.sessionId || bindingsForSession(session).length > 0));
      }

      function sessionBridgeSessionId(session) {
        return (session && (session.bridgeSessionId || session.sessionId)) || '';
      }

      function sessionCodexThreadId(session) {
        return (session && (session.codexThreadId || session.threadId)) || '';
      }

      function sessionRef(session) {
        const bridgeSessionId = sessionBridgeSessionId(session);
        if (bridgeSessionId) return 'bridge:' + bridgeSessionId;
        const codexThreadId = sessionCodexThreadId(session);
        return codexThreadId ? 'codex:' + codexThreadId : '';
      }

      function sessionIdentityAttrs(session) {
        const bridgeSessionId = sessionBridgeSessionId(session);
        const codexThreadId = sessionCodexThreadId(session);
        return 'data-session-ref="' + escapeHtml(sessionRef(session)) + '"'
          + (bridgeSessionId ? ' data-bridge-session-id="' + escapeHtml(bridgeSessionId) + '"' : '')
          + (codexThreadId ? ' data-codex-thread-id="' + escapeHtml(codexThreadId) + '"' : '');
      }

      function sessionIdentityPayload(ref) {
        const value = String(ref || '');
        if (value.startsWith('bridge:')) return { bridgeSessionId: value.slice('bridge:'.length) };
        if (value.startsWith('codex:')) return { codexThreadId: value.slice('codex:'.length) };
        return {};
      }

      function sessionHistoryQuery(ref) {
        const identity = sessionIdentityPayload(ref);
        const params = new URLSearchParams();
        if (identity.bridgeSessionId) params.set('bridgeSessionId', identity.bridgeSessionId);
        if (identity.codexThreadId) params.set('codexThreadId', identity.codexThreadId);
        return params.toString();
      }

      function sessionCreatorTag(session) {
        if (session && session.creatorLabel && session.creatorClass) {
          return { label: session.creatorLabel, className: session.creatorClass };
        }
        if (session && session.creatorKind === 'bridge') return { label: 'Bridge', className: 'bridge' };
        if (session && session.creatorKind === 'sdk') return { label: 'SDK', className: 'sdk' };
        if (session && session.creatorKind === 'vscode') return { label: 'VS Code', className: 'vscode' };
        if (session && session.creatorKind === 'tui_cli') return { label: 'TUI / CLI', className: 'tui' };
        return { label: 'Native', className: 'native' };
      }

      function renderCreatorBadge(session) {
        const tag = sessionCreatorTag(session);
        return '<span class="pill pill-' + escapeHtml(tag.className) + '">' + escapeHtml(tag.label) + '</span>';
      }

      function renderCreatorToggle(session) {
        const ref = sessionRef(session);
        const codexSource = session.codexSource || {};
        const rawSource = codexSource.source || session.source || 'Native';
        const rawOriginator = codexSource.originator || session.originator || '';
        const raw = rawSource + (rawOriginator ? ' / ' + rawOriginator : '');
        const content = state.creatorDisplayBySessionRef[ref] === 'raw'
          ? escapeHtml(raw)
          : renderCreatorBadge(session);
        return '<button type="button" class="creator-toggle" data-action="toggle-creator-display" ' + sessionIdentityAttrs(session) + ' title="点击切换 Creator / CodexSource 显示">' + content + '</button>';
      }

      function renderModeProviderValue(mode, provider) {
        return ''
          + '<div class="session-value">Mode: <code>' + escapeHtml(mode || 'normal') + '</code></div>'
          + '<div class="session-value">Provider: <code>' + escapeHtml(provider || 'default') + '</code></div>';
      }

      function renderSessionTitle(session, marksHtml) {
        return ''
          + '<div class="session-title-row">'
          +   '<span class="session-title" title="' + escapeHtml(session.title || 'Untitled Session') + '">' + escapeHtml(session.title || 'Untitled Session') + '</span>'
          +   (marksHtml || '')
          +   iconButton('open-session-rename-modal', 'edit', '重命名会话', sessionIdentityAttrs(session), 'mini-icon')
          + '</div>';
      }

      function pathSegments(value) {
        const normalized = String(value || '').split('/').join('\\\\');
        return normalized.split('\\\\').filter(Boolean);
      }

      function baseName(value) {
        const segments = pathSegments(value);
        return segments[segments.length - 1] || value || '(no cwd)';
      }

      function formatTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('zh-CN', { hour12: false });
      }

      function optionLabel(option) {
        return option.label + ' · ' + option.description;
      }

      function sessionFromBindingOption(option) {
        const isBridge = option.kind === 'session';
        return {
          kind: isBridge ? 'bridge' : 'codex',
          bridgeSessionId: option.bridgeSessionId || option.sessionId || (isBridge ? option.id : ''),
          codexThreadId: option.codexThreadId || option.threadId || (isBridge ? '' : option.id),
          sessionId: option.sessionId || (isBridge ? option.id : ''),
          threadId: option.threadId || (isBridge ? '' : option.id),
          title: option.label,
          cwd: option.cwd || '',
          originator: isBridge ? 'Bridge / IM' : 'Codex Native',
          source: isBridge ? 'bridge' : 'codex',
          creatorKind: isBridge ? 'bridge' : 'native',
          creatorLabel: isBridge ? 'Bridge' : 'Native',
          creatorClass: isBridge ? 'bridge' : 'native',
          lastEventAt: '',
        };
      }

      function selectableSessions() {
        const byKey = new Map();
        for (const session of state.codexSessions || []) {
          byKey.set(sessionRef(session), session);
        }
        for (const option of state.bindingOptions || []) {
          const session = option ? sessionFromBindingOption(option) : null;
          const ref = session ? sessionRef(session) : '';
          if (ref && !byKey.has(ref)) {
            byKey.set(ref, session);
          }
        }
        return Array.from(byKey.values());
      }

      function renderBindingTable(binding) {
        const sessions = selectableSessions();
        if (!sessions.length) {
          return '<div class="binding-empty">当前没有可用的 Codex 会话记录。</div>';
        }

        return ''
          + '<div class="binding-table-wrap">'
          +   '<table class="binding-table">'
          +     '<thead><tr><th>标题</th><th>Thread</th><th>目录</th><th>Creator</th><th>操作</th></tr></thead>'
          +     '<tbody>'
          +       sessions.map((session) => {
            const bridgeSessionId = sessionBridgeSessionId(session);
            const codexThreadId = sessionCodexThreadId(session);
            const active = (bridgeSessionId && bridgeSessionId === binding.currentSessionId)
              || (codexThreadId && codexThreadId === binding.currentThreadId);
            const creatorBadge = renderCreatorBadge(session);
            return ''
              + '<tr class="' + (active ? 'current' : '') + '">'
              +   '<td><div class="binding-table-title">' + escapeHtml(session.title || 'Untitled Session') + ' ' + creatorBadge + (active ? '<span class="binding-table-mark">当前</span>' : '') + '</div></td>'
              +   '<td><div class="binding-table-thread"><code>' + escapeHtml(session.threadId || session.sessionId || '-') + '</code></div></td>'
              +   '<td><div class="binding-table-path">' + escapeHtml(session.cwd || '(no cwd)') + '</div></td>'
              +   '<td><div class="binding-table-source">' + creatorBadge + '</div></td>'
              +   '<td><button type="button" class="binding-target-btn' + (active ? ' current' : '') + '" data-action="switch-binding-target" data-binding-id="' + escapeHtml(binding.id) + '" ' + sessionIdentityAttrs(session) + (active ? ' disabled' : '') + '>' + (active ? '当前会话' : '切换到当前会话') + '</button></td>'
              + '</tr>';
          }).join('')
          +     '</tbody>'
          +   '</table>'
          + '</div>';
      }

      function bindingTabLabel(binding) {
        if (binding.kind === 'default') {
          return '下一条新聊天';
        }
        return binding.chatDisplayName || binding.chatId || binding.id;
      }

      function renderBindingCard(binding) {
        if (binding.kind === 'default') {
          return ''
            + '<article class="binding-item" data-binding-id="' + escapeHtml(binding.id) + '">'
            +   '<div class="binding-head">'
            +     '<div class="binding-title">下一条新聊天</div>'
            +     '<div class="actions">'
            +       '<div class="small">' + escapeHtml(formatDefaultTargetAccount(binding)) + '</div>'
            +       '<button type="button" data-action="clear-channel-default-target" data-channel-type="' + escapeHtml(binding.channelType) + '">清除当前入口</button>'
            +     '</div>'
            +   '</div>'
            +   '<div class="binding-detail">接入方式：该通道收到下一条新聊天后，会直接进入当前指定会话。</div>'
            +   '<div class="binding-detail">当前会话：<code>' + escapeHtml(binding.currentSessionId ? binding.currentSessionId.slice(0, 8) + '...' : 'not-shared') + '</code> · ' + escapeHtml(binding.currentSessionName || binding.currentTargetLabel || '未指定') + '</div>'
            +   '<div class="binding-detail">当前目标：' + escapeHtml(binding.currentTargetLabel || '未指定') + '</div>'
          +   '<div class="binding-detail">当前 thread：<code>' + escapeHtml(binding.currentThreadId || 'not-shared') + '</code></div>'
          +   '<div class="binding-detail">Mode / Provider：<code>' + escapeHtml(binding.mode || 'normal') + '</code> · <code>' + escapeHtml(binding.codexProvider || 'default') + '</code></div>'
          + '</article>';
        }
        return ''
          + '<article class="binding-item" data-binding-id="' + escapeHtml(binding.id) + '">'
          +   '<div class="binding-head">'
          +     '<div class="binding-title">' + escapeHtml(binding.chatDisplayName || binding.chatId) + '</div>'
          +     '<div class="actions">'
          +       '<div class="small">' + escapeHtml((binding.mode || 'normal') + ' · ' + (binding.codexProvider || 'default')) + '</div>'
          +       '<button type="button" data-action="unbind-binding" data-binding-id="' + escapeHtml(binding.id) + '">解绑当前聊天</button>'
          +     '</div>'
          +   '</div>'
          +   '<div class="binding-detail">聊天 ID：<code>' + escapeHtml(binding.chatId) + '</code></div>'
          +   '<div class="binding-detail">当前会话：<code>' + escapeHtml(binding.currentSessionId.slice(0, 8)) + '...</code> · ' + escapeHtml(binding.currentSessionName) + '</div>'
          +   '<div class="binding-detail">当前目标：' + escapeHtml(binding.currentTargetLabel || '未绑定') + '</div>'
          +   '<div class="binding-detail">当前 thread：<code>' + escapeHtml(binding.currentThreadId || 'not-shared') + '</code></div>'
          +   '<div class="binding-detail">Mode / Provider：<code>' + escapeHtml(binding.mode || 'normal') + '</code> · <code>' + escapeHtml(binding.codexProvider || 'default') + '</code></div>'
          +   '<div class="binding-detail">运行状态：' + escapeHtml(bindingRuntimeText(binding)) + '</div>'
          +   '<div class="binding-detail">共享镜像：' + escapeHtml(bindingMirrorText(binding)) + '</div>'
          +   '<div class="binding-detail">目录：' + escapeHtml(binding.workingDirectory || '~') + '</div>'
          + '</article>';
      }

      function formPayload() {
        return {
          runtime: document.getElementById('runtime').value,
          defaultMode: document.getElementById('defaultMode').value,
          historyMessageLimit: document.getElementById('historyMessageLimit').value,
          streamStatusIdleStartSeconds: document.getElementById('streamStatusIdleStartSeconds').value,
          streamStatusCheckIntervalSeconds: document.getElementById('streamStatusCheckIntervalSeconds').value,
          defaultWorkspaceRoot: document.getElementById('defaultWorkspaceRoot').value,
          defaultModel: document.getElementById('defaultModel').value,
          codexSkipGitRepoCheck: document.getElementById('codexSkipGitRepoCheck').checked,
          codexSandboxMode: document.getElementById('codexSandboxMode').value,
          codexNetworkAccess: document.getElementById('codexNetworkAccess').checked,
          codexReasoningEffort: document.getElementById('codexReasoningEffort').value,
          sdkToolCallDetailsInText: document.getElementById('sdkToolCallDetailsInText').checked,
          uiAllowLan: document.getElementById('uiAllowLan').checked,
          uiAccessToken: document.getElementById('uiAccessToken').value,
        };
      }

      function showMessage(id, type, message) {
        const node = document.getElementById(id);
        if (node) {
          node.className = 'message';
          node.textContent = '';
        }
        showGlobalMessage(type, message);
      }

      function showGlobalMessage(type, message) {
        const host = document.getElementById('globalMessageHost');
        if (!host) return;

        const item = document.createElement('div');
        item.className = 'global-message ' + (type || 'success');
        const icon = document.createElement('span');
        icon.className = 'global-message-icon';
        icon.textContent = type === 'error' ? '!' : '✓';

        const content = document.createElement('div');
        content.className = 'global-message-content';
        content.textContent = message;

        item.appendChild(icon);
        item.appendChild(content);
        host.appendChild(item);

        window.setTimeout(() => {
          item.remove();
        }, 2200);
      }

      function stopActivePageRefresh() {
        if (!state.pageRefreshTimer) return;
        window.clearInterval(state.pageRefreshTimer);
        state.pageRefreshTimer = null;
      }

      async function refreshSessionHistoryData() {
        if (!state.activeSessionRef) return;
        const query = sessionHistoryQuery(state.activeSessionRef);
        if (!query) return;
        const result = await api('/api/session-history?' + query);
        renderSessionHistory(result);
      }

      async function refreshPageData(page) {
        if (state.pageRefreshInFlight[page]) return;
        state.pageRefreshInFlight[page] = true;
        try {
          if (page === 'overview') {
            await loadStatus();
            await loadBindings();
            await loadCodexSessions();
            return;
          }
          if (page === 'sessions') {
            await loadBindings();
            await loadCodexSessions();
            return;
          }
          if (page === 'session-history') {
            await refreshSessionHistoryData();
            return;
          }
          if (page === 'channels') {
            await loadRuntimeStatusOnly();
            await loadBindings();
            return;
          }
          if (page === 'logs') {
            await loadLogs();
          }
        } catch (error) {
          // Keep background refresh quiet; manual refresh buttons still show errors.
          console.warn('[ui] Auto refresh failed:', error);
        } finally {
          state.pageRefreshInFlight[page] = false;
        }
      }

      function startActivePageRefresh(page) {
        stopActivePageRefresh();
        const refreshablePages = new Set(['overview', 'sessions', 'session-history', 'channels', 'logs']);
        if (!refreshablePages.has(page)) return;
        void refreshPageData(page);
        state.pageRefreshTimer = window.setInterval(() => {
          if (state.activePage !== page) return;
          if (document.hidden) return;
          void refreshPageData(page);
        }, 5000);
      }

      function setActivePage(page, syncHash) {
        const nextPage = ['overview', 'sessions', 'session-history', 'config', 'commands', 'channels', 'logs'].includes(page) ? page : 'overview';
        state.activePage = nextPage;

        document.querySelectorAll('.nav-link').forEach((element) => {
          const node = element;
          node.classList.toggle('active', node.dataset.page === nextPage);
        });

        document.querySelectorAll('.page').forEach((element) => {
          const node = element;
          node.classList.toggle('active', node.dataset.page === nextPage);
        });

        if (syncHash !== false) {
          const hash = nextPage === 'channels'
            ? '#channels/' + (state.activeChannelId || '')
            : nextPage === 'session-history'
              ? '#session/' + encodeURIComponent(state.activeSessionRef || '')
              : '#' + nextPage;
          if (window.location.hash !== hash) {
            history.replaceState(null, '', hash);
          }
        }

        startActivePageRefresh(nextPage);
      }

      function setActiveChannel(channelId, syncHash) {
        state.activeChannelId = channelId || '';
        renderChannelsWorkspace();

        if (syncHash !== false && state.activePage === 'channels') {
          const hash = '#channels/' + (state.activeChannelId || '');
          if (window.location.hash !== hash) {
            history.replaceState(null, '', hash);
          }
        }
      }

      function syncPageFromHash() {
        const raw = String(window.location.hash || '').replace(/^#/, '');
        if (!raw) {
          setActivePage('overview', false);
          return;
        }

        if (raw.startsWith('channels/')) {
          setActivePage('channels', false);
          setActiveChannel(raw.split('/')[1] || '', false);
          return;
        }

        if (raw.startsWith('session/')) {
          const ref = decodeURIComponent(raw.slice('session/'.length));
          if (ref) {
            void openSessionHistory(ref, false).catch((error) => {
              showMessage('sessionHistoryMessage', 'error', error.message);
            });
            return;
          }
        }

        setActivePage(raw, false);
      }

      async function copyText(value, successMessage) {
        if (!navigator.clipboard || !value) {
          throw new Error('当前浏览器不支持复制，或没有可复制的内容。');
        }
        await navigator.clipboard.writeText(value);
        showGlobalMessage('success', successMessage);
      }

      function groupCodexSessions(sessions) {
        const groups = new Map();
        for (const session of sessions || []) {
          const key = session.cwd || '(no cwd)';
          if (!groups.has(key)) {
            groups.set(key, {
              key,
              name: baseName(key),
              cwd: key,
              latest: session.lastEventAt || '',
              sessions: [],
            });
          }
          const group = groups.get(key);
          group.sessions.push(session);
          if ((session.lastEventAt || '') > group.latest) {
            group.latest = session.lastEventAt || '';
          }
        }

        return Array.from(groups.values())
          .map((group) => ({
            ...group,
            sessions: group.sessions.sort((left, right) => (right.lastEventAt || '').localeCompare(left.lastEventAt || '')),
          }))
          .sort((left, right) => {
            const timeOrder = (right.latest || '').localeCompare(left.latest || '');
            if (timeOrder !== 0) return timeOrder;
            return left.name.localeCompare(right.name, 'zh-CN');
          });
      }

      function providerLabel(provider) {
        if (provider === 'weixin') return '微信';
        if (provider === 'feishu') return '飞书';
        return '通道';
      }

      function configuredChannels() {
        return Array.isArray(state.config && state.config.channels) ? state.config.channels : [];
      }

      function visibleChannels() {
        const channels = configuredChannels().slice();
        if (state.channelDraft) {
          channels.push(state.channelDraft);
        }
        return channels.map((channel) => applyChannelEditorDraft(channel));
      }

      function getChannelById(channelId) {
        const channel = state.channelDraft && state.channelDraft.id === channelId
          ? state.channelDraft
          : configuredChannels().find((item) => item.id === channelId) || null;
        return channel ? applyChannelEditorDraft(channel) : null;
      }

      function applyChannelEditorDraft(channel) {
        if (!channel || !channel.id) return channel;
        const draft = state.channelEditorDrafts[channel.id];
        if (!draft || draft.provider !== channel.provider) return channel;

        const next = Object.assign({}, channel, {
          alias: typeof draft.alias === 'string' ? draft.alias : channel.alias,
          enabled: typeof draft.enabled === 'boolean' ? draft.enabled : channel.enabled,
        });

        if (channel.provider === 'feishu') {
          next.config = Object.assign({}, channel.config || {}, {
            appId: typeof draft.appId === 'string' ? draft.appId : (channel.config || {}).appId,
            appSecret: typeof draft.appSecret === 'string' ? draft.appSecret : (channel.config || {}).appSecret,
            site: typeof draft.site === 'string' ? draft.site : (channel.config || {}).site,
            allowedUsers: typeof draft.allowedUsers === 'string'
              ? draft.allowedUsers.split(',').map((item) => item.trim()).filter(Boolean)
              : (channel.config || {}).allowedUsers,
            streamingEnabled: typeof draft.streamingEnabled === 'boolean'
              ? draft.streamingEnabled
              : (channel.config || {}).streamingEnabled,
            feedbackMarkdownEnabled: typeof draft.feedbackMarkdownEnabled === 'boolean'
              ? draft.feedbackMarkdownEnabled
              : (channel.config || {}).feedbackMarkdownEnabled,
          });
          return next;
        }

        next.config = Object.assign({}, channel.config || {}, {
          accountId: typeof draft.accountId === 'string' ? draft.accountId : (channel.config || {}).accountId,
          baseUrl: typeof draft.baseUrl === 'string' ? draft.baseUrl : (channel.config || {}).baseUrl,
          cdnBaseUrl: typeof draft.cdnBaseUrl === 'string' ? draft.cdnBaseUrl : (channel.config || {}).cdnBaseUrl,
          mediaEnabled: typeof draft.mediaEnabled === 'boolean' ? draft.mediaEnabled : (channel.config || {}).mediaEnabled,
          feedbackMarkdownEnabled: typeof draft.feedbackMarkdownEnabled === 'boolean'
            ? draft.feedbackMarkdownEnabled
            : (channel.config || {}).feedbackMarkdownEnabled,
        });
        return next;
      }

      function adapterStatuses() {
        return state.bridgeStatus && Array.isArray(state.bridgeStatus.adapters) ? state.bridgeStatus.adapters : [];
      }

      function getAdapterStatus(channelId) {
        return adapterStatuses().find((item) => item.channelType === channelId) || null;
      }

      function isChannelRunning(channelId) {
        const status = getAdapterStatus(channelId);
        return Boolean(state.bridgeStatus && state.bridgeStatus.running && status && status.running);
      }

      const CONFIG_FIELD_LABELS = {
        runtime: 'Runtime',
        defaultWorkspaceRoot: '/new 相对路径根目录',
        defaultModel: '默认模型',
        defaultMode: '默认模式',
        historyMessageLimit: '/his 返回条数',
        streamStatusIdleStartSeconds: '长任务提示延迟',
        streamStatusCheckIntervalSeconds: '长任务提示刷新间隔',
        codexSkipGitRepoCheck: '允许在未信任 Git 目录运行 Codex',
        codexSandboxMode: 'Codex 文件系统权限',
        codexNetworkAccess: 'Codex 网络访问',
        codexReasoningEffort: 'Codex 思考级别',
        sdkToolCallDetailsInText: '显示 SDK 工具输入输出',
        uiAllowLan: '允许局域网访问 Web 控制台',
        uiAccessToken: '局域网访问 token',
      };

      const BRIDGE_RESTART_FIELDS = new Set([
        'runtime',
        'codexSkipGitRepoCheck',
      ]);

      const AUTO_SYNC_FIELDS = new Set([]);

      const IMMEDIATE_FIELDS = new Set([
        'defaultWorkspaceRoot',
        'defaultModel',
        'defaultMode',
        'historyMessageLimit',
        'streamStatusIdleStartSeconds',
        'streamStatusCheckIntervalSeconds',
        'codexSandboxMode',
        'codexNetworkAccess',
        'codexReasoningEffort',
        'sdkToolCallDetailsInText',
        'uiAllowLan',
        'uiAccessToken',
      ]);

      const SAVE_SCOPE_FIELDS = {
        all: null,
        feishu: new Set([]),
        weixin: new Set([]),
      };

      function normalizeConfigValue(value) {
        if (Array.isArray(value)) {
          return value.slice().map((item) => String(item)).sort().join('|');
        }
        if (value === undefined || value === null) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return String(value);
      }

      function listChangedConfigFields(before, after, scope) {
        const allowedFields = SAVE_SCOPE_FIELDS[scope] || null;
        const keys = new Set([
          ...Object.keys(before || {}),
          ...Object.keys(after || {}),
        ]);

        return Array.from(keys).filter((key) => {
          if (allowedFields && !allowedFields.has(key)) return false;
          return normalizeConfigValue(before ? before[key] : undefined) !== normalizeConfigValue(after ? after[key] : undefined);
        });
      }

      function formatFieldLabels(fields) {
        return fields
          .map((field) => CONFIG_FIELD_LABELS[field] || field)
          .join('、');
      }

      function buildConfigSaveMessage(before, after, scope) {
        const changed = listChangedConfigFields(before, after, scope);
        if (changed.length === 0) {
          return '配置未变更。';
        }

        const restartFields = changed.filter((field) => BRIDGE_RESTART_FIELDS.has(field));
        const autoSyncFields = changed.filter((field) => AUTO_SYNC_FIELDS.has(field));
        const immediateFields = changed.filter((field) => IMMEDIATE_FIELDS.has(field));
        const notes = [];

        if (immediateFields.length > 0) {
          notes.push('已即时生效：' + formatFieldLabels(immediateFields));
        }
        if (autoSyncFields.length > 0) {
          notes.push(
            (state.bridgeStatus && state.bridgeStatus.running)
              ? '会在几秒内自动同步：' + formatFieldLabels(autoSyncFields)
              : '会在下次启动 Bridge 时生效：' + formatFieldLabels(autoSyncFields),
          );
        }
        if (restartFields.length > 0) {
          notes.push(
            (state.bridgeStatus && state.bridgeStatus.running)
              ? '需要重启 Bridge 后生效：' + formatFieldLabels(restartFields)
              : '会在下次启动 Bridge 时生效：' + formatFieldLabels(restartFields),
          );
        }

        return '配置已保存。' + (notes.length > 0 ? ' ' + notes.join('；') + '。' : '');
      }

      function channelDisplayLabel(channel) {
        const alias = String(channel.alias || '').trim();
        const provider = providerLabel(channel.provider);
        if (!alias) return provider;
        return alias === provider ? alias : alias + ' · ' + provider;
      }

      function formatChannelRuntimeLabel(channel) {
        const label = channelDisplayLabel(channel);
        if (channel.enabled === false) {
          return label + '已停用。';
        }
        if (!state.bridgeStatus || !state.bridgeStatus.running) {
          return label + '已配置，但 Bridge 还没启动。';
        }
        const status = getAdapterStatus(channel.id);
        if (!status || !status.running) {
          return label + '已保存，Bridge 会在几秒内自动同步。';
        }
        return label + '已接通到当前运行中的 Bridge。';
      }

      function emptyBindingText(channel) {
        const label = channelDisplayLabel(channel);
        if (channel.enabled === false) {
          return label + '已停用。启用后才会创建聊天绑定。';
        }
        if (!state.bridgeStatus || !state.bridgeStatus.running) {
          return label + '已配置，但 Bridge 还没启动。启动后才会创建绑定。';
        }
        if (!isChannelRunning(channel.id)) {
          return label + '已配置，Bridge 会在几秒内自动同步；如果页面还没更新，可手动点“刷新状态”。';
        }
        return label + '当前还没有聊天接入。先从这个机器人发一条消息。';
      }

      function currentThreadMarks(session) {
        const marks = [];
        const threadId = sessionCodexThreadId(session);
        const bridgeSessionId = sessionBridgeSessionId(session);
        const counts = new Map();

        for (const binding of state.bindings || []) {
          const matchesThread = (threadId && binding.currentThreadId === threadId) || (bridgeSessionId && binding.currentSessionId === bridgeSessionId);
          if (!matchesThread) continue;
          const label = (binding.channelAlias || providerLabel(binding.channelProvider)) + ' 当前';
          counts.set(label, (counts.get(label) || 0) + 1);
        }

        for (const entry of state.channelDefaults || []) {
          const matchesThread = (threadId && entry.targetThreadId === threadId) || (bridgeSessionId && entry.targetSessionId === bridgeSessionId);
          if (!matchesThread) continue;
          const label = (entry.channelAlias || providerLabel(entry.channelProvider)) + ' 当前';
          counts.set(label, (counts.get(label) || 0) + 1);
        }

        for (const [label, count] of counts.entries()) {
          marks.push(count > 1 ? label + ' x' + count : label);
        }

        return marks;
      }

      function bindingsForSession(session) {
        const threadId = sessionCodexThreadId(session);
        const bridgeSessionId = sessionBridgeSessionId(session);
        return (state.bindings || []).filter((binding) => (
          (threadId && binding.currentThreadId === threadId) || (bridgeSessionId && binding.currentSessionId === bridgeSessionId)
        ));
      }

      function channelDefaultsForSession(session) {
        const threadId = sessionCodexThreadId(session);
        const bridgeSessionId = sessionBridgeSessionId(session);
        return (state.channelDefaults || []).filter((entry) => (
          (threadId && entry.targetThreadId === threadId) || (bridgeSessionId && entry.targetSessionId === bridgeSessionId)
        ));
      }

      function projectNameFromCwd(cwd) {
        const value = String(cwd || '').trim();
        if (!value) return '(no cwd)';
        const parts = value.split(/[\\\\/]+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : value;
      }

      function formatBindingAccount(binding) {
        const alias = String(binding.channelAlias || '').trim();
        const provider = providerLabel(binding.channelProvider);
        const channel = alias ? (alias === provider ? alias : alias + ' · ' + provider) : provider;
        return channel + ' · ' + (binding.chatDisplayName || binding.chatId);
      }

      function formatDefaultTargetAccount(entry) {
        const alias = String(entry.channelAlias || '').trim();
        const provider = providerLabel(entry.channelProvider);
        return alias ? (alias === provider ? alias : alias + ' · ' + provider) : provider;
      }

      function renderSessionChannelControl(session) {
        return iconButton(
          'open-session-channel-modal',
          'swap',
          '切换通道',
          sessionIdentityAttrs(session),
          'swap-icon'
        );
      }

      function renderSessionActions(session) {
        const bridgeSessionId = sessionBridgeSessionId(session);
        const threadId = sessionCodexThreadId(session);
        const identity = threadId || bridgeSessionId || '';
        const identityAction = threadId ? 'copy-thread' : 'copy-session-id';
        const identityLabel = threadId ? '复制 thread' : '复制 Bridge 会话 ID';
        const identityAttr = threadId
          ? 'data-thread-id="' + escapeHtml(threadId) + '"'
          : 'data-session-id="' + escapeHtml(bridgeSessionId) + '"';
        const configurable = canConfigureSession(session);

        return ''
          + (identity ? iconButton(identityAction, 'copy', identityLabel, identityAttr, '') : '')
          + (threadId
            ? iconButton('copy-bind-command', 'command', '复制接管命令', 'data-thread-id="' + escapeHtml(threadId) + '"', '')
            : '')
          + (configurable
            ? iconButton('open-session-config-modal', 'settings', '会话配置', sessionIdentityAttrs(session), '')
            : disabledIconButton('settings', '未绑定到 IM 通道的 Codex 会话暂不能设置会话配置', ''))
          + renderSessionChannelControl(session)
          + iconButton('delete-session', 'delete', '删除会话', sessionIdentityAttrs(session), 'danger');
      }

      function bindingRuntimeText(binding) {
        const status = binding.runtimeStatus || 'idle';
        const queuedCount = Number(binding.queuedCount || 0);
        if (status === 'queued') {
          return queuedCount > 0 ? '排队中（' + queuedCount + '）' : '排队中';
        }
        if (status === 'running') {
          return '运行中';
        }
        return '空闲';
      }

      function bindingMirrorText(binding) {
        if (binding.mirrorStatus === 'watching') {
          return binding.mirrorLastEventAt
            ? '监听中 · 最近同步 ' + formatTime(binding.mirrorLastEventAt)
            : '监听中';
        }
        if (binding.mirrorStatus === 'stale') {
          return '待恢复（暂时没定位到 Codex thread 文件）';
        }
        return '未监听';
      }

      function renderCodexSessionCard(session) {
        const originator = session.originator || 'Codex Native';
        const marks = currentThreadMarks(session);
        const markHtml = marks.map((mark) => '<span class="session-mark">' + escapeHtml(mark) + '</span>').join('');
        const threadId = sessionCodexThreadId(session);
        const bridgeSessionId = sessionBridgeSessionId(session);
        const threadHtml = threadId
          ? 'Thread: <code>' + escapeHtml(threadId) + '</code><button type="button" class="session-inline-action" data-action="copy-thread" data-thread-id="' + escapeHtml(threadId) + '">复制</button>'
          : 'Bridge 会话：<code>' + escapeHtml(bridgeSessionId || '-') + '</code>';
        const actionHtml = renderSessionActions(session);

        return ''
          + '<article class="session-card session-openable' + (marks.length ? ' current-thread' : '') + '" ' + sessionIdentityAttrs(session) + '>'
          +   '<div class="session-head">'
          +     '<div class="session-main">'
          +       renderSessionTitle(session, markHtml)
          +       '<div class="session-thread">' + threadHtml + '</div>'
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">Creator</div>'
          +       '<div class="session-value">' + renderCreatorToggle(session) + '</div>'
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">状态</div>'
          +       renderModeProviderValue(session.mode, session.codexProvider)
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">目录</div>'
          +       '<div class="session-path">' + escapeHtml(session.cwd || '(no cwd)') + '</div>'
          +     '</div>'
          +     '<div class="session-actions">'
          +       actionHtml
          +   '</div>'
          + '</div>'
          + '</article>';
      }

      function renderBoundCodexSessionCard(session) {
        const bindings = bindingsForSession(session);
        const defaults = channelDefaultsForSession(session);
        const marks = currentThreadMarks(session);
        const markHtml = marks.map((mark) => '<span class="session-mark">' + escapeHtml(mark) + '</span>').join('');
        const identityLabel = session.threadId ? 'Thread' : 'Bridge 会话';
        const identityValue = session.threadId || session.sessionId || '-';
        const bindingTags = bindings.map((binding) => (
          '<div class="session-binding-tag">'
            + '<span class="session-binding-tag-label">' + escapeHtml(formatBindingAccount(binding)) + '</span>'
            + iconButton('open-session-config-modal', 'settings', '会话配置', sessionIdentityAttrs(session), 'mini-icon')
            + '<button type="button" data-action="unbind-binding" data-binding-id="' + escapeHtml(binding.id) + '" data-channel="' + escapeHtml(binding.channelType) + '">解绑</button>'
          + '</div>'
        )).join('');
        const defaultTags = defaults.map((entry) => (
          '<div class="session-binding-tag">'
            + '<span class="session-binding-tag-label">' + escapeHtml(formatDefaultTargetAccount(entry) + ' · 等待首条新聊天') + '</span>'
            + iconButton('open-session-config-modal', 'settings', '会话配置', sessionIdentityAttrs(session), 'mini-icon')
            + '<button type="button" data-action="clear-channel-default-target" data-channel-type="' + escapeHtml(entry.channelType) + '">清除</button>'
          + '</div>'
        )).join('');
        const tagHtml = bindingTags + defaultTags;

        return ''
          + '<article class="session-card session-openable' + (marks.length ? ' current-thread' : '') + '" ' + sessionIdentityAttrs(session) + '>'
          +   '<div class="session-head">'
          +     '<div class="session-main">'
          +       renderSessionTitle(session, markHtml)
          +       '<div class="session-thread">' + identityLabel + ': <code>' + escapeHtml(identityValue) + '</code></div>'
          +       '<div class="session-path">' + escapeHtml(session.cwd || '(no cwd)') + '</div>'
          +       '<div class="session-binding-tags">' + tagHtml + '</div>'
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">所属项目</div>'
          +       '<div class="session-value">' + escapeHtml(projectNameFromCwd(session.cwd)) + '</div>'
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">最近活动</div>'
          +       '<div class="session-value session-date">' + escapeHtml(formatTime(session.lastEventAt || '')) + '</div>'
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">状态</div>'
          +       renderModeProviderValue(session.mode, session.codexProvider)
          +     '</div>'
          +     '<div class="session-cell">'
          +       '<div class="session-label">Creator</div>'
          +       '<div class="session-value">' + renderCreatorToggle(session) + '</div>'
          +       '<div class="session-actions">'
          +         renderSessionActions(session)
          +       '</div>'
          +     '</div>'
          +   '</div>'
          + '</article>';
      }

      function renderCodexSessionListItem(session) {
        const marks = currentThreadMarks(session);
        const markHtml = marks.map((mark) => '<span class="binding-table-mark">' + escapeHtml(mark) + '</span>').join('');
        const threadId = sessionCodexThreadId(session);
        const bridgeSessionId = sessionBridgeSessionId(session);
        const identityLabel = threadId ? 'Thread' : 'Bridge 会话';
        const identityValue = threadId || bridgeSessionId || '-';
        const actionHtml = renderSessionActions(session);

        return ''
          + '<tr class="session-table-row" ' + sessionIdentityAttrs(session) + '>'
          +   '<td><div class="binding-table-title session-table-title">' + renderSessionTitle(session, markHtml) + '</div><div class="binding-table-thread">' + identityLabel + ': <code>' + escapeHtml(identityValue) + '</code></div></td>'
          +   '<td><div class="binding-table-path">' + escapeHtml(session.cwd || '(no cwd)') + '</div></td>'
          +   '<td>' + renderModeProviderValue(session.mode, session.codexProvider) + '</td>'
          +   '<td><div class="binding-table-source">' + renderCreatorToggle(session) + '</div></td>'
          +   '<td><div class="binding-table-thread session-date">' + escapeHtml(formatTime(session.lastEventAt || '')) + '</div></td>'
          +   '<td><div class="session-actions compact-actions">' + actionHtml + '</div></td>'
          + '</tr>';
      }

      function renderCodexSessions(result) {
        state.codexSessions = result.sessions || [];
        state.codexRoot = result.root || '-';
        state.codexSessionCounts = result.counts || null;
        const sessions = state.codexSessions || [];
        const counts = state.codexSessionCounts || {};
        const totalDisplayable = Number.isFinite(Number(counts.totalDisplayable))
          ? Number(counts.totalDisplayable)
          : sessions.length;
        const codexPhysical = Number.isFinite(Number(counts.codexPhysical))
          ? Number(counts.codexPhysical)
          : sessions.filter((session) => session.kind === 'codex').length;
        const bridgeStored = Number.isFinite(Number(counts.bridgeStored))
          ? Number(counts.bridgeStored)
          : sessions.filter((session) => session.kind === 'bridge').length;
        const bridgeWithoutCodexThread = Number.isFinite(Number(counts.bridgeWithoutCodexThread))
          ? Number(counts.bridgeWithoutCodexThread)
          : 0;
        const dedupedBridgeRows = Number.isFinite(Number(counts.dedupedBridgeRows))
          ? Number(counts.dedupedBridgeRows)
          : 0;
        const boundSessions = sessions.filter((session) => bindingsForSession(session).length > 0 || channelDefaultsForSession(session).length > 0);
        document.getElementById('codexSessionCount').textContent = String(totalDisplayable);
        document.getElementById('codexSessionMeta').textContent =
          '扫描目录：' + state.codexRoot
          + ' · 本地 Codex ' + codexPhysical + ' 条'
          + ' · Bridge 存储 ' + bridgeStored + ' 条'
          + (bridgeWithoutCodexThread > 0 ? '（' + bridgeWithoutCodexThread + ' 条缺少 codex_thread_id）' : '')
          + (dedupedBridgeRows > 0 ? ' · 已按 codex_thread_id 合并 ' + dedupedBridgeRows + ' 条重复映射' : '');
        document.getElementById('codexRootStatus').textContent = state.codexRoot;

        const boundList = document.getElementById('boundSessionsList');
        const boundMeta = document.getElementById('boundSessionsMeta');
        const list = document.getElementById('codexSessionsList');
        const allMeta = document.getElementById('allSessionsMeta');
        boundMeta.textContent = boundSessions.length > 0
          ? '当前有 ' + boundSessions.length + ' 条会话正在使用通道入口。'
          : '当前没有正在使用通道入口的会话。';
        allMeta.textContent = '按最近活动排序，当前展示 ' + sessions.length
          + (totalDisplayable === sessions.length ? ' 条。' : ' / ' + totalDisplayable + ' 条。');

        if (boundSessions.length === 0) {
          boundList.innerHTML = '<div class="binding-empty">当前没有任何会话正在使用通道入口。</div>';
        } else {
          boundList.innerHTML = boundSessions.map((session) => renderBoundCodexSessionCard(session)).join('');
        }

        if (state.codexSessions.length === 0) {
          list.innerHTML = '<div class="notice ghost">当前没有发现 Codex 会话。先从 IM 发一条消息，或在本机 Codex 中打开一个会话，再回到这里刷新。</div>';
          renderChannelsWorkspace();
          return;
        }

        list.innerHTML = ''
          + '<div class="binding-table-wrap session-table-wrap">'
          +   '<table class="binding-table session-table">'
          +     '<thead><tr><th>会话</th><th>目录</th><th>状态</th><th>Creator</th><th>最近活动</th><th>操作</th></tr></thead>'
          +     '<tbody>'
          +       sessions.map((session) => renderCodexSessionListItem(session)).join('')
          +     '</tbody>'
          +   '</table>'
          + '</div>';

        renderChannelsWorkspace();
      }

      function rerenderCodexSessions() {
        if (!state.codexSessions.length && !state.codexRoot) return;
        renderCodexSessions({
          root: state.codexRoot,
          sessions: state.codexSessions,
          counts: state.codexSessionCounts,
        });
      }

      function bindingsForChannel(channelId) {
        return (state.bindings || []).filter((item) => item.channelType === channelId);
      }

      function channelDefaultForChannel(channelId) {
        return (state.channelDefaults || []).find((item) => item.channelType === channelId) || null;
      }

      function bindingEntriesForChannel(channelId) {
        const bindings = bindingsForChannel(channelId).map((binding) => ({
          kind: 'binding',
          ...binding,
        }));
        const channelDefault = channelDefaultForChannel(channelId);
        if (!channelDefault) {
          return bindings;
        }
        return [{
          kind: 'default',
          id: 'default:' + channelId,
          channelType: channelDefault.channelType,
          channelProvider: channelDefault.channelProvider,
          channelAlias: channelDefault.channelAlias,
          chatId: '*',
          chatDisplayName: '等待首条新聊天',
          mode: 'pending',
          model: '',
          workingDirectory: '',
          currentTargetLabel: channelDefault.targetLabel,
          currentSessionId: channelDefault.targetSessionId || channelDefault.bridgeSessionId || '',
          currentSessionName: channelDefault.targetLabel || '未指定',
          currentThreadId: channelDefault.targetThreadId || '',
          runtimeStatus: '',
          queuedCount: 0,
          mirrorStatus: '',
          mirrorLastEventAt: '',
        }].concat(bindings);
      }

      function ensureActiveBinding(channelId, bindings) {
        const current = state.activeBindingByChannelId[channelId];
        if (current && bindings.some((binding) => binding.id === current)) {
          return current;
        }
        const next = bindings[0] ? bindings[0].id : '';
        state.activeBindingByChannelId[channelId] = next;
        return next;
      }

      function ensureActiveChannelId() {
        if (state.channelDraft && state.activeChannelId === state.channelDraft.id) {
          return state.activeChannelId;
        }
        const channels = visibleChannels();
        if (state.activeChannelId && channels.some((channel) => channel.id === state.activeChannelId)) {
          return state.activeChannelId;
        }
        state.activeChannelId = channels[0] ? channels[0].id : '';
        return state.activeChannelId;
      }

      function getWeixinAccountOptions() {
        return Array.isArray(state.weixinAccounts) ? state.weixinAccounts : [];
      }

      function renderChannelList() {
        const list = document.getElementById('channelList');
        const meta = document.getElementById('channelListMeta');
        const channels = visibleChannels();

        meta.textContent = channels.length > 0
          ? '共 ' + channels.length + ' 个通道实例。每个实例是一个独立聊天入口。'
          : '当前还没有通道实例。先新增一个飞书或微信机器人。';

        if (channels.length === 0) {
          list.innerHTML = '<div class="binding-empty">当前还没有可用通道实例。</div>';
          return;
        }

        ensureActiveChannelId();
        list.innerHTML = channels.map((channel) => {
          const adapter = getAdapterStatus(channel.id);
          const active = channel.id === state.activeChannelId;
          const bindingCount = bindingEntriesForChannel(channel.id).length;
          const statusText = channel.enabled === false
            ? '已停用'
            : adapter && adapter.running
              ? '运行中'
              : state.bridgeStatus && state.bridgeStatus.running
                ? '等待同步'
                : 'Bridge 未启动';
          return ''
            + '<button type="button" class="channel-list-item' + (active ? ' active' : '') + '" data-action="select-channel" data-channel-id="' + escapeHtml(channel.id) + '">'
            +   '<div class="channel-list-item-head">'
            +     '<div class="channel-list-item-title">' + escapeHtml(channel.alias) + '</div>'
            +     '<span class="channel-list-item-provider">' + escapeHtml(providerLabel(channel.provider)) + '</span>'
            +   '</div>'
            +   '<div class="channel-list-item-stats">'
            +     '<span class="channel-list-item-status">' + escapeHtml(statusText) + '</span>'
            +     '<span>' + escapeHtml(bindingCount === 0 ? '未指定入口' : ('已指定 ' + bindingCount + ' 个入口')) + '</span>'
            +   '</div>'
            +   '<div class="channel-list-item-meta">' + escapeHtml(channel.id) + '</div>'
            + '</button>';
        }).join('');
      }

      function renderChannelBindingsV2(channel) {
        const bindings = bindingEntriesForChannel(channel.id);
        const emptyText = emptyBindingText(channel);
        if (bindings.length === 0) {
          return '<div class="binding-empty">' + escapeHtml(emptyText) + '</div>';
        }

        const activeBindingId = ensureActiveBinding(channel.id, bindings);
        const activeBinding = bindings.find((binding) => binding.id === activeBindingId) || bindings[0];
        const tabs = bindings.length > 1
          ? '<div class="binding-tabs">' + bindings.map((binding) => (
              '<button type="button" class="binding-tab' + (binding.id === activeBinding.id ? ' active' : '') + '"'
                + ' data-action="select-binding-tab"'
                + ' data-channel-id="' + escapeHtml(channel.id) + '"'
                + ' data-binding-id="' + escapeHtml(binding.id) + '"'
                + ' title="' + escapeHtml(binding.kind === 'default' ? '等待首条新聊天' : binding.chatId) + '">'
                + escapeHtml(bindingTabLabel(binding))
              + '</button>'
            )).join('') + '</div>'
          : '';

        return ''
          + '<div class="small">当前已指定 ' + bindings.length + ' 个通道入口。一个会话同一时刻只能处理一个聊天。</div>'
          + tabs
          + renderBindingCard(activeBinding);
      }

      function renderChannelEditor() {
        const editor = document.getElementById('channelEditor');
        const channel = getChannelById(ensureActiveChannelId());
        if (!channel) {
          editor.innerHTML = '<div class="binding-empty">请选择一个通道实例，或先创建新通道。</div>';
          return;
        }

        const adapter = getAdapterStatus(channel.id);
        const statusText = formatChannelRuntimeLabel(channel);
        const feishu = channel.provider === 'feishu' ? (channel.config || {}) : {};
        const weixin = channel.provider === 'weixin' ? (channel.config || {}) : {};
        const weixinAccounts = getWeixinAccountOptions();
        const weixinAccountOptions = ['<option value="">未绑定账号</option>'].concat(
          weixinAccounts.map((account) => (
            '<option value="' + escapeHtml(account.accountId) + '"' + (account.accountId === weixin.accountId ? ' selected' : '') + '>'
              + escapeHtml(account.name || account.accountId)
            + '</option>'
          )),
        ).join('');
        const bindingsHtml = renderChannelBindingsV2(channel);
        const bindingCount = bindingEntriesForChannel(channel.id).length;
        const detailsHtml = channel.provider === 'feishu'
          ? ''
            + '<div class="editor-section">'
            +   '<p class="editor-section-title">连接配置</p>'
            +   '<div class="field-row">'
            +     '<label>App ID<input id="channelAppId" value="' + escapeHtml(feishu.appId || '') + '" /></label>'
            +     '<label>App Secret<input id="channelAppSecret" value="' + escapeHtml(feishu.appSecret || '') + '" /></label>'
            +   '</div>'
            +   '<div class="field-row">'
            +     '<label>站点<select id="channelSite">'
            +       '<option value="feishu"' + ((feishu.site || 'feishu') === 'feishu' ? ' selected' : '') + '>Feishu</option>'
            +       '<option value="lark"' + (feishu.site === 'lark' ? ' selected' : '') + '>Lark</option>'
            +     '</select></label>'
            +     '<label>Allowed Users<input id="channelAllowedUsers" value="' + escapeHtml(Array.isArray(feishu.allowedUsers) ? feishu.allowedUsers.join(', ') : '') + '" placeholder="多个 user_id 用逗号分隔" /></label>'
            +   '</div>'
            + '</div>'
            + '<div class="editor-section">'
            +   '<p class="editor-section-title">行为开关</p>'
            +   '<div class="checkbox-row">'
            +     '<label class="checkbox"><input id="channelStreamingEnabled" type="checkbox"' + (feishu.streamingEnabled !== false ? ' checked' : '') + ' /> 启用飞书流式响应卡片</label>'
            +     '<label class="checkbox"><input id="channelFeedbackMarkdownEnabled" type="checkbox"' + (feishu.feedbackMarkdownEnabled !== false ? ' checked' : '') + ' /> 反馈使用markdown</label>'
            +   '</div>'
            + '</div>'
          : ''
            + '<div class="editor-section">'
            +   '<p class="editor-section-title">连接配置</p>'
            +   '<div class="field-row">'
            +     '<label>微信账号<select id="channelAccountId">' + weixinAccountOptions + '</select></label>'
            +     '<label>Base URL<input id="channelBaseUrl" value="' + escapeHtml(weixin.baseUrl || '') + '" /></label>'
            +   '</div>'
            +   '<div class="field-row">'
            +     '<label>CDN Base URL<input id="channelCdnBaseUrl" value="' + escapeHtml(weixin.cdnBaseUrl || '') + '" /></label>'
            +     '<div></div>'
            +   '</div>'
            + '</div>'
            + '<div class="editor-section">'
            +   '<p class="editor-section-title">行为开关</p>'
            +   '<div class="checkbox-row">'
            +     '<label class="checkbox"><input id="channelMediaEnabled" type="checkbox"' + (weixin.mediaEnabled === true ? ' checked' : '') + ' /> 启用图片 / 文件 / 视频入站下载</label>'
            +     '<label class="checkbox"><input id="channelFeedbackMarkdownEnabled" type="checkbox"' + (weixin.feedbackMarkdownEnabled === true ? ' checked' : '') + ' /> 反馈使用markdown</label>'
            +   '</div>'
            + '</div>';

        editor.innerHTML = ''
          + '<div class="panel-header">'
          +   '<div>'
            +     '<h2>' + escapeHtml(channel.alias) + '</h2>'
            +     '<p>' + escapeHtml(statusText) + (adapter && adapter.lastMessageAt ? ' · 最近消息 ' + escapeHtml(formatTime(adapter.lastMessageAt)) : '') + '</p>'
          +   '</div>'
          +   '<div class="toolbar-split">'
          +     '<div class="toolbar">'
          +       '<button type="button" data-action="channel-save" data-channel-id="' + escapeHtml(channel.id) + '" class="primary">保存通道</button>'
          +       '<button type="button" data-action="channel-test" data-channel-id="' + escapeHtml(channel.id) + '">测试当前通道</button>'
          +       (channel.provider === 'weixin' ? '<button type="button" data-action="channel-weixin-login" data-channel-id="' + escapeHtml(channel.id) + '">开始微信扫码</button>' : '')
          +     '</div>'
          +     '<div class="toolbar-danger">'
          +       '<button type="button" data-action="channel-delete" data-channel-id="' + escapeHtml(channel.id) + '" class="danger">删除通道</button>'
          +     '</div>'
          +   '</div>'
          + '</div>'
          + '<div class="channel-editor-summary">'
          +   '<div class="channel-editor-stat"><strong>当前状态</strong><span>' + escapeHtml(statusText) + '</span></div>'
          +   '<div class="channel-editor-stat"><strong>通道入口</strong><span>' + escapeHtml(String(bindingCount)) + '</span></div>'
          +   '<div class="channel-editor-stat"><strong>Provider</strong><span>' + escapeHtml(providerLabel(channel.provider)) + '</span></div>'
          + '</div>'
          + '<div class="fields">'
          +   '<div class="editor-section">'
          +     '<p class="editor-section-title">基础信息</p>'
          +     '<div class="field-row triple">'
          +       '<label>别名<input id="channelAliasInput" value="' + escapeHtml(channel.alias) + '" /></label>'
          +       '<label>实例 ID<input value="' + escapeHtml(channel.id) + '" disabled /></label>'
          +       '<label>Provider<input value="' + escapeHtml(providerLabel(channel.provider)) + '" disabled /></label>'
          +     '</div>'
          +     '<div class="checkbox-row">'
          +       '<label class="checkbox"><input id="channelEnabledInput" type="checkbox"' + (channel.enabled !== false ? ' checked' : '') + ' /> 启用当前通道</label>'
          +     '</div>'
          +   '</div>'
          +   detailsHtml
          + '</div>'
          + '<div class="panel-block">'
          +   '<p class="panel-subtitle">当前入口</p>'
          +   bindingsHtml
          + '</div>';
      }

      function renderChannelsWorkspace() {
        renderChannelList();
        renderChannelEditor();
      }

      function renderBindings(result) {
        state.bindings = result.bindings || [];
        state.bindingOptions = result.options || [];
        state.channelDefaults = result.channelDefaults || [];
        document.getElementById('bindingCount').textContent = String(state.bindings.length);
        renderChannelsWorkspace();
        rerenderCodexSessions();
      }

      function renderUiAccess() {
        const config = state.config || {};
        const uiAccess = state.uiAccess || {};
        const allowLan = config.uiAllowLan === true;
        const token = config.uiAccessToken || '';
        const lanUrls = Array.isArray(uiAccess.lanUrls) ? uiAccess.lanUrls : [];
        const localUrl = uiAccess.localUrl || window.location.origin;
        const summary = document.getElementById('uiAccessSummary');
        const details = document.getElementById('uiLanDetails');
        const tokenInput = document.getElementById('uiAccessToken');
        const urlList = document.getElementById('uiAccessUrls');
        const copyTokenBtn = document.getElementById('copyUiTokenBtn');
        const copyLanLinkBtn = document.getElementById('copyUiLanLinkBtn');

        document.getElementById('uiAllowLan').checked = allowLan;
        tokenInput.value = token;
        details.hidden = !allowLan;
        copyTokenBtn.disabled = !allowLan || !token;
        copyLanLinkBtn.disabled = !allowLan || !token || lanUrls.length === 0;

        if (!allowLan) {
          summary.textContent = '局域网访问未开启。';
          urlList.innerHTML = '';
          return;
        }

        summary.textContent = '局域网访问已开启。';
        const items = [
          '<div class="info-item"><strong>本机地址</strong><div class="mono">' + escapeHtml(localUrl) + '</div></div>',
        ];

        if (lanUrls.length === 0) {
          items.push('<div class="info-item"><strong>局域网地址</strong><div>未检测到可用的 IPv4 地址，请检查网络连接。</div></div>');
        } else {
          for (const lanUrl of lanUrls) {
            items.push(
              '<div class="info-item"><strong>局域网地址</strong><div class="mono">' + escapeHtml(lanUrl) + '</div><div class="small">登录链接：' + escapeHtml(lanUrl + '/?token=' + token) + '</div></div>'
            );
          }
        }

        urlList.innerHTML = items.join('');
      }

      function fillForm(config) {
        state.config = config;
        document.getElementById('runtime').value = config.runtime || 'codex';
        document.getElementById('defaultMode').value = config.defaultMode === 'yolo' ? 'yolo' : 'normal';
        document.getElementById('historyMessageLimit').value = String(config.historyMessageLimit || 8);
        document.getElementById('streamStatusIdleStartSeconds').value = String(config.streamStatusIdleStartSeconds || 180);
        document.getElementById('streamStatusCheckIntervalSeconds').value = String(config.streamStatusCheckIntervalSeconds || 10);
        document.getElementById('defaultWorkspaceRoot').value = config.defaultWorkspaceRoot || '';
        renderDefaultModelOptions(config);
        document.getElementById('codexSkipGitRepoCheck').checked = config.codexSkipGitRepoCheck === true;
        document.getElementById('codexSandboxMode').value = config.codexSandboxMode || 'workspace-write';
        document.getElementById('codexNetworkAccess').checked = config.codexNetworkAccess !== false;
        document.getElementById('codexReasoningEffort').value = config.codexReasoningEffort || 'medium';
        document.getElementById('sdkToolCallDetailsInText').checked = config.sdkToolCallDetailsInText !== false;
        document.getElementById('uiAllowLan').checked = config.uiAllowLan === true;
        document.getElementById('uiAccessToken').value = config.uiAccessToken || '';
        renderUiAccess();
        ensureActiveChannelId();
        renderChannelsWorkspace();
        rerenderCodexSessions();
      }

      async function api(path, options) {
        const response = await fetch(path, Object.assign({
          headers: { 'Content-Type': 'application/json' },
        }, options || {}));
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error(data.error || text || 'Request failed');
        }
        return data;
      }

      async function loadStatus() {
        const status = await api('/api/status');
        const config = await api('/api/config');
        state.uiAccess = status.uiAccess || null;
        state.bridgeStatus = status.bridge || null;
        state.autostartStatus = status.autostart || null;
        state.weixinAccounts = status.weixin && Array.isArray(status.weixin.linkedAccounts) ? status.weixin.linkedAccounts : [];
        fillForm(config);
        const adapters = adapterStatuses();
        const runningAdapters = adapters.filter((item) => item.running);
        setText('bridgeStatus', status.bridge.running ? '运行中' : '已停止');
        setText('bridgeStatusMeta', adapters.length
          ? ('运行实例 ' + runningAdapters.length + ' / ' + adapters.length)
          : '当前没有通道实例在运行');
        renderAutostartStatus(status.autostart || null);
        setText('integrationStatus', status.codexIntegrationInstalled ? '已安装' : '未安装');
        setText('runtimeStatus', config.runtime || 'codex');
        setText('overviewHomeStatus', status.home);
        setText('packageRoot', status.packageRoot);
        renderBindings({
          bindings: state.bindings,
          options: state.bindingOptions,
        });
      }

      function renderAutostartStatus(status) {
        const valueEl = document.getElementById('autostartStatus');
        const noticeEl = document.getElementById('autostartNotice');
        const refreshBtn = document.getElementById('refreshAutostartBtn');

        if (!status || status.supported !== true) {
          if (valueEl) valueEl.textContent = '不支持';
          noticeEl.textContent = status && status.error
            ? status.error
            : '当前系统暂不支持桥接服务开机自启动。';
          refreshBtn.disabled = true;
          return;
        }

        if (status.error) {
          if (valueEl) valueEl.textContent = '配置异常';
          noticeEl.textContent = status.error;
          refreshBtn.disabled = false;
          return;
        }

        if (!status.installed) {
          if (valueEl) valueEl.textContent = '未启用';
          noticeEl.textContent = [
            '如需启用，请以管理员身份打开 PowerShell 或终端执行：',
            'codex-to-im autostart install',
            status.runAsUser ? '运行账号：' + status.runAsUser : '',
            '安装时会要求输入当前 Windows 登录密码。',
          ].filter(Boolean).join('\\n');
          refreshBtn.disabled = false;
          return;
        }

        if (valueEl) valueEl.textContent = status.enabled ? '已启用' : '已禁用';
        noticeEl.textContent = [
          '方式：Windows 任务计划程序（开机触发）',
          status.runAsUser ? '运行账号：' + status.runAsUser : '',
          status.state ? '任务状态：' + status.state : '',
          '如需关闭，请以管理员身份执行：codex-to-im autostart uninstall',
        ].filter(Boolean).join(' · ');
        refreshBtn.disabled = false;
      }

      function renderHighlightedLogs(raw) {
        const lines = String(raw || '暂无日志').split(/\\r?\\n/);
        return lines.map((line) => {
          const escaped = escapeHtml(line);
          const levelMatch = line.match(/\\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\\b/i);
          const level = levelMatch ? levelMatch[1].toLowerCase() : 'info';
          const highlighted = escaped
            .replace(/(\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z)?)/g, '<span class="log-date">$1</span>')
            .replace(/(\\[[^\\]]+\\])/g, '<span class="log-tag">$1</span>')
            .replace(/\\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\\b/gi, '<span class="log-level">$1</span>');
          return '<div class="log-line log-' + escapeHtml(level) + '">' + highlighted + '</div>';
        }).join('');
      }

      async function loadLogs() {
        const logs = await api('/api/logs?lines=220');
        const output = document.getElementById('logsOutput');
        const wasNearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 48;
        const previousTop = output.scrollTop;
        output.innerHTML = renderHighlightedLogs(logs.logs || '暂无日志');
        output.scrollTop = wasNearBottom ? output.scrollHeight : previousTop;
      }

      async function loadCodexSessions() {
        const result = await api('/api/codex-sessions');
        renderCodexSessions(result);
      }

      async function loadRuntimeStatusOnly() {
        const status = await api('/api/status');
        state.uiAccess = status.uiAccess || null;
        state.bridgeStatus = status.bridge || null;
        state.autostartStatus = status.autostart || null;
        state.weixinAccounts = status.weixin && Array.isArray(status.weixin.linkedAccounts) ? status.weixin.linkedAccounts : [];

        const adapters = adapterStatuses();
        const runningAdapters = adapters.filter((item) => item.running);
        setText('bridgeStatus', status.bridge.running ? '运行中' : '已停止');
        setText('bridgeStatusMeta', adapters.length
          ? ('运行实例 ' + runningAdapters.length + ' / ' + adapters.length)
          : '当前没有通道实例在运行');
        renderAutostartStatus(status.autostart || null);
        setText('integrationStatus', status.codexIntegrationInstalled ? '已安装' : '未安装');
        setText('overviewHomeStatus', status.home);
        setText('packageRoot', status.packageRoot);
      }

      function sessionCreatorLabel(source) {
        return source === 'bridge' ? 'Bridge / IM' : 'Codex Native';
      }

      function chatRoleLabel(role) {
        if (role === 'user') return '用户';
        if (role === 'assistant') return 'Codex';
        if (role === 'system') return '系统';
        if (role === 'tool') return '工具';
        return role || '消息';
      }

      function chatRoleClass(role) {
        if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
          return role;
        }
        return 'other';
      }

      function messageTimeLabel(value) {
        return value ? formatTime(value) : '无时间记录';
      }

      function renderHistoryMessageContent(message, index) {
        const mode = state.sessionHistoryMessageModes[String(index)] || 'markdown';
        if (mode === 'raw') {
          return '<div class="chat-history-content raw">' + escapeHtml(message.rawJsonl || message.content || '') + '</div>';
        }
        return '<div class="chat-history-content markdown">' + (message.renderedContent || escapeHtml(message.content || '')) + '</div>';
      }

      function renderSessionHistory(result) {
        state.sessionHistory = result || null;
        const session = result && result.session ? result.session : null;
        const messages = result && Array.isArray(result.messages) ? result.messages : [];
        const title = session ? (session.title || 'Untitled Session') : '会话历史';
        const ref = session ? sessionRef(session) : state.activeSessionRef;

        document.getElementById('sessionHistoryTitle').textContent = title;
        document.getElementById('sessionHistorySubtitle').textContent = ref
          ? 'Session: ' + ref
          : '查看当前 session 的 chat_history。';
        document.getElementById('deleteSessionBtn').disabled = !ref;
        document.getElementById('refreshSessionHistoryBtn').disabled = !ref;

        document.getElementById('sessionHistorySummary').innerHTML = session
          ? ''
            + '<div class="session-history-stat"><strong>Creator</strong><span>' + escapeHtml(sessionCreatorLabel(result.source)) + '</span></div>'
            + '<div class="session-history-stat"><strong>消息数</strong><span>' + escapeHtml(String(messages.length)) + '</span></div>'
            + '<div class="session-history-stat"><strong>最近活动</strong><span>' + escapeHtml(formatTime(session.lastEventAt || '')) + '</span></div>'
            + '<div class="session-history-stat"><strong>目录</strong><span>' + escapeHtml(session.cwd || '(no cwd)') + '</span></div>'
          : '';

        const list = document.getElementById('sessionHistoryList');
        const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
        const previousTop = list.scrollTop;
        const shouldStickToBottom = wasNearBottom || list.dataset.loaded !== 'true';
        if (!messages.length) {
          list.innerHTML = '<div class="binding-empty">当前 session 没有可显示的 chat_history。</div>';
          list.dataset.loaded = 'true';
          return;
        }

        list.innerHTML = messages.map((message, index) => (
          '<article class="chat-history-message ' + escapeHtml(chatRoleClass(message.role)) + '" data-message-index="' + escapeHtml(String(index)) + '">'
            + '<div class="chat-history-bubble">'
            +   '<div class="chat-history-message-head">'
            +     '<span class="chat-history-role">' + escapeHtml(chatRoleLabel(message.role)) + '</span>'
            +     '<span class="chat-history-message-meta">'
            +       '<span>' + escapeHtml(messageTimeLabel(message.timestamp || '')) + '</span>'
            +       (message.kind ? '<span class="small">' + escapeHtml(message.kind) + '</span>' : '')
            +       iconButton('toggle-history-message-mode', state.sessionHistoryMessageModes[String(index)] === 'raw' ? 'markdown' : 'raw', state.sessionHistoryMessageModes[String(index)] === 'raw' ? '显示解析' : '显示 JSONL', 'data-message-index="' + escapeHtml(String(index)) + '"', 'chat-history-icon')
            +       iconButton('copy-history-message', 'copy', '复制 JSONL', 'data-message-index="' + escapeHtml(String(index)) + '"', 'chat-history-icon')
            +     '</span>'
            +   '</div>'
            +   renderHistoryMessageContent(message, index)
            + '</div>'
          + '</article>'
        )).join('');
        list.dataset.loaded = 'true';
        list.scrollTop = shouldStickToBottom ? list.scrollHeight : previousTop;
      }

      async function openSessionHistory(ref, syncHash) {
        state.activeSessionRef = ref || '';
        state.sessionHistoryMessageModes = {};
        setActivePage('session-history', syncHash);
        renderSessionHistory({
          session: null,
          source: '',
          messages: [],
        });

        await refreshSessionHistoryData();
      }

      async function refreshSessionHistory() {
        if (!state.activeSessionRef) {
          throw new Error('当前没有选中的会话。');
        }
        await refreshSessionHistoryData();
      }

      function findSessionSummaryByRef(ref) {
        return (state.codexSessions || []).find((session) => sessionRef(session) === ref) || null;
      }

      async function deleteSessionByRef(ref) {
        if (!ref) {
          throw new Error('当前没有选中的会话。');
        }
        const session = (
          state.sessionHistory
          && state.sessionHistory.session
          && sessionRef(state.sessionHistory.session) === ref
        )
          ? state.sessionHistory.session
          : findSessionSummaryByRef(ref);
        const label = session && session.title ? session.title : ref;
        if (!window.confirm('确定删除会话“' + label + '”？删除后会移除本地消息和绑定；Codex 会话会被归档。')) {
          return false;
        }

        await api('/api/sessions/delete', {
          method: 'POST',
          body: JSON.stringify(sessionIdentityPayload(ref)),
        });
        state.activeSessionRef = '';
        state.sessionHistory = null;
        await loadBindings();
        await loadCodexSessions();
        setActivePage('sessions', true);
        showMessage('codexMessage', 'success', '会话已删除。');
        return true;
      }

      async function assignSessionChannelByBinding(ref, bindingId) {
        if (!ref) {
          throw new Error('当前没有选中的会话。');
        }

        if (!bindingId) {
          throw new Error('请先选择要指定的通道。');
        }

        const binding = (state.bindings || []).find((item) => item.id === bindingId);
        if (!binding) {
          throw new Error('指定的通道绑定不存在，请刷新后重试。');
        }
        const identity = sessionIdentityPayload(ref);
        if (
          (identity.bridgeSessionId && binding.currentSessionId === identity.bridgeSessionId)
          || (identity.codexThreadId && binding.currentThreadId === identity.codexThreadId)
        ) {
          showMessage('codexMessage', 'success', '该通道已经绑定到当前会话。');
          return;
        }

        const session = findSessionSummaryByRef(ref);
        const targetLabel = session && session.title ? session.title : ref;
        const currentLabel = binding.currentTargetLabel || binding.currentSessionName || binding.currentSessionId || binding.chatId;
        const channelLabel = formatBindingAccount(binding);
        if (binding.currentSessionId && !window.confirm('通道“' + channelLabel + '”当前已绑定到“' + currentLabel + '”。确认换绑到“' + targetLabel + '”？')) {
          return;
        }

        const result = await api('/api/bindings/update', {
          method: 'POST',
          body: JSON.stringify({ bindingId, ...identity }),
        });
        renderBindings(result);
        showMessage('codexMessage', 'success', '通道已指定到当前会话。');
      }

      async function assignSessionChannelDefault(ref, channelType) {
        if (!ref) {
          throw new Error('当前没有选中的会话。');
        }
        if (!channelType) {
          throw new Error('当前没有可指定的通道实例。');
        }

        const channel = visibleChannels().find((item) => item.id === channelType);
        if (!channel) {
          throw new Error('指定的通道不存在。');
        }

        const channelDefault = channelDefaultForChannel(channelType);
        const identity = sessionIdentityPayload(ref);
        const targetSession = findSessionSummaryByRef(ref);
        const targetLabel = targetSession && targetSession.title ? targetSession.title : ref;
        const current = channelDefault && (
          (identity.bridgeSessionId && channelDefault.targetSessionId === identity.bridgeSessionId)
          || (identity.codexThreadId && channelDefault.targetThreadId === identity.codexThreadId)
        );
        if (
          channelDefault
          && !current
          && !window.confirm('通道“' + channel.alias + '”当前已预绑定到“' + channelDefault.targetLabel + '”。确认改为“' + targetLabel + '”？')
        ) {
          return;
        }

        const result = await api('/api/channel-default-targets/update', {
          method: 'POST',
          body: JSON.stringify({ channelType, ...identity }),
        });
        renderBindings(result);
        showMessage('codexMessage', 'success', '已设置预绑定。该通道收到下一条新对话时会自动进入当前会话。');
      }

      function closeSessionChannelModal() {
        const modal = document.getElementById('sessionChannelModal');
        if (!modal) return;
        modal.hidden = true;
        modal.dataset.sessionRef = '';
      }

      function openSessionChannelModal(ref) {
        if (!ref) {
          throw new Error('当前没有选中的会话。');
        }
        const bindings = state.bindings || [];
        const channels = visibleChannels().filter((channel) => !String(channel.id || '').startsWith('__draft__:'));

        const session = findSessionSummaryByRef(ref);
        const modal = document.getElementById('sessionChannelModal');
        const list = document.getElementById('sessionChannelModalList');
        const subtitle = document.getElementById('sessionChannelModalSubtitle');
        modal.dataset.sessionRef = ref;
        subtitle.textContent = '目标会话：' + ((session && session.title) ? session.title : ref);
        const identity = sessionIdentityPayload(ref);

        const bindingItems = bindings.map((binding) => {
          const isCurrent = (identity.bridgeSessionId && binding.currentSessionId === identity.bridgeSessionId)
            || (identity.codexThreadId && binding.currentThreadId === identity.codexThreadId);
          const currentLabel = binding.currentTargetLabel || binding.currentSessionName || binding.currentSessionId || '';
          return ''
            + '<button type="button" class="modal-list-item' + (isCurrent ? ' active' : '') + '" data-action="assign-session-channel-choice" data-binding-id="' + escapeHtml(binding.id) + '">'
            +   '<span class="modal-list-title">' + escapeHtml(formatBindingAccount(binding)) + '</span>'
            +   '<span class="modal-list-meta">' + escapeHtml(isCurrent ? '当前已绑定到此会话' : (currentLabel ? '当前：' + currentLabel : '未绑定会话')) + '</span>'
            + '</button>';
        });

        const defaultItems = channels
          .filter((channel) => {
            const channelDefault = channelDefaultForChannel(channel.id);
            return Boolean(channelDefault) || !bindings.some((binding) => binding.channelType === channel.id);
          })
          .map((channel) => {
            const channelDefault = channelDefaultForChannel(channel.id);
            const isCurrent = channelDefault && (
              (identity.bridgeSessionId && channelDefault.targetSessionId === identity.bridgeSessionId)
              || (identity.codexThreadId && channelDefault.targetThreadId === identity.codexThreadId)
            );
            const meta = isCurrent
              ? '下一条新聊天将直接进入当前会话。'
              : (channelDefault && channelDefault.targetLabel
                ? ('当前入口：' + channelDefault.targetLabel + '。点击改为当前会话。')
                : '该通道收到下一条新聊天后，将直接进入当前会话。');
            return ''
              + '<button type="button" class="modal-list-item' + (isCurrent ? ' active' : '') + '" data-action="assign-session-channel-default" data-channel-type="' + escapeHtml(channel.id) + '"' + (isCurrent ? ' disabled' : '') + '>'
              +   '<span class="modal-list-title">' + escapeHtml(channel.alias) + ' · ' + escapeHtml(providerLabel(channel.provider)) + ' · 下一条新聊天</span>'
              +   '<span class="modal-list-meta">' + escapeHtml(meta) + '</span>'
              + '</button>';
          });

        if (bindingItems.length === 0 && defaultItems.length === 0) {
          list.innerHTML = '<div class="binding-empty">当前没有可用通道实例。请先创建并保存一个通道。</div>';
        } else {
          list.innerHTML = bindingItems.join('') + defaultItems.join('');
        }
        modal.hidden = false;
      }

      function closeSessionRenameModal() {
        const modal = document.getElementById('sessionRenameModal');
        if (!modal) return;
        modal.hidden = true;
        modal.dataset.sessionRef = '';
        state.activeSessionRenameRef = '';
      }

      function openSessionRenameModal(ref) {
        if (!ref) throw new Error('当前没有选中的会话。');
        const session = findSessionSummaryByRef(ref);
        const modal = document.getElementById('sessionRenameModal');
        const input = document.getElementById('sessionRenameInput');
        document.getElementById('sessionRenameSubtitle').textContent = '当前会话：' + ((session && session.title) ? session.title : ref);
        modal.dataset.sessionRef = ref;
        state.activeSessionRenameRef = ref;
        input.value = session && session.title ? session.title : '';
        modal.hidden = false;
        input.focus();
        input.select();
      }

      async function saveSessionRename() {
        const modal = document.getElementById('sessionRenameModal');
        const ref = modal.dataset.sessionRef || state.activeSessionRenameRef || '';
        const name = document.getElementById('sessionRenameInput').value;
        const result = await api('/api/sessions/rename', {
          method: 'POST',
          body: JSON.stringify({ ...sessionIdentityPayload(ref), name }),
        });
        closeSessionRenameModal();
        await loadBindings();
        await loadCodexSessions();
        if (state.sessionHistory && sessionRef(state.sessionHistory.session || {}) === ref) {
          await refreshSessionHistoryData();
        }
        showMessage('codexMessage', 'success', '会话已重命名。');
        return result;
      }

      function closeSessionConfigModal() {
        const modal = document.getElementById('sessionConfigModal');
        if (!modal) return;
        modal.hidden = true;
        modal.dataset.bridgeSessionId = '';
        state.activeSessionConfigBridgeSessionId = '';
      }

      function fillSessionConfigForm(config) {
        document.getElementById('sessionConfigName').value = config.name || config.title || '';
        document.getElementById('sessionConfigCwd').value = config.workingDirectory || '';
        renderModelOptionsForSelect(document.getElementById('sessionConfigModel'), config.model || '', '跟随全局 / Codex 默认模型');
        document.getElementById('sessionConfigMode').value = config.preferredMode === 'yolo' ? 'yolo' : 'normal';
        document.getElementById('sessionConfigProvider').value = config.codexProvider || '';
        document.getElementById('sessionConfigReasoning').value = config.reasoningEffort || '';
        document.getElementById('sessionConfigSandbox').value = config.codexSandboxMode || '';
        document.getElementById('sessionConfigNetwork').checked = config.codexNetworkAccess === undefined
          ? ((state.config || {}).codexNetworkAccess !== false)
          : config.codexNetworkAccess !== false;
        document.getElementById('sessionConfigPrompt').value = config.systemPrompt || '';
      }

      function sessionConfigPayload() {
        return {
          bridgeSessionId: state.activeSessionConfigBridgeSessionId,
          name: document.getElementById('sessionConfigName').value,
          workingDirectory: document.getElementById('sessionConfigCwd').value,
          model: document.getElementById('sessionConfigModel').value,
          preferredMode: document.getElementById('sessionConfigMode').value,
          codexProvider: document.getElementById('sessionConfigProvider').value,
          reasoningEffort: document.getElementById('sessionConfigReasoning').value,
          codexSandboxMode: document.getElementById('sessionConfigSandbox').value,
          codexNetworkAccess: document.getElementById('sessionConfigNetwork').checked,
          systemPrompt: document.getElementById('sessionConfigPrompt').value,
        };
      }

      async function openSessionConfigModal(ref) {
        if (!ref) throw new Error('当前没有选中的会话。');
        const session = findSessionSummaryByRef(ref);
        const bridgeSessionId = sessionBridgeSessionId(session);
        if (!bridgeSessionId) throw new Error('这个 Codex 会话还没有绑定到 IM 通道，暂时不能保存会话级配置。');
        const result = await api('/api/session-config?bridgeSessionId=' + encodeURIComponent(bridgeSessionId));
        const modal = document.getElementById('sessionConfigModal');
        modal.dataset.bridgeSessionId = bridgeSessionId;
        state.activeSessionConfigBridgeSessionId = bridgeSessionId;
        document.getElementById('sessionConfigSubtitle').textContent = '当前会话：' + ((session && session.title) ? session.title : ref);
        fillSessionConfigForm(result.config || {});
        modal.hidden = false;
      }

      async function saveSessionConfig() {
        const result = await api('/api/session-config', {
          method: 'POST',
          body: JSON.stringify(sessionConfigPayload()),
        });
        closeSessionConfigModal();
        await loadBindings();
        await loadCodexSessions();
        if (state.sessionHistory && sessionBridgeSessionId(state.sessionHistory.session || {}) === state.activeSessionConfigBridgeSessionId) {
          await refreshSessionHistoryData();
        }
        showMessage('codexMessage', 'success', '会话配置已保存。');
        return result;
      }

      async function loadBindings() {
        const result = await api('/api/bindings');
        renderBindings(result);
      }

      async function saveConfig(options) {
        const opts = options || {};
        const beforeConfig = state.config || {};
        const saved = await api('/api/config', {
          method: 'POST',
          body: JSON.stringify(formPayload()),
        });
        fillForm(saved.config);
        if (opts.messageId) {
          showMessage(
            opts.messageId,
            'success',
            buildConfigSaveMessage(beforeConfig, saved.config, opts.scope || 'all'),
          );
        }
        return saved;
      }

      function createChannelDraft(provider) {
        state.channelDraft = {
          id: '__draft__:' + provider,
          alias: providerLabel(provider),
          provider,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          config: provider === 'feishu'
            ? {
                appId: '',
                appSecret: '',
                site: 'feishu',
                allowedUsers: [],
                streamingEnabled: true,
                feedbackMarkdownEnabled: true,
              }
            : {
                accountId: '',
                baseUrl: '',
                cdnBaseUrl: '',
                mediaEnabled: false,
                feedbackMarkdownEnabled: false,
              },
        };
        state.activeChannelId = state.channelDraft.id;
        renderChannelsWorkspace();
      }

      function currentChannelEditorPayload(channel) {
        const payload = {
          provider: channel.provider,
          alias: document.getElementById('channelAliasInput').value,
          enabled: document.getElementById('channelEnabledInput').checked,
        };

        if (!String(channel.id || '').startsWith('__draft__:')) {
          payload.id = channel.id;
        }

        if (channel.provider === 'feishu') {
          payload.appId = document.getElementById('channelAppId').value;
          payload.appSecret = document.getElementById('channelAppSecret').value;
          payload.site = document.getElementById('channelSite').value;
          payload.allowedUsers = document.getElementById('channelAllowedUsers').value;
          payload.streamingEnabled = document.getElementById('channelStreamingEnabled').checked;
          payload.feedbackMarkdownEnabled = document.getElementById('channelFeedbackMarkdownEnabled').checked;
          return payload;
        }

        payload.accountId = document.getElementById('channelAccountId').value;
        payload.baseUrl = document.getElementById('channelBaseUrl').value;
        payload.cdnBaseUrl = document.getElementById('channelCdnBaseUrl').value;
        payload.mediaEnabled = document.getElementById('channelMediaEnabled').checked;
        payload.feedbackMarkdownEnabled = document.getElementById('channelFeedbackMarkdownEnabled').checked;
        return payload;
      }

      function syncActiveChannelDraftFromEditor() {
        const channel = getChannelById(state.activeChannelId);
        if (!channel) return;
        if (!document.getElementById('channelAliasInput')) return;
        state.channelEditorDrafts[channel.id] = currentChannelEditorPayload(channel);
      }

      async function saveChannel(channel) {
        const result = await api('/api/channels/save', {
          method: 'POST',
          body: JSON.stringify(currentChannelEditorPayload(channel)),
        });
        delete state.channelEditorDrafts[channel.id];
        delete state.channelEditorDrafts[result.channel.id];
        state.channelDraft = null;
        fillForm(result.config);
        renderBindings(result);
        setActiveChannel(result.channel.id, false);
        return result;
      }

      async function deleteCurrentChannel(channel) {
        if (String(channel.id || '').startsWith('__draft__:')) {
          delete state.channelEditorDrafts[channel.id];
          state.channelDraft = null;
          state.activeChannelId = '';
          renderChannelsWorkspace();
          showMessage('channelMessage', 'success', '未保存的新通道已取消。');
          return;
        }

        const result = await api('/api/channels/delete', {
          method: 'POST',
          body: JSON.stringify({ channelId: channel.id }),
        });
        delete state.channelEditorDrafts[channel.id];
        state.channelDraft = null;
        fillForm(result.config);
        renderBindings(result);
        showMessage('channelMessage', 'success', '通道已删除。');
      }

      async function testCurrentChannel(channel) {
        if (String(channel.id || '').startsWith('__draft__:')) {
          const saved = await saveChannel(channel);
          channel = getChannelById(saved.channel.id);
        } else {
          await saveChannel(channel);
          channel = getChannelById(channel.id);
        }
        const result = await api('/api/channels/test', {
          method: 'POST',
          body: JSON.stringify({ channelId: channel.id }),
        });
        showMessage('channelMessage', result.ok ? 'success' : 'error', result.message);
      }

      function buildWeixinLoginPopupUrl(sessionId) {
        return '/weixin-login/' + encodeURIComponent(sessionId);
      }

      function stopWeixinLoginWatcher(sessionId) {
        const timer = state.weixinLoginPollers[sessionId];
        if (!timer) return;
        window.clearInterval(timer);
        delete state.weixinLoginPollers[sessionId];
      }

      async function watchWeixinLoginSession(sessionId) {
        stopWeixinLoginWatcher(sessionId);

        const tick = async () => {
          try {
            const result = await api('/api/channels/weixin-login/' + encodeURIComponent(sessionId));
            const session = result.session || null;
            if (!session) {
              stopWeixinLoginWatcher(sessionId);
              showMessage('channelMessage', 'error', '微信扫码会话不存在或已过期，请重新发起扫码。');
              return;
            }

            if (session.status === 'confirmed') {
              stopWeixinLoginWatcher(sessionId);
              if (result.config) {
                fillForm(result.config);
              } else {
                await loadStatus();
              }
              showMessage('channelMessage', 'success', session.message || ('微信扫码成功，账号 ' + (session.accountId || '') + ' 已保存。'));
              return;
            }

            if (session.status === 'failed') {
              stopWeixinLoginWatcher(sessionId);
              showMessage('channelMessage', 'error', session.message || '微信扫码失败，请重新发起扫码。');
            }
          } catch (error) {
            stopWeixinLoginWatcher(sessionId);
            showMessage('channelMessage', 'error', error.message);
          }
        };

        await tick();
        if (!state.weixinLoginPollers[sessionId]) {
          state.weixinLoginPollers[sessionId] = window.setInterval(tick, 2000);
        }
      }

      async function loginWeixinForChannel(channel) {
        let popup = null;
        try {
          popup = window.open('about:blank', '_blank', 'popup=yes,width=520,height=760');
        } catch {}

        if (String(channel.id || '').startsWith('__draft__:')) {
          const saved = await saveChannel(channel);
          channel = getChannelById(saved.channel.id);
        } else {
          await saveChannel(channel);
          channel = getChannelById(channel.id);
        }

        const result = await api('/api/channels/weixin-login/start', {
          method: 'POST',
          body: JSON.stringify({ channelId: channel.id }),
        });

        const popupUrl = result.popupUrl || buildWeixinLoginPopupUrl(result.sessionId);
        if (popup && !popup.closed) {
          popup.location.replace(popupUrl);
        } else {
          const fallback = window.open(popupUrl, '_blank', 'popup=yes,width=520,height=760');
          if (!fallback) {
            showMessage('channelMessage', 'error', '浏览器阻止了扫码弹窗，请允许当前站点打开弹窗后重试。');
            return;
          }
        }

        showMessage('channelMessage', 'success', result.message || '微信扫码窗口已打开，请在弹窗中完成扫码。');
        void watchWeixinLoginSession(result.sessionId);
      }

      async function handleChannelEditorAction(event) {
        const source = event.target instanceof Element ? event.target : null;
        const target = source ? source.closest('button[data-action]') : null;
        if (!target) return;

        const channelId = target.dataset.channelId || state.activeChannelId;
        const channel = getChannelById(channelId);
        if (!channel) return;

        try {
          if (target.dataset.action === 'channel-save') {
            await saveChannel(channel);
            showMessage('channelMessage', 'success', '通道已保存。');
            return;
          }
          if (target.dataset.action === 'channel-test') {
            await testCurrentChannel(channel);
            return;
          }
          if (target.dataset.action === 'channel-delete') {
            await deleteCurrentChannel(channel);
            return;
          }
          if (target.dataset.action === 'channel-weixin-login') {
            await loginWeixinForChannel(channel);
            return;
          }
          if (target.dataset.action === 'select-binding-tab') {
            state.activeBindingByChannelId[channel.id] = target.dataset.bindingId || '';
            renderChannelsWorkspace();
            return;
          }
          if (target.dataset.action === 'unbind-binding') {
            const result = await api('/api/bindings/delete', {
              method: 'POST',
              body: JSON.stringify({ bindingId: target.dataset.bindingId }),
            });
            renderBindings(result);
            showMessage('channelMessage', 'success', '聊天绑定已解绑。');
            return;
          }
          if (target.dataset.action === 'clear-channel-default-target') {
            const result = await api('/api/channel-default-targets/delete', {
              method: 'POST',
              body: JSON.stringify({ channelType: target.dataset.channelType || channel.id }),
            });
            renderBindings(result);
            showMessage('channelMessage', 'success', '通道入口已清除。');
            return;
          }
          if (target.dataset.action === 'switch-binding-target') {
            const result = await api('/api/bindings/update', {
              method: 'POST',
              body: JSON.stringify({
                bindingId: target.dataset.bindingId,
                ...sessionIdentityPayload(target.dataset.sessionRef || ''),
              }),
            });
            renderBindings(result);
            showMessage('channelMessage', 'success', '聊天绑定已更新。');
          }
        } catch (error) {
          showMessage('channelMessage', 'error', error.message);
        }
      }

      document.querySelectorAll('.nav-link').forEach((element) => {
        element.addEventListener('click', () => {
          setActivePage(element.dataset.page || 'overview', true);
        });
      });

      window.addEventListener('hashchange', syncPageFromHash);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          void refreshPageData(state.activePage);
        }
      });

      document.getElementById('copyUiTokenBtn').addEventListener('click', async () => {
        try {
          await copyText(document.getElementById('uiAccessToken').value, '访问 token 已复制。');
        } catch (error) {
          showMessage('configMessage', 'error', error.message);
        }
      });

      document.getElementById('copyUiLanLinkBtn').addEventListener('click', async () => {
        try {
          const urls = state.uiAccess && Array.isArray(state.uiAccess.lanUrls) ? state.uiAccess.lanUrls : [];
          const token = document.getElementById('uiAccessToken').value;
          if (!urls.length || !token) {
            throw new Error('当前还没有可复制的局域网登录链接。');
          }
          await copyText(urls[0] + '/?token=' + token, '局域网登录链接已复制。');
        } catch (error) {
          showMessage('configMessage', 'error', error.message);
        }
      });

      document.getElementById('regenerateUiTokenBtn').addEventListener('click', () => {
        if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
          showMessage('configMessage', 'error', '当前浏览器不支持生成 token。');
          return;
        }
        document.getElementById('uiAccessToken').value =
          window.crypto.randomUUID().replaceAll('-', '') + window.crypto.randomUUID().replaceAll('-', '');
        renderUiAccess();
        showMessage('configMessage', 'success', '已生成新的访问 token，点击“保存配置”后生效。');
      });

      document.getElementById('saveConfigBtn').addEventListener('click', async () => {
        try {
          await saveConfig({ messageId: 'configMessage', scope: 'all' });
          await loadStatus();
          await loadBindings();
        } catch (error) {
          showMessage('configMessage', 'error', error.message);
        }
      });

      document.getElementById('startBridgeBtn').addEventListener('click', async () => {
        try {
          await saveConfig();
          const result = await api('/api/bridge/start', { method: 'POST' });
          showMessage('opsMessage', 'success', '桥接服务已启动。PID: ' + (result.status.pid || '-'));
          await loadStatus();
          await loadBindings();
          await loadLogs();
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
          await loadLogs();
        }
      });

      document.getElementById('stopBridgeBtn').addEventListener('click', async () => {
        try {
          await api('/api/bridge/stop', { method: 'POST' });
          showMessage('opsMessage', 'success', '桥接服务已停止。');
          await loadStatus();
          await loadBindings();
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
        }
      });

      document.getElementById('restartBridgeBtn').addEventListener('click', async () => {
        try {
          await saveConfig();
          const result = await api('/api/bridge/restart', { method: 'POST' });
          showMessage('opsMessage', 'success', '桥接服务已重启。PID: ' + (result.status.pid || '-'));
          await loadStatus();
          await loadBindings();
          await loadLogs();
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
          await loadLogs();
        }
      });

      document.getElementById('refreshBtn').addEventListener('click', async () => {
        try {
          await loadStatus();
          await loadBindings();
          await loadCodexSessions();
          await loadLogs();
          showMessage('opsMessage', 'success', '状态已刷新。');
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
        }
      });

      document.getElementById('refreshAutostartBtn').addEventListener('click', async () => {
        try {
          await loadStatus();
          showMessage('opsMessage', 'success', '开机自启动状态已刷新。');
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
        }
      });

      document.getElementById('installIntegrationBtn').addEventListener('click', async () => {
        try {
          const result = await api('/api/install-codex-integration', { method: 'POST' });
          showMessage('opsMessage', 'success', '可选 Codex Skill 已处理：' + result.method + ' -> ' + result.targetDir);
          await loadStatus();
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
        }
      });

      document.getElementById('refreshLogsBtn').addEventListener('click', async () => {
        try {
          await loadLogs();
        } catch (error) {
          showMessage('opsMessage', 'error', error.message);
        }
      });

      document.getElementById('refreshCodexBtn').addEventListener('click', async () => {
        try {
          await loadCodexSessions();
          showMessage('codexMessage', 'success', '会话列表已刷新。');
        } catch (error) {
          showGlobalMessage('error', error.message);
        }
      });

      document.getElementById('createChannelBtn').addEventListener('click', () => {
        const provider = document.getElementById('newChannelProvider').value === 'weixin' ? 'weixin' : 'feishu';
        createChannelDraft(provider);
        setActivePage('channels', false);
        setActiveChannel(state.activeChannelId, true);
      });

      document.getElementById('refreshChannelsBtn').addEventListener('click', async () => {
        try {
          await loadStatus();
          await loadBindings();
          showMessage('channelMessage', 'success', '通道状态已刷新。');
        } catch (error) {
          showMessage('channelMessage', 'error', error.message);
        }
      });

      document.getElementById('channelList').addEventListener('click', (event) => {
        const source = event.target instanceof Element ? event.target : null;
        const target = source ? source.closest('button[data-channel-id]') : null;
        if (!target) return;
        setActivePage('channels', false);
        setActiveChannel(target.dataset.channelId || '', true);
      });

      document.getElementById('channelEditor').addEventListener('click', (event) => {
        handleChannelEditorAction(event);
      });
      document.getElementById('channelEditor').addEventListener('input', () => {
        syncActiveChannelDraftFromEditor();
      });
      document.getElementById('channelEditor').addEventListener('change', () => {
        syncActiveChannelDraftFromEditor();
      });

      async function handleSessionListAction(event) {
        const source = event.target instanceof Element ? event.target : null;
        if (!source) return;
        const target = source.closest('button[data-action]');

        try {
          if (target) {
            if (target.dataset.action === 'open-session-history') {
              await openSessionHistory(target.dataset.sessionRef || '', true);
              return;
            }
            if (target.dataset.action === 'toggle-creator-display') {
              const ref = target.dataset.sessionRef || '';
              if (ref) {
                state.creatorDisplayBySessionRef[ref] = state.creatorDisplayBySessionRef[ref] === 'raw' ? 'badge' : 'raw';
              }
              renderCodexSessions({ sessions: state.codexSessions, root: state.codexRoot });
              return;
            }
            if (target.dataset.action === 'delete-session') {
              await deleteSessionByRef(target.dataset.sessionRef || '');
              return;
            }
            if (target.dataset.action === 'copy-thread') {
              await copyText(target.dataset.threadId || '', 'Thread ID 已复制。');
              return;
            }
            if (target.dataset.action === 'copy-session-id') {
              await copyText(target.dataset.sessionId || '', 'Bridge 会话 ID 已复制。');
              return;
            }
            if (target.dataset.action === 'copy-bind-command') {
              await copyText(shortThreadCommand(target.dataset.threadId || ''), '接管命令已复制。直接在 SNS 上发给机器人即可切换。');
              return;
            }
            if (target.dataset.action === 'open-session-rename-modal') {
              openSessionRenameModal(target.dataset.sessionRef || '');
              return;
            }
            if (target.dataset.action === 'open-session-config-modal') {
              await openSessionConfigModal(target.dataset.sessionRef || '');
              return;
            }
            if (target.dataset.action === 'open-session-channel-modal') {
              openSessionChannelModal(target.dataset.sessionRef || '');
              return;
            }
          }

        } catch (error) {
          showMessage('codexMessage', 'error', error.message);
        }
      }

      async function handleSessionListDblClick(event) {
        const source = event.target instanceof Element ? event.target : null;
        if (!source || source.closest('button, input, select, textarea, a')) return;
        const card = source.closest('[data-session-ref]');
        if (!card) return;
        try {
          await openSessionHistory(card.dataset.sessionRef || '', true);
        } catch (error) {
          showMessage('codexMessage', 'error', error.message);
        }
      }

      document.getElementById('codexSessionsList').addEventListener('click', handleSessionListAction);
      document.getElementById('codexSessionsList').addEventListener('dblclick', handleSessionListDblClick);
      document.getElementById('boundSessionsList').addEventListener('click', async (event) => {
        const source = event.target instanceof Element ? event.target : null;
        const target = source ? source.closest('button[data-action]') : null;

        if (target && target.dataset.action === 'unbind-binding') {
          try {
            const result = await api('/api/bindings/delete', {
              method: 'POST',
              body: JSON.stringify({ bindingId: target.dataset.bindingId }),
            });
            renderBindings(result);
            showMessage('codexMessage', 'success', '聊天绑定已解绑。');
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
          return;
        }

        if (target && target.dataset.action === 'clear-channel-default-target') {
          try {
            const result = await api('/api/channel-default-targets/delete', {
              method: 'POST',
              body: JSON.stringify({ channelType: target.dataset.channelType }),
            });
            renderBindings(result);
            showMessage('codexMessage', 'success', '通道入口已清除。');
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
          return;
        }

        await handleSessionListAction(event);
      });
      document.getElementById('boundSessionsList').addEventListener('dblclick', handleSessionListDblClick);

      document.getElementById('sessionChannelModal').addEventListener('click', async (event) => {
        const source = event.target instanceof Element ? event.target : null;
        if (!source) return;
        const modal = document.getElementById('sessionChannelModal');
        const target = source.closest('button[data-action]');
        if (source === modal || (target && target.dataset.action === 'close-session-channel-modal')) {
          closeSessionChannelModal();
          return;
        }
        if (target && target.dataset.action === 'assign-session-channel-choice') {
          try {
            await assignSessionChannelByBinding(modal.dataset.sessionRef || '', target.dataset.bindingId || '');
            closeSessionChannelModal();
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
          return;
        }
        if (target && target.dataset.action === 'assign-session-channel-default') {
          try {
            await assignSessionChannelDefault(modal.dataset.sessionRef || '', target.dataset.channelType || '');
            closeSessionChannelModal();
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
        }
      });

      document.getElementById('sessionRenameModal').addEventListener('click', async (event) => {
        const source = event.target instanceof Element ? event.target : null;
        if (!source) return;
        const modal = document.getElementById('sessionRenameModal');
        const target = source.closest('button[data-action]');
        if (source === modal || (target && target.dataset.action === 'close-session-rename-modal')) {
          closeSessionRenameModal();
          return;
        }
        if (target && target.dataset.action === 'save-session-rename') {
          try {
            await saveSessionRename();
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
        }
      });

      document.getElementById('sessionRenameInput').addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        try {
          await saveSessionRename();
        } catch (error) {
          showMessage('codexMessage', 'error', error.message);
        }
      });

      document.getElementById('sessionConfigModal').addEventListener('click', async (event) => {
        const source = event.target instanceof Element ? event.target : null;
        if (!source) return;
        const modal = document.getElementById('sessionConfigModal');
        const target = source.closest('button[data-action]');
        if (source === modal || (target && target.dataset.action === 'close-session-config-modal')) {
          closeSessionConfigModal();
          return;
        }
        if (target && target.dataset.action === 'save-session-config') {
          try {
            await saveSessionConfig();
          } catch (error) {
            showMessage('codexMessage', 'error', error.message);
          }
        }
      });

      document.getElementById('backToSessionsBtn').addEventListener('click', () => {
        setActivePage('sessions', true);
      });

      document.getElementById('refreshSessionHistoryBtn').addEventListener('click', async () => {
        try {
          await refreshSessionHistory();
          showMessage('sessionHistoryMessage', 'success', '会话历史已刷新。');
        } catch (error) {
          showMessage('sessionHistoryMessage', 'error', error.message);
        }
      });

      document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
        try {
          await deleteSessionByRef(state.activeSessionRef);
        } catch (error) {
          showMessage('sessionHistoryMessage', 'error', error.message);
        }
      });

      document.getElementById('sessionHistoryList').addEventListener('click', async (event) => {
        const source = event.target instanceof Element ? event.target : null;
        const target = source ? source.closest('button[data-action]') : null;
        if (!target) return;
        const index = Number(target.dataset.messageIndex || '-1');
        const messages = state.sessionHistory && Array.isArray(state.sessionHistory.messages)
          ? state.sessionHistory.messages
          : [];
        const message = Number.isInteger(index) ? messages[index] : null;
        if (!message) return;
        if (target.dataset.action === 'toggle-history-message-mode') {
          const key = String(index);
          state.sessionHistoryMessageModes[key] = state.sessionHistoryMessageModes[key] === 'raw' ? 'markdown' : 'raw';
          renderSessionHistory(state.sessionHistory);
          return;
        }
        if (target.dataset.action !== 'copy-history-message') return;
        try {
          await copyText(message.rawJsonl || message.content || '', '消息 JSONL 已复制。');
        } catch (error) {
          showMessage('sessionHistoryMessage', 'error', error.message);
        }
      });

      syncPageFromHash();

      Promise.all([loadStatus(), loadBindings(), loadCodexSessions(), loadLogs()]).catch((error) => {
        showMessage('opsMessage', 'error', error.message);
      });

    </script>
  </body>
</html>`;
}
