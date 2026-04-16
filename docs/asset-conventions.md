# 资源约定（Asset Conventions）

> 本文档描述卡牌美术资源的命名规则、目录结构、运行时映射方式，以及未来正式卡图的落位路径。

---

## 一、artKey 命名规则

每张卡牌在 v2 规则数据（`data/cards/rules/*.json`）中都有一个 `artKey` 字段，表示对应美术资源的键名。

### 默认规则

**`artKey` 默认与 `card id` 完全一致。**

示例：
```json
{
  "id": "blue_draft_simulation",
  "artKey": "blue_draft_simulation",
  ...
}
```

### 例外情形

如果同一张牌存在多个美术版本（如特别版、节日版），可以在 `artKey` 中设置不同的值：

```json
{
  "id": "blue_draft_simulation",
  "artKey": "blue_draft_simulation_foil",
  ...
}
```

此时 `id` 不变（保持游戏规则稳定性），`artKey` 指向不同的美术资源。

---

## 二、资源目录约定

### 运行时资源目录（客户端）

```
apps/game-client/public/
└── cards/
    ├── blue_draft_simulation.png     （正式卡图）
    ├── blue_draft_simulation.webp    （优化格式，可选）
    ├── placeholder.png               （占位图，所有未落位卡牌使用此图）
    └── ...
```

- 文件名 = `artKey` + 扩展名（优先 `.webp`，回退 `.png`）
- 占位图文件名固定为 `placeholder.png`

### 资源加载逻辑（当前 MVP 方案）

客户端根据 `artKey` 尝试加载对应图片：
1. 尝试 `/cards/<artKey>.webp`
2. 如不存在，尝试 `/cards/<artKey>.png`
3. 如仍不存在，回退到 `/cards/placeholder.png`

---

## 三、当前状态（MVP 阶段）

- 当前所有卡牌均**无正式卡图**，渲染层仅显示 `artKey`（即卡牌 id）文字。
- `RoomScene` 通过 `vm.getCardName(cardId)` 获取展示名称，美术资源功能留待正式开发阶段接入。

---

## 四、如何接入正式卡图

1. 将卡图文件放入 `apps/game-client/public/cards/` 目录。
2. 文件名必须与 `artKey` 对应（如 `blue_draft_simulation.png`）。
3. 在 Phaser 场景中通过 `this.load.image(artKey, `/cards/${artKey}.png`)` 预加载。
4. 渲染卡牌时使用 `this.add.image(x, y, artKey)` 替代当前的文字按钮。
5. 如需区分正式卡图版本，修改对应卡牌数据的 `artKey` 字段（不修改 `id`）。

---

## 五、artKey 与 card id 稳定性保证

| 字段 | 能否修改 | 说明 |
|------|---------|------|
| `id` | **不可修改** | 规则稳定性约束，回放/存档依赖此值 |
| `artKey` | **可以修改** | 仅影响美术资源，不影响规则结算 |

---

## 六、schema 校验

`artKey` 字段在 `packages/schemas/schemas/card-rule.schema.json` 中定义为可选 string：
```json
"artKey": { "type": "string" }
```

所有卡牌规则数据通过 AJV 校验（`packages/schemas/src/__tests__/content-system.test.ts`）。
