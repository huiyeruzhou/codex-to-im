# 阶段归档：UI Weixin login route 收缩

## 阶段信息

- 时间：2026-05-30 05:23 - 2026-05-30 05:29
- 阶段描述：继续沿 `cluster-02` 收缩 `ui-server.ts`，优先审计并迁出 Weixin login web session routes；保持 Feishu binding display enrichment 暂不迁移，避免把 channel display 规则与 Weixin 登录状态管理混在同一阶段。
- 本地提交：`Extract UI Weixin login routes`

## 原始行动记录

- 续跑后读取当前 `STATUS.md`、git 状态和最新用户指令，确认上一阶段 `Extract UI channel routes` 已提交，当前工作树仍只有用户侧 `AGENTS.md` 改动；本阶段先把用户新增协作准则写入 `work/rebuild/STATUS.md`。
- 审计 `src/ui-server.ts` 中 Weixin 登录相关入口：`/weixin-login/:sessionId` 在通用 API 鉴权前处理弹窗页；`/api/channels/weixin-login`、`/api/channels/weixin-login/start`、`/api/channels/weixin-login/:sessionId` 在通用鉴权后处理 legacy blocking login、web session start/status。
- 保持 Feishu binding display enrichment 不动；该逻辑仍在 `resolveFeishuBindingDisplay`，依赖 Feishu token/cache 和 binding summary display，不属于 Weixin login route 阶段。
- 新增 `src/ui-weixin-login-routes.ts`，承接 Weixin 登录弹窗页、legacy blocking login、web login start/status API。
- 新增 `mergeWeixinLoginAccount` 到 `src/ui/application/channel.ts`，统一“扫码账号写回微信通道配置”的 payload 组装，替代 `ui-server.ts` 内两处重复逻辑。
- 新增 `src/__tests__/ui-weixin-login-routes.test.ts`，覆盖弹窗鉴权、web session 确认写回、status config payload、legacy endpoint 和 route ignore。
- 复跑审计时曾从 `work/rebuild` 目录执行 `node source-audit.mjs`，工作树出现历史归档文件删除标记；已只恢复这些误删的 `work/rebuild/STATUS-*` 和 `mixed-cluster-boundary-audit.md`，随后从项目根目录正确执行 `node work/rebuild/source-audit.mjs`。

## 关键扫描结果

- `src/ui-server.ts` 从上一阶段的 3940 行降到 3819 行。
- 新增 `src/ui-weixin-login-routes.ts` 211 行、`src/__tests__/ui-weixin-login-routes.test.ts` 200 行。
- 最新 `source-file-audit.md`：187 个 `src/**/*.ts` 文件，其中生产 126 个、测试 61 个；本地 import / re-export 边 727 条。
- 最新 `cluster-02`：15 个生产文件 / 8965 行 / 内部边 32 / 出边 10 / 入边 49 / 测试文件 8。
- 最新函数级热点仍显示 `renderHtml` 是 `ui-server.ts` 最大剩余函数；`handleUiWeixinLoginApiRoute` 位于 `src/ui-weixin-login-routes.ts`，函数体 92 行，外聚依赖 2。

## 验证记录

- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node --test --import tsx src/__tests__/ui-weixin-login-routes.test.ts src/__tests__/weixin-login.test.ts src/__tests__/ui-channel-routes.test.ts src/__tests__/ui-config-routes.test.ts src/__tests__/ui-service-routes.test.ts`，17 tests 全部通过。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node work/rebuild/source-audit.mjs`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run build`。
- 已通过：`git diff --check -- src/ui-server.ts src/ui-weixin-login-routes.ts src/ui/application/channel.ts src/__tests__/ui-weixin-login-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm test`，470 tests 全部通过。

## 审计结论

- 本阶段真正迁出了 Weixin login route，而不是只移动少量 helper：`ui-server.ts` 不再直接 import `weixin-login.ts`，也不再拼装 Weixin account 写回 payload。
- Route module 仍依赖 `weixin-login.ts` 和 config persistence，这是当前阶段接受的 Local UI -> Weixin login workflow 依赖；下一步如果继续收缩，应考虑把 Weixin login runtime 暴露为更窄的 UI-facing port。
- `AGENTS.md` 仍是用户侧未提交改动，不纳入本阶段提交。
