# 技术决策冻结清单（与当前代码对齐）

## 技术主链

- 客户端：**HTML/CSS + TypeScript + Vite**（`apps/game-client`）
- 联机房间：**Colyseus**（`apps/server/src/rooms/GameRoom.ts`）
- 后端 API：**Express（与 Colyseus 同进程）**（`apps/server/src/index.ts`）
- 规则引擎：**独立纯函数包**（`packages/engine`）
- 协议：`packages/protocol`（Command / Event / View Types）
- 数据定义与校验：**JSON Schema + AJV**（`packages/schemas`）
- 持久化：**PostgreSQL + Prisma 7 + @prisma/adapter-pg**（`apps/server/src/prisma.ts`）
- 测试：**Vitest**（engine/schemas/client/server 均已接入）
- 后台：**Next.js 14（admin 壳）**（`apps/admin`）

## 状态分层

- `InternalMatchState`（仅服务端）
- `PublicMatchView`（双方可见）
- `PrivatePlayerView`（单方私有）

禁止将 `InternalMatchState` 直接同步给客户端。

## 客户端渲染方案（决策记录）

### 当前选择：HTML/CSS

`apps/game-client/src/game/htmlGameView.ts` —— 用 DOM + CSS Grid 渲染整个对战
牌桌。订阅 RoomClient 推送，按 BoardViewModel 重绘对应分区，模态弹层管理
设置 / 选择 / 回放三类交互。

### 决策依据

| 维度 | HTML/CSS | Phaser canvas |
| --- | --- | --- |
| 文字清晰度 | 浏览器 subpixel hinting | DPR 适配反复出 bug |
| 布局可靠性 | CSS Grid 自动避让 | 手算 y 坐标，重叠多 |
| 点击可靠性 | 原生 button | zone + canvas 事件层 |
| 包体积 | ~116KB（gzip 34KB） | ~1.3MB |
| 可访问性 | 屏幕阅读器 / 浏览器翻译 | 几乎为零 |
| 动画 / 粒子 | CSS animations 够用 | 强（暂未需要）|
| Sprite 渲染 | DOM + img / svg | WebGL 批渲染（暂未需要）|

项目当前所有牌桌内容都是文字 / 表格 / 按钮，是 HTML 强项 / canvas 弱项；
roadmap 上接下来的客户端工作（回放播放器、机制提示、可视反馈、对局指标）
也都更适合 HTML。包体积差一个数量级，对移动端首屏体验是实质改善。

### 何时回归 canvas / WebGL

未来若真要做卡牌动画 / 粒子 / 战斗特效（脱离 MVP 后），按需叠加一层
**Phaser canvas 作为特效层**（lazy import，不进入主 bundle），
HTML 仍负责 UI 文字 / 表格 / 按钮 —— 双方各取所长，而不是回到"用 canvas
渲染所有文字"的旧路。

具体方案与验收清单见 [`docs/future-effects-layer.md`](./future-effects-layer.md)。

### 已删除的旧实现

- `apps/game-client/src/scenes/{BootScene,RoomScene,ReplayScene,uiKit}.ts`
- `apps/game-client/src/assets/runtimeAssets.ts`
- `apps/game-client/src/lobby/roomBadge.ts` 中的浮动气泡逻辑（房号现在由顶栏 `.room-pill` 一处展示）
- `package.json` 中的 `phaser` 依赖

## 许可证边界

- 可直接复用：MIT / Apache-2.0
- AGPL / GPL：仅借鉴架构，不可直接复制核心实现

## 交付策略（当前仍有效）

- monorepo（`apps/* + packages/*`）
- 阶段推进（架构 → 协议/schema → 引擎 → 房间 → 客户端）
- 每阶段输出：文件清单、运行命令、测试命令、风险、下一步
