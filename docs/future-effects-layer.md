# 未来特效叠加层方案备忘（Effects Layer Plan）

> **状态**：未实现，未排期。本文件仅作为意图记录，避免日后再次为
> "用什么做卡牌动画 / 粒子 / 战斗特效" 反复讨论。
>
> **触发条件**：当 MVP 主链稳定（P0 / P1 全绿）且产品决策需要加强战斗的"游戏感"
> 时再启动；现阶段不要为这个目标提前投入。

## 背景

PR #41 把客户端从 Phaser canvas 切到 HTML/CSS，根治了文字糊化 / 布局重叠 /
房号双显 / 点击不可达等系列 bug，详见 `technical-decisions.md`
"客户端渲染方案（决策记录）"小节。

但 HTML/CSS 在以下场景仍有先天短板：
- 大量同时运动的小元素（粒子、伤害飘字、爆炸碎片）
- WebGL 着色器特效（暗角、屏幕震动、变色）
- 物理感受很强的 tween（卡牌弹簧、缓动曲线长动画）

如果未来要做这种"游戏感"层级的视觉表现，**不要回到"用 canvas 渲染所有 UI 文字"
的老路**，而是按下面的混合架构落地。

## 目标架构：HTML 主层 + Phaser canvas 特效叠加层

```
┌────────────────────────────────────────────────────────┐
│ #game-view (HTML，z-index: 1)                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ header / 玩家面板 / 商店 / 手牌 / 操作栏 / 模态     │ │
│ │ 由 htmlGameView.ts 渲染                             │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
│ #effects-overlay (canvas，z-index: 10                   │
│   pointer-events: none，position: fixed inset: 0)       │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Phaser canvas，仅渲染粒子 / tween / sprite          │ │
│ │ 不接收点击；不渲染任何文字                           │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

关键约束：

1. `#effects-overlay` 必须 `pointer-events: none` —— 不能拦截 HTML 的点击
2. 特效层**不渲染游戏 UI**（文字 / 按钮 / 表格）。所有 UI 始终归 HTML 层
3. 特效层**按需 lazy-load**（`import()`），不进入主 bundle，保持首屏 ~120KB
4. 特效层与 HTML 层的连接点是"事件触发器"，不是状态订阅 —— 见下节

## 事件触发器（HTML → 特效层）

特效层不订阅 RoomClient 的 state/private/eventLog，而是由 `htmlGameView` 在
处理事件时**显式触发**特效。这样保证：
- 特效模块对游戏状态结构无依赖（state schema 演化时不需要同步改）
- 单测易写：直接调 `effects.playCardImpact(rect)` 即可

最小 API 草图：
```typescript
// apps/game-client/src/effects/effectsLayer.ts (未来)
export interface EffectsLayer {
  /** lazy-load Phaser，挂载到 #effects-overlay */
  init(): Promise<void>;

  /** 在指定 HTML 元素中心放一个粒子爆炸（购买 / 打出反馈） */
  pulseAt(el: HTMLElement, color?: string): void;

  /** 从源元素飞向目标元素的 tween（攻击伤害飘字） */
  flyDamage(from: HTMLElement, to: HTMLElement, amount: number): void;

  /** 摧毁目标元素的爆炸（场馆被打掉） */
  shatter(el: HTMLElement): void;

  /** 全屏震动 / 闪光（致命伤害） */
  screenShake(intensityMs: number): void;
}
```

`htmlGameView` 在合适事件处调用：
```typescript
// 接到 ATTACK_ASSIGNED 事件后
this.effects?.flyDamage(myAvatarEl, oppAvatarEl, evt.data.amount);
```

如果 `this.effects` 未加载（用户没开特效或还在加载中），HTML 层正常运行，
不报错。**渐进增强**：HTML 是基础，特效是锦上添花。

## HTML → canvas 坐标映射

特效层需要把 HTML 元素的位置映射到 Phaser canvas 坐标。要点：

```typescript
function elCenterToCanvas(el: HTMLElement, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const cRect = canvas.getBoundingClientRect();
  // canvas 是 fixed inset: 0 → cRect.left/top 为 0，下面减法可省，但保留通用
  return {
    x: rect.left + rect.width / 2 - cRect.left,
    y: rect.top + rect.height / 2 - cRect.top,
  };
}
```

注意点：
- `getBoundingClientRect()` 受 CSS transform 影响，HTML 层应避免用 `transform: translate` 做布局变更
- canvas 自身要能跟随 viewport resize，可监听 `window.resize` 调 `phaser.scale.resize`
- 高 DPR 屏：canvas 内部分辨率乘以 `devicePixelRatio`，CSS 尺寸保持视口大小

## Phaser 初始化最小骨架（未来需要时复制即可）

```typescript
// 仅渲染特效，不要 Scene.FIT，不要 camera.zoom = dpr，不要文字渲染
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "effects-overlay",
  transparent: true, // 关键：让 HTML 层可见
  scale: {
    mode: Phaser.Scale.RESIZE, // 跟随容器尺寸
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [EffectsScene],
});
```

`EffectsScene` 内部用 `this.add.particles()` / `this.tweens.add()` 即可，
**不要**再去渲染任何 `add.text` / `add.graphics` 矩形。

## 已删除的旧 Phaser 场景代码

为避免本备忘被误读为"恢复旧代码"指南：旧的 `BootScene / RoomScene /
ReplayScene / uiKit.ts` 渲染的是 UI（文字 + 按钮 + 表格），与本备忘描述
的"特效层"在职责上**完全不重合**，可参考价值约等于零。

如果好奇当年是怎么写的，可以从 git 历史取出（仅供考古）：
```bash
git show c74abf0:apps/game-client/src/scenes/RoomScene.ts
git show c74abf0:apps/game-client/src/scenes/uiKit.ts
```

但实现特效层时**不要**从这些文件复制代码 —— 那只会把 UI 渲染逻辑误带进特效层。
按本备忘从空白开始写一个新的 `effectsLayer.ts` 即可。

## 验收清单（实施时检查）

未来真要做时，新 PR 应该满足：

- [ ] `pointer-events: none` 经手测验证不拦截 HTML 点击
- [ ] 特效模块按 `import("./effects/effectsLayer")` lazy 加载，主 bundle 体积保持 < 130KB
- [ ] 用户可在设置面板关掉特效（默认开），关闭时根本不加载 Phaser
- [ ] HTML 层在 `effects` 未加载 / 加载失败时**仍可玩**（没有 try/catch 围着每次调用）
- [ ] 至少一组手机端真机测试：低端 Android + iOS Safari 都不掉帧到不可玩
- [ ] 特效模块**不**订阅 RoomClient 任何回调，纯被动接收来自 htmlGameView 的方法调用

## 参考资料

- Phaser 3 官方文档：particles / tweens / scale modes
- MDN：`getBoundingClientRect`、`pointer-events`
- Vite 动态 import：https://vitejs.dev/guide/features.html#dynamic-import
