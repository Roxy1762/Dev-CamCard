# 内容系统架构（Content Architecture）

> 本文档描述数据层从"原型 flat JSON"升级为"可长期扩展内容系统"后的结构与约定。

---

## 为什么分层：规则数据与显示文案分离

**原型阶段**的卡牌 JSON 把所有字段混在一起：
```json
{
  "id": "starter_allowance",
  "name": "零花钱",
  "cost": 0,
  "abilities": [...],
  "text": { "body": "获得 2 资源。" }
}
```

这种格式的问题：
- `name` 和 `text.body` 是**显示文案**，随语言变化
- `cost`、`abilities` 是**规则真源**，不随语言变化
- 混在一起导致：无法多语言、无法回放稳定性、无法 mod 覆盖文案

**新分层设计**：
- **规则真源**（`data/cards/rules/*.json`）：引擎读取，不含任何本地化文案
- **本地化文案**（`data/cards/text/<locale>/*.json`）：客户端按 locale 加载
- **engine 永远不依赖本地化文案**，只依赖规则真源

---

## 目录结构

```
data/
├── cards/
│   ├── rules/                  # v2 规则真源（CardRule）
│   │   ├── starter.json
│   │   ├── fixed-supplies.json
│   │   ├── status.json
│   │   └── market-core.json
│   ├── text/
│   │   ├── zh-CN/              # 中文文案
│   │   │   ├── starter.json
│   │   │   ├── fixed-supplies.json
│   │   │   ├── status.json
│   │   │   └── market-core.json
│   │   └── en-US/              # 英文文案（当前为最小占位）
│   │       ├── starter.json
│   │       ├── fixed-supplies.json
│   │       ├── status.json
│   │       └── market-core.json
│   │
│   # ── 旧格式（legacy，保持兼容） ──
│   ├── starter.json            # v1 flat 格式（历史兼容数据，不作为 server 默认读取源）
│   ├── fixed-supplies.json
│   ├── status.json
│   └── market-core.json
│
├── sets/
│   └── core-v1.json            # 卡牌集合清单
│
├── content-packs/
│   └── base.json               # 内容包清单（sets + rulesets 组合）
│
└── rulesets/
    └── core-v1.json            # 规则集（生命值/手牌上限/起始套牌等）
```

---

## 版本字段说明

### CardRule（v2 规则数据）

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | integer ≥ 2 | schema 格式版本，v2 分层格式固定为 2 |
| `contentVersion` | integer ≥ 1 | 内容版本，每次改动 cost/abilities 等规则字段时递增 |
| `artKey` | string | 美术资源键名；当前约定所有卡牌显式填写，默认与 `id` 一致（如有独立美术映射再单独改值） |

### CardTextFile（本地化文案）

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | integer | 文案 schema 版本 |
| `locale` | string | BCP-47 locale，如 `zh-CN`、`en-US` |

### SetManifest / ContentPackManifest

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | integer | schema 格式版本 |
| `contentVersion` | integer | 内容版本，新增/移除内容时递增 |

---

## Schema 体系

```
packages/schemas/schemas/
├── card.schema.json            # v1 legacy（保持兼容，已补全 isPressure/isGuard 等缺失字段）
├── card-rule.schema.json       # v2 规则真源 schema（不含 name/text）
├── card-text.schema.json       # 本地化文案 schema
├── set.schema.json             # 卡牌集合清单 schema
├── content-pack.schema.json    # 内容包清单 schema
├── ruleset.schema.json         # 规则集 schema（已有）
└── mod-manifest.schema.json    # Mod 清单 schema（已有）
```

所有数据文件必须通过 AJV 校验（non-negotiables.md 约束）。`packages/schemas/src/validators.ts` 中暴露对应的 `checkXxx` / `assertXxx` 函数。

### Effect schema 收口（2026-04）

`card-rule.schema.json` 中的 `Effect` 已从松散格式（仅约束 `op`、其余 `additionalProperties: true`）改为按 op 的 `oneOf` 分支，每支都 `additionalProperties: false`。约束要点：

- 每个 op（如 `gainResource` / `draw` / `scry` / `createPressure` / `queueDelayedDiscard` / `trashFromHandOrDiscard` / `gainFaceUpCard` / `setFlag` / `chooseTarget` 等）只接受其自身声明的字段，多余字段直接被拒。
- `drawThenDiscard` 统一为 `drawCount + discardCount`（旧 `count` 已废弃；engine 与 data 同步更新）。
- `chooseTarget.onChosen` 只接受 `TargetedEffect`（当前为 `damageVenue` / `dealDamage`），不允许放置 `gainResource` 等自身效果。
- `Ability.condition` 收口为 `{ type: ... }` 对象格式，和引擎 `CardCondition` 对齐（枚举：`firstActionThisTurn` / `actionsPlayedAtLeast` / `hasVenue` / `hasScheduledCard` / `hasReservedCard`）。

