/**
 * rng.ts — 引擎统一的可重放 PRNG 模块（纯函数）。
 *
 * 目标：
 *  - 所有影响状态演化的随机逻辑（shuffle / draw / reshuffle / createMarketState 等）
 *    都必须通过此模块生成，不再直接依赖 Math.random。
 *  - 同 seed + 同命令流 -> 同结果（为可复现回放打下基础）。
 *
 * 算法：Mulberry32（32-bit PRNG，状态小、均匀性对测试/洗牌足够）。
 * 不适用于密码学用途。
 */

/**
 * SeededRng — 可序列化的 seeded 随机数发生器。
 *
 * next()  返回 [0, 1) 之间的 number，调用后内部 state 推进。
 * state() 返回当前 32-bit 状态（用于持久化 / 回放起点）。
 */
export interface SeededRng {
  next(): number;
  state(): number;
}

/**
 * 以给定 32-bit 无符号种子构造 Mulberry32 RNG。
 * seed 会被按位转换为 uint32，支持任意 number 输入（会丢掉小数）。
 */
export function createSeededRng(seed: number): SeededRng {
  let s = (seed | 0) >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state(): number {
      return s >>> 0;
    },
  };
}

/**
 * 将字符串哈希为 32-bit seed（xmur3 风格）。
 * 用于把人类可读的房间 ID / 场次标识稳定映射为 seed。
 */
export function hashStringToSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // 再做一次 avalanche，避免短字符串的种子过于集中
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * createSeededIdFactory — 稳定、可重放的实例 ID 生成器。
 *
 * 返回的 factory 会按固定前缀递增生成字符串 ID，调用顺序一致即结果一致。
 * 与 crypto.randomUUID 不同，它是可复现的。
 *
 * @param prefix  前缀（通常传入 roomId/matchId，保持跨房间唯一）
 * @param startCounter 起始计数，默认 0
 */
export function createSeededIdFactory(
  prefix: string,
  startCounter = 0
): { genId: () => string; counter: () => number } {
  let counter = startCounter;
  return {
    genId: () => `${prefix}-${++counter}`,
    counter: () => counter,
  };
}
