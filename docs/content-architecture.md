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
│   ├── starter.json            # v1 flat 格式，server 仍在读取
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
```

### Client（需要本地化文案）

```typescript
import { loadMergedBatch } from "@dev-camcard/schemas";

const cards = loadMergedBatch(DATA_ROOT, [
  { rules: "data/cards/rules/starter.json", text: `data/cards/text/${locale}/starter.json` },
  // ...
]);
// cards: MergedCardDef[] — 含 name + text，供展示层使用
```

### Locale 安全降级

locale 文件缺失或对应 id 无文案时，`mergeCardDef` 自动降级：
- `name` → 卡牌 id
- `text.body` → 空字符串

不会抛出错误，引擎不受影响。

---

## 测试覆盖

| 测试文件 | 覆盖内容 |
|----------|----------|
| `packages/schemas/src/__tests__/validate.test.ts` | v1 card schema / ruleset schema / mod manifest |
| `packages/schemas/src/__tests__/content-system.test.ts` | v2 规则/文案/set/content-pack schema；content-loader；locale 降级；card id 稳定性 |
| `packages/engine/src/__tests__/schema.test.ts` | 旧 flat 格式数据文件结构断言 |
