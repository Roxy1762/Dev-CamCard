# 资源约定（Asset Conventions）

> 本文档描述卡牌资源的命名规则、目录结构与当前运行时接入方式（已与现有代码对齐）。

---

## 一、`artKey` 命名规则

每张卡牌在规则数据（`data/cards/rules/*.json`）中包含 `artKey`。

- 默认：`artKey === card id`
- 允许例外：同一卡牌多画风时可改 `artKey`，保持 `id` 不变

---

## 二、当前资源目录（客户端）

当前客户端资源目录为：

```
apps/game-client/public/assets/
├── cards/
│   ├── art/card-art-placeholder.svg
│   └── backs/card-back-placeholder.svg
└── ui/
    └── ui-placeholder.svg
```

> 注意：当前代码仍未把卡牌美术真正渲染到 RoomScene；实际牌面以文本按钮为主。

---

## 三、运行时状态（MVP）

- BootScene 仅预加载占位资源（`runtimeAssets.ts`）
- RoomScene 通过 `vm.getCardName(cardId)` 渲染文字
- 暂无正式卡图贴图流程（无 `this.add.image(artKey, ...)` 的牌面渲染闭环）

---

## 四、正式卡图接入建议（后续）

1. 将正式卡图放到 `apps/game-client/public/assets/cards/art/`
2. 以 `artKey` 命名，如 `blue_draft_simulation.png`
3. 在 `runtimeAssets` 或独立 preload 流程中批量预加载
4. RoomScene 改造为图文卡牌组件（按钮层 + 图片层）
5. 缺失图统一回退到 `card-art-placeholder.svg`

---

## 五、稳定性边界

| 字段 | 可否变更 | 说明 |
|---|---|---|
| `id` | ❌ 不可随意改 | 影响规则、回放、存档稳定性 |
| `artKey` | ✅ 可改 | 仅影响资源映射 |

---

## 六、Schema 约束

`artKey` 已在 `packages/schemas/schemas/card-rule.schema.json` 定义为可选字符串。
