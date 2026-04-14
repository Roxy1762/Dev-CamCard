# 不可变更硬约束（Non-Negotiables）

> 本文件用于约束 Claude Code，避免首轮开发跑偏。

## 架构硬约束

1. **Phaser 是正式对战牌桌前端**，React/Next 仅用于管理后台与官网配置页。
2. **Colyseus 是正式房间层与状态同步层**，服务端权威结算。
3. **规则引擎必须独立为纯函数包（packages/engine）**。
4. 客户端只发送命令（Command），不发送结算结果。
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
- 复杂手机端适配
- 复杂拖拽交互

## 工程实践硬约束

1. 第一轮仅参考：
   - create-colyseus-app
   - tutorial-phaser
   - Colyseus 官方文档
   - Phaser 官方文档
2. 禁止直接复制 AGPL/GPL 仓库核心代码，仅可借鉴结构思路。
3. 优先最小可运行实现，不做过度工程化。
