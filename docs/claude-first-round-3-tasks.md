# Claude Code 首轮拆分任务（3 步）

> ⚠️ 归档说明：本文为首轮任务拆分历史文档，不代表当前进行中的任务状态。


## 任务 1：初始化仓库骨架（仅脚手架，不写业务规则）

当前任务：
- 建立 monorepo 基础目录与 workspace 配置
- 初始化 `apps/game-client`（Phaser + Vite + TS）
- 初始化 `apps/server`（Colyseus + Node + TS）
- 初始化 `apps/admin`（空壳可运行）

相关目录：
- `apps/*`
- 根目录 workspace 配置文件

验收标准：
- 三个 app 都能安装依赖并成功启动（最小页面/最小房间）
- game-client 浏览器可显示“已连接房间（mock）”
- 不引入规则引擎逻辑

不要做：
- 规则实现
- 卡牌数据
- Prisma 表
- 复杂 UI 动画

---

## 任务 2：协议与 Schema（仅类型与校验）

当前任务：
- 建 `packages/protocol`
- 建 `packages/schemas`
- 定义 Command/Event、CardDef/RulesetDef 基本类型
- 编写 JSON Schema，并用 AJV 校验 starter/fixed/status/core-market 数据文件

相关目录：
- `packages/protocol`
- `packages/schemas`
- `data/`（或 `packages/catalog/data`）

验收标准：
- `pnpm test` 或等效命令可跑通 schema 校验
- 非法 effect type 会被拒绝
- ID 与 `docs/card-catalog.md` 一致

不要做：
- Colyseus Room 逻辑耦合
- Phaser 交互开发
- AI/Bot

---

## 任务 3：最小规则引擎 + 接入 Room

当前任务：
- 建 `packages/engine`
- 实现最小 InternalMatchState
- 实现 draw / shuffle / endTurn / buy 最小流程
- 为以上流程写 Vitest
- 将 engine.reduce 接入 server Room

相关目录：
- `packages/engine`
- `apps/server`

验收标准：
- 两个客户端进入同房间可见共享状态
- 房间命令触发后状态由服务端变更
- 测试覆盖 draw/shuffle/endTurn/buy

不要做：
- 预约/日程/防备/压力的完整高级规则（放下一轮）
- 排位/社交/观战
