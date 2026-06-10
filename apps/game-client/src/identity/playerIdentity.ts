/**
 * playerIdentity.ts — 客户端持久玩家身份（P3-1 持久账号最小实现）。
 *
 * 模型：
 *  - 首次访问生成一个 UUID 并写入 localStorage（与昵称、教程进度同级）。
 *  - 之后每次入座随 joinOptions 带上 userId；服务端 upsert User 并把
 *    userId 写到 MatchPlayer，使对局可归属到"我的战绩"。
 *  - 无认证：清空浏览器存储等于换了一个新身份（当前阶段可接受，
 *    known-issues 已记录；后续接 OAuth 时此模块只需换 id 来源）。
 *
 * 可测试性：storage 以接口注入，单测用内存实现即可，无需 DOM 环境。
 */

export const USER_ID_KEY = "devCamCard_userId";

/** 与服务端 normalizeUserId 同口径（8~64 位字母/数字/连字符）。 */
export const USER_ID_PATTERN = /^[0-9a-zA-Z-]{8,64}$/;

/** localStorage 的最小子集，便于注入内存实现做单测。 */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 生成一个新的玩家 ID（优先 crypto.randomUUID，老环境回退手写 v4）。 */
export function generateUserId(): string {
  const cryptoObj = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  // 回退实现：非加密强度，但仅用于无 crypto.randomUUID 的老环境。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function defaultStorage(): StringStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 读取或创建持久玩家 ID。
 *  - 已存在且合法 → 原样返回（身份稳定是战绩归属的前提）。
 *  - 缺失或被改坏 → 生成新 ID 并尽力持久化。
 *  - storage 不可用（隐私模式等）→ 返回会话级临时 ID，不抛错。
 */
export function getOrCreateUserId(storage: StringStorage | null = defaultStorage()): string {
  let existing: string | null = null;
  try {
    existing = storage?.getItem(USER_ID_KEY) ?? null;
  } catch {
    existing = null;
  }
  if (existing && USER_ID_PATTERN.test(existing)) {
    return existing;
  }

  const fresh = generateUserId();
  try {
    storage?.setItem(USER_ID_KEY, fresh);
  } catch {
    /* 持久化失败时退化为会话级身份 */
  }
  return fresh;
}