目标：避免内容侧新增未被引擎正确消费的 effect 字段，阻断数据漂移。所有现网规则数据已在收紧后的 schema 下通过校验。

---

## 如何加新语言

1. 在 `data/cards/text/<new-locale>/` 下创建同名文案文件
2. 每个文件格式遵循 `card-text.schema.json`：
   ```json
   {
     "schemaVersion": 1,
     "locale": "ja-JP",
     "cards": {
       "starter_allowance": { "name": "お小遣い", "body": "リソース 2 を得る。" }
     }
   }
   ```
3. `loadCardTextFile(DATA_ROOT, "data/cards/text/ja-JP/starter.json")` 即可加载
4. locale 文件可**不完整**：缺失条目时 `mergeCardDef` / `getCardText` 自动降级（name → id，body → ""）
5. engine 代码无需任何改动

---

## 如何加新卡包

1. 在 `data/cards/rules/` 下创建新规则文件（遵循 `card-rule.schema.json`）
2. 在 `data/cards/text/zh-CN/`（和其他 locale）下创建对应文案文件
3. 在 `data/sets/` 下创建新的 set 清单，列出所有新增卡牌 ID
4. 如需打包发布，在 `data/content-packs/` 下创建新内容包清单引用该 set
5. 在 `docs/card-catalog.md` 中冻结新卡 ID（不可在发布后修改）

---

## 旧数据兼容策略

当前 `data/cards/*.json`（v1 flat 格式）**保持原位不删除**：

- `apps/server/src/rooms/GameRoom.ts` 继续从 `data/cards/*.json` 加载（旧 flat 格式）
- 旧格式通过修正后的 `card.schema.json` 校验
- 新格式（v2）在 `data/cards/rules/` 和 `data/cards/text/` 中维护

**未来迁移路径**（推荐，当有条件时执行）：
1. 将 `GameRoom.ts` 改为从 `data/cards/rules/*.json` 加载，并通过 `content-loader.ts` 提供 `CardDef`
2. 客户端按 locale 加载 `data/cards/text/<locale>/*.json`
3. 迁移完成后可归档旧 `data/cards/*.json` 文件

---

## 运行时加载模式

### Server / Engine（不需要本地化）

```typescript
import { loadRuleBatch } from "@dev-camcard/schemas";

const rules = loadRuleBatch(DATA_ROOT, [
  "data/cards/rules/starter.json",
  "data/cards/rules/fixed-supplies.json",
  "data/cards/rules/market-core.json",
  "data/cards/rules/status.json",
]);
// rules: CardRuleData[] — 不含 name/text，engine 直接消费
// 每条 CardRule 均经过 AJV assertCardRule 校验；失败时立即抛出含路径信息的报错
```

**AJV 校验覆盖（server 加载时）：**

| 加载函数 | 使用的 assert | 校验目标 |
|---------|-------------|---------|
| `loadCardRuleFile` | `assertCardRule` (逐条) | v2 卡牌规则 |
| `loadCardTextFile` | `assertCardText` | 本地化文案文件 |
| `loadSetManifest` | `assertSetManifest` | 集合清单 |
| `loadContentPackManifest` | `assertContentPack` | 内容包清单 |
| `GameRoom.ts` (直接) | `assertRulesetDef` | 规则集 |

校验失败时抛出格式为：`[文件路径][条目索引] 具体错误` 的清晰报错，不静默吞掉。

### Client（需要本地化文案，浏览器端）

```typescript
// apps/game-client/src/content/clientLocale.ts
import { buildCardNames } from "../content/clientLocale";

// BootScene.create() 中调用（同步，Vite 构建时已打包文案）
const cardNames = buildCardNames("zh-CN"); // Map<cardId, "中文名称">

// 传入 RoomScene，再传给 buildBoardViewModel
const vm = buildBoardViewModel(pub, priv, cardNames);
vm.getCardName("starter_allowance"); // → "零花钱"
```

客户端不依赖 Node.js `fs`；`clientLocale.ts` 静态导入 JSON，Vite 构建时打包进 bundle。

### Locale 安全降级

- **server 侧**（content-loader）：locale 文件缺失时 `loadCardTextFile` 返回 null；`mergeCardDef` 自动将 name 降级为 id，body 降级为 ""。
- **client 侧**（clientLocale）：缺失 cardId 时 `buildCardNames` 的 Map 不含该 key；`getCardName(cardId)` 降级返回 cardId 自身。

均不抛出错误，引擎不受影响。

---

## 测试覆盖

| 测试文件 | 覆盖内容 |
|----------|----------|
| `packages/schemas/src/__tests__/validate.test.ts` | v1 card schema / ruleset schema / mod manifest |
| `packages/schemas/src/__tests__/content-system.test.ts` | v2 规则/文案/set/content-pack schema；content-loader；locale 降级；card id 稳定性 |
| `packages/engine/src/__tests__/schema.test.ts` | 旧 flat 格式数据文件结构断言 |
