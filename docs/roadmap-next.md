# Roadmap Next（按优先级推进）

> 目标：先修规则正确性与可复现性，再做供给与平衡，最后扩玩法广度。

## P0：规则正确性与可复现性（最高优先）

### P0-1 日程槽合法性校验
- 明确“安排”合法卡牌与触发时机。
- 校准引擎校验、协议语义、客户端入口三者一致。
- 为异常路径补充错误信息与回归测试。

### P0-2 场馆真实耐久公开化
- 保证 `durability/maxDurability` 在 protocol / projection / client 全链一致。
- 排查所有场馆展示位，避免旧字段复用导致误显。

### P0-3 攻击场馆 UI 与 guard 场景完整性
- ✅ 已完成本轮主链修复：客户端已补足“攻击场馆”操作入口与 guard 提示。
- ✅ 引擎已覆盖“有 guard / 无 guard / guard 被摧毁后转火玩家（含同一条命令内）”关键流程。
- 下一步仅保留体验增强：补一个细粒度的多段攻击分配器，而非继续修主链 bug。

### P0-4 确定性 RNG / 可复现回放
- ✅ 引擎随机入口已统一注入（包括抽牌、洗牌、效果随机分支）。
- ✅ replay 所需初始 seed 与事件记录策略已有最小基础。
- ✅ 引擎已落地回放重建原语（`packages/engine/src/replay.ts`）：
  - `buildReplayInitialState` 与 `GameRoom.onCreate` 共用一条初始化路径，
    保证 live 与回放从同一字节起点出发。
  - `reconstructCommand` + `replayFromEvents` 能把 `MatchEvent` 流逐步推回
    `InternalMatchState` 序列，单步出错不打断流程。
- ✅ 回放模态已升级为"逐事件浏览器"（控制层）：
  - 步进按钮 `⏮ 起点 / ◀ 上一步 / ▶ 播放 / 下一步 ▶ / ⏭ 末尾`，自动播放支持 1x/2x/4x。
  - 当前 cursor 行高亮 + 已过事件淡化 + 进度条；点击任意行可直接跳转。
  - 控制层与 cursor 状态独立于事件渲染，后续把表格行替换为 `replayFromEvents`
    输出的 PublicMatchView 投影即可完成最终一步，不再需要动 UI 框架。
- 下一步（剩余工作）：把"事件表格行" 替换为 `replayFromEvents` 输出的逐帧 state →
  PublicMatchView / PrivatePlayerView 投影渲染（已知 cursor 后只需一次 reduce 链路）。

### P0-5 schema 收紧
- 收敛 effect union 与 schema 的一一对应关系。
- 禁止未定义字段进入运行时规则数据。
- 将关键字段缺失/歧义前置到内容加载阶段报错。

## P1：市场与平衡

### P1-1 市场供给从 singleton 向 rarity copies 过渡
- ✅ 已完成基础落地：市场构造按 rarity 复制供给（`common=5`、`uncommon=3`、`rare=2`）。
- ✅ rarity 已从“文案标签”升级为“供给结构输入”，并保持三栏与补位链路不变。
- 后续仅做小步校准：观察牌堆厚度与轮转速度，必要时微调初始展示/补位顺序（不做大改版）。

### P1-2 starter / fixed supplies / pressure 结构性重做
- ✅ 已完成第一轮：starter 调整为 5/3/2/2，fixed supplies 分工重构为经济/生存/牌质修复，pressure 默认改为进入弃牌堆。
- 下一步：基于对局数据继续微调 cost 与数值，观察中期购买密度与压力税感是否过强/过弱。

### P1-3 平衡验证与观测
- ✅ 对局指标聚合最小实现已落地：
  - 服务端：`/api/matches/:id/metrics` 由 `apps/server/src/matchMetrics.ts` 纯函数
    聚合事件流，输出 `turns / durationMs / avgTurnMs` 与每位玩家的命令分布
    （出牌 / 安排 / 三类购买 / 激活场馆 / 攻击次数 / 总攻击量 / 打玩家 vs 场馆）。
  - 客户端：admin → 选中对局后展示 `MatchMetricsPanel`（4 KPI + 双侧对照表）。
  - 测试：`apps/server/src/__tests__/matchMetrics.test.ts` 覆盖空流 / 命令分桶 /
    攻击聚合 / 时长口径 / bigint ts 兼容 / 玩家名兜底。
- 下一步：在引擎层 emit 更细粒度事件（如 `VENUE_DESTROYED` / 实际命中量），把
  "ASSIGN_ATTACK 总额" 升级为 "实际伤害 vs guard 拦截量" 的桶。

## P2：玩法特色扩充

### P2-1 小包机制牌（主轴化）
- 以“安排 / 预约 / 场馆 / 压力”做一包机制牌，强化体系联动。
- 每个机制至少 2~3 张关键牌，形成可识别构筑方向。
- ✅ 本轮进展（首批 12 张）：
  - 条件锚点 `hasScheduledCard / hasReservedCard / hasVenue` 已在引擎实战链路验证。
  - `setFlag(nextBoughtCardToDeckTop)` 已贯通到预约购买（不再只覆盖公开购买/固定补给）。
  - `gainFaceUpCard` 在“条件触发 → pending choice → 选牌入区”路径可用。
- 下一步：
  - 继续补 2~4 张“压力税感”与“场馆压制”牌，提升构筑分化。
  - 客户端补更强提示（当前哪些条件已满足），降低机制牌理解门槛。

### P2-2 客户端体验增强
- ✅ 回放模态已落地"逐事件浏览器"控制层（详见 P0-4）。
- 攻击、选择、日志与提示信息做统一可视反馈（CSS 动画 + 状态高亮）。
- ✅ 手牌悬浮预览（hover 显示卡牌完整文案）—— 帮助玩家在打出前看清效果。
- ✅ 机制条件状态条 —— 在手牌区上方实时显示"已安排 / 已预约 / 有场馆 / 有值守"
  四个布尔条件，让带 condition 触发的牌不再需要靠记忆判断。
- ✅ 条件状态条 ↔ 卡牌悬浮联动：玩家 hover 一张带 condition 触发的手牌时，状态条
  对应的 chip 蓝色高亮（已满足）/ 红色高亮（未满足），不必再去对照文字推断
  "现在打出会不会触发"。卡牌 → 条件的索引由 `apps/game-client/src/content/cardConditions.ts`
  在构建期从 `data/cards/rules/*.json` 抽取。

### P2-2-future 特效叠加层（暂未排期）
- HTML 主层 + Phaser canvas 特效叠加层混合架构。
- 仅在 MVP 主链稳定且产品决策需要"游戏感"时启动；现阶段不为此提前投入。
- 方案备忘：[`docs/future-effects-layer.md`](./future-effects-layer.md)。

### P2-3 后台与运营支持
- admin 补齐对局历史、事件检索、异常回放入口。
- 为平衡与故障定位提供可用观察面板。

## 执行约束

- 当前阶段不建议立刻上复杂新机制。
- 每完成一项，必须同步更新：
  1. `docs/current-capabilities.md`
  2. `docs/known-issues.md`
  3. 对应实现与测试
