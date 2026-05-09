# 客户端 ViewModel 层（Client ViewModel）

> 本文档描述客户端渲染层的 ViewModel 设计，解释为什么需要此层，以及如何使用。

---

## 一、为什么需要 ViewModel 层

### 原型阶段的问题

在最初的 Phaser `RoomScene.ts` 实现中（已删除，现由 `HtmlGameView` 替代），
draw 方法直接散乱读取 `this.view`（PublicMatchView）和 `this.privateView`（PrivatePlayerView）：

```typescript
// 旧写法：直接读原始视图，衍生状态散落各处
const mySide = this.privateView.side;
const oppSide = mySide === 0 ? 1 : 0;
const isMyTurn = this.view.activePlayer === mySide && this.view.started;
const me = this.view.players[mySide];
```

这导致：
- 每个 draw 方法都重复推导 `mySide / oppSide / isMyTurn`
- 无法轻松注入本地化卡牌名称
- 渲染代码与数据结构高度耦合，难以测试
- 未来加载 cardNames / artKey 等展示数据时需要改动多个地方

### ViewModel 层的价值

引入 `BoardViewModel` 后：
- **集中推导衍生状态**：`mySide / oppSide / isMyTurn` 只在一处计算
- **统一 locale 注入**：`getCardName(cardId)` 自动处理本地化和降级
- **可独立测试**：`buildBoardViewModel` 是纯函数，不依赖任何渲染框架
- **单点扩展**：加新字段（如 artKey、tooltip）只改 ViewModel，渲染层无需感知

---

## 二、类型定义

```typescript
// apps/game-client/src/viewmodel/BoardViewModel.ts

export interface PlayerViewModel {
  side: 0 | 1;
  name: string;
  hp: number;
  block: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  resourcePool: number;
  attackPool: number;
  venues: PublicVenueView[];
  scheduleSlots: (PublicCardRef | null)[];
  reservedCard: PublicCardRef | null;
  hasReservedThisTurn: boolean;
  pendingDiscardCount: number;
  isActive: boolean;    // 是否是当前行动方
}

export interface BoardViewModel {
  roomId: string;
  turnNumber: number;
  started: boolean;
  ended: boolean;
  winner: 0 | 1 | null;

  mySide: 0 | 1;        // 当前玩家席位
  oppSide: 0 | 1;       // 对手席位
  isMyTurn: boolean;    // started && !ended && activePlayer === mySide

  me: PlayerViewModel;  // 己方视图
  opp: PlayerViewModel; // 对方视图

  hand: PublicCardRef[];          // 己方手牌（私有）
  discard: PublicCardRef[];       // 己方弃牌堆（私有）
  pendingChoice: PendingChoiceView | null;

  pendingChoiceSide: 0 | 1 | null;
  market: MarketLane[];
  fixedSupplies: string[];

  getCardName(cardId: string): string;  // 本地化名称，降级返回 cardId
}
```

---

## 三、构建函数

```typescript
export function buildBoardViewModel(
  pub: PublicMatchView,
  priv: PrivatePlayerView,
  cardNames?: ReadonlyMap<string, string>   // 可选：cardId → 本地化名称
): BoardViewModel
```

- `pub`：来自 server 广播的公开视图
- `priv`：来自 server 的私有视图（仅己方）
- `cardNames`：可选 locale 映射（由 content-loader 加载后注入）

---

## 四、HtmlGameView 使用方式

```typescript
// renderAll 调用时构建 vm，所有 render* 方法消费 vm
private renderAll(): void {
  if (!this.view || !this.privateView) return;
  const vm = buildBoardViewModel(
    this.view, this.privateView, this.cardNames, this.cardTexts
  );
  this.renderHeader(vm);
  this.renderPlayer(this.dom.opp, vm.opp, vm, false);
  this.renderPlayer(this.dom.me, vm.me, vm, true);
  this.renderMarket(vm);
  this.renderFixedSupplies(vm);
  this.renderHand(vm);
  this.renderActionBar(vm);
  this.renderEvents();
  this.renderEndBanner(vm);
  this.renderChoice(vm);
}
```

render 方法只接收 `vm`，不直接访问原始 `view` / `privateView`。

---

## 五、本地化名称与文案注入（已实现）

`apps/game-client/src/main.ts` 在启动 `HtmlGameView` 前调用
`buildCardNames()` / `buildCardTexts()`（见 `content/clientLocale.ts`，
Vite 在构建期把 zh-CN / en-US JSON 静态打包），把两个 Map 注入到视图：

```typescript
const cardNames = buildCardNames(DEFAULT_LOCALE);
const cardTexts = buildCardTexts(DEFAULT_LOCALE);

activeView = new HtmlGameView({
  roomClient: conn.client,
  cardNames,
  cardTexts,
  mode: conn.mode,
});
```

`getCardName` 缺失映射时降级返回 `cardId`，永远不会抛错。
`getCardText` 缺失时返回 null，渲染层据此显示 `（暂无文案）${cardId}`。

---

## 六、测试覆盖

测试文件：`apps/game-client/src/__tests__/viewmodel.test.ts`（13 个测试）

| 测试 | 覆盖内容 |
|------|---------|
| mySide / oppSide 推导 | side=0 对方为1；side=1 对方为0 |
| isMyTurn 各分支 | 轮到自己 / 非自己 / 未开始 / 已结束 |
| hand / discard 透传 | 来自 PrivatePlayerView |
| pendingChoice 透传 | 非 null 时正确传入 |
| getCardName 无 catalog | 降级返回 cardId |
| getCardName 有 catalog | 返回本地化名称 |
| getCardName 缺失条目 | 降级返回 cardId |
| me / opp 字段投影 | hp/name 等正确分配 |

---

## 七、文件位置

| 文件 | 说明 |
|------|------|
| `apps/game-client/src/viewmodel/BoardViewModel.ts` | ViewModel 类型 + 构建函数 |
| `apps/game-client/src/game/htmlGameView.ts` | 消费 ViewModel 的 HTML 渲染层 |
| `apps/game-client/src/__tests__/viewmodel.test.ts` | 单元测试 |
