import type { CardInstance, InternalPlayerState } from "./types";

/**
 * Fisher-Yates shuffle — 纯函数，接受可注入的 random 以便测试。
 *
 * @param arr    原始数组（不会被修改）
 * @param random 随机数函数，默认 Math.random
 * @returns      新的打乱顺序数组
 */
export function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * 从牌堆抽 count 张到手牌。
 *
 * 规则（game-rules.md）：
 *  - 牌堆为空时，将弃牌堆重新洗牌并作为新牌堆
 *  - 弃牌堆也为空时停止抽牌
 *
 * @param player 当前玩家状态
 * @param count  抽牌数
 * @param random 随机数函数，默认 Math.random
 * @returns      更新后的玩家状态（纯函数）
 */
export function draw(
  player: InternalPlayerState,
  count: number,
  random: () => number = Math.random
): InternalPlayerState {
  let deck = [...player.deck];
  let discard = [...player.discard];
  const hand = [...player.hand];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break; // 无牌可抽
      deck = shuffle(discard, random);
      discard = [];
    }
    // 从牌堆顶（索引 0）抽一张
    hand.push(deck.shift() as CardInstance);
  }

  return { ...player, deck, hand, discard };
}
