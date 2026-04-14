import type { InternalPlayerState } from "./types";
import { draw } from "./deck";

// ── Effect 类型定义 ────────────────────────────────────────────────────────────

/**
 * CardEffect — 卡牌效果的 discriminated union。
 *
 * 本轮支持范围（docs/claude-first-round-3-tasks.md）：
 *   gainResource / gainAttack / gainBlock / heal / draw / drawThenDiscard
 */
export type CardEffect =
  | { op: "gainResource"; amount: number }
  | { op: "gainAttack"; amount: number }
  | { op: "gainBlock"; amount: number }
  | { op: "heal"; amount: number }
  | { op: "draw"; count: number }
  | { op: "drawThenDiscard"; count: number };

export interface CardAbility {
  /** 触发时机，当前只处理 onPlay */
  trigger: "onPlay";
  effects: CardEffect[];
}

/**
 * CardDef — 卡牌效果定义（从 data/cards/*.json 加载后注入引擎）。
 *
 * 只保留引擎需要的字段；完整卡面文案、费用等由 server 层管理。
 */
export interface CardDef {
  id: string;
  type: "action" | "venue";
  abilities: CardAbility[];
}

// ── Effect interpreter ────────────────────────────────────────────────────────

/**
 * applyEffects — 将一组效果依次应用到单个玩家（纯函数）。
 *
 * @param player  当前玩家状态
 * @param effects 待应用的效果列表
 * @param random  随机数函数（用于 draw 效果）
 * @param maxHp   生命值上限（用于 heal 封顶）
 * @returns       更新后的玩家状态
 */
export function applyEffects(
  player: InternalPlayerState,
  effects: CardEffect[],
  random: () => number = Math.random,
  maxHp = 32
): InternalPlayerState {
  let p = player;
  for (const effect of effects) {
    p = applySingleEffect(p, effect, random, maxHp);
  }
  return p;
}

function applySingleEffect(
  player: InternalPlayerState,
  effect: CardEffect,
  random: () => number,
  maxHp: number
): InternalPlayerState {
  switch (effect.op) {
    case "gainResource":
      return { ...player, resourcePool: player.resourcePool + effect.amount };

    case "gainAttack":
      return { ...player, attackPool: player.attackPool + effect.amount };

    case "gainBlock":
      return { ...player, block: player.block + effect.amount };

    case "heal":
      return { ...player, hp: Math.min(player.hp + effect.amount, maxHp) };

    case "draw":
      return draw(player, effect.count, random);

    case "drawThenDiscard": {
      // 先摸 count 张，再从手牌头部弃 count 张（最早入手的先弃）
      const afterDraw = draw(player, effect.count, random);
      const discardCount = Math.min(effect.count, afterDraw.hand.length);
      const toDiscard = afterDraw.hand.slice(0, discardCount);
      const remaining = afterDraw.hand.slice(discardCount);
      return {
        ...afterDraw,
        hand: remaining,
        discard: [...afterDraw.discard, ...toDiscard],
      };
    }

    default:
      // 未知 op — no-op，防御性处理
      return player;
  }
}
