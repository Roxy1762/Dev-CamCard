# 不可变更硬约束（Non-Negotiables）

> 本文件用于约束 Claude Code，避免开发跑偏。
>
> **历史变更**：客户端前端从 Phaser canvas 切换为 HTML/CSS（PR #41 合并）。
> 决策依据见 `docs/technical-decisions.md` "客户端渲染方案"小节。

## 架构硬约束

1. **HTML/CSS + TypeScript + Vite 是正式对战牌桌前端**（`apps/game-client`）。
   - 不引入 React / Vue / Svelte 等额外 UI 框架，渲染层只用 DOM + CSS Grid + 原生 event。
   - 若未来需要"游戏感"动画 / 粒子 / 战斗特效，可按需叠加一层 Phaser canvas
     作为**特效叠加层**，但 UI 文字 / 表格 / 按钮始终由 HTML 渲染（双方各取所长）。
   - React/Next 仅用于管理后台与官网配置页。
2. **Colyseus 是正式房间层与状态同步层**，服务端权威结算。
3. **规则引擎必须独立为纯函数包**（`packages/engine`）。
4. **客户端只发送命令（Command），不发送结算结果**。
5. 任何卡牌 / ruleset / mod 数据都必须通过 JSON Schema + AJV 校验。
6. mod 只允许上传数据和资源，**禁止上传脚本（JS/TS/Lua/Python/SQL/可执行代码）**。

## MVP 范围硬约束

MVP 必做（摘要）：
- 1v1 房间码对战
- 三栏商店
- 预约位
- 日程槽
- 防备
- 压力
- 场馆 / 值守场馆
- 断线重连
- 回放记录

MVP 不做：
- 实时观战
- 排位
- 社交/好友
- 收藏与开包
- 复杂手机端适配（基础响应式 OK，复杂手势 / 拖拽不做）
- 复杂拖拽交互

## 工程实践硬约束

1. 第一轮参考资料：
   - create-colyseus-app
   - Colyseus 官方文档
   - MDN（HTML / CSS / Web API / DOM）
2. 禁止直接复制 AGPL/GPL 仓库核心代码，仅可借鉴结构思路。
3. 优先最小可运行实现，不做过度工程化。
4. 客户端依赖面尽量窄：当前仅 `colyseus.js` + `@dev-camcard/protocol`，
   不再引入 Phaser / 任何重 UI 框架。
