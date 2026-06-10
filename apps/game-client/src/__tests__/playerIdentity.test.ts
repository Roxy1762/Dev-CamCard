/**
 * playerIdentity.test.ts — 持久玩家身份（P3-1）。
 *
 * 覆盖：首访生成并持久化、复访身份稳定、坏值自愈、storage 不可用时的降级、
 * 以及 lobby joinOptions 的组装口径。
 */
import { describe, it, expect } from "vitest";
import {
  getOrCreateUserId,
  generateUserId,
  USER_ID_KEY,
  USER_ID_PATTERN,
  type StringStorage,
} from "../identity/playerIdentity";
import { buildJoinOptions } from "../lobby/lobby";

function memoryStorage(initial: Record<string, string> = {}): StringStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("generateUserId", () => {
  it("生成符合服务端校验口径的 ID", () => {
    const id = generateUserId();
    expect(USER_ID_PATTERN.test(id)).toBe(true);
  });
});

describe("getOrCreateUserId", () => {
  it("首次访问生成并持久化", () => {
    const storage = memoryStorage();
    const id = getOrCreateUserId(storage);
    expect(USER_ID_PATTERN.test(id)).toBe(true);
    expect(storage.data.get(USER_ID_KEY)).toBe(id);
  });

  it("复访返回同一身份（战绩归属稳定）", () => {
    const storage = memoryStorage();
    const first = getOrCreateUserId(storage);
    const second = getOrCreateUserId(storage);
    expect(second).toBe(first);
  });

  it("存储值被改坏时重新生成", () => {
    const storage = memoryStorage({ [USER_ID_KEY]: "<script>bad</script>" });
    const id = getOrCreateUserId(storage);
    expect(USER_ID_PATTERN.test(id)).toBe(true);
    expect(id).not.toBe("<script>bad</script>");
    expect(storage.data.get(USER_ID_KEY)).toBe(id);
  });

  it("storage 抛错时降级为会话级身份而不抛出", () => {
    const throwing: StringStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const id = getOrCreateUserId(throwing);
    expect(USER_ID_PATTERN.test(id)).toBe(true);
  });

  it("storage 为 null（隐私模式）时仍返回可用身份", () => {
    const id = getOrCreateUserId(null);
    expect(USER_ID_PATTERN.test(id)).toBe(true);
  });
});

describe("buildJoinOptions", () => {
  it("昵称存在时同时携带 playerName 与 userId", () => {
    expect(buildJoinOptions("天天", "uid-12345678")).toEqual({
      playerName: "天天",
      userId: "uid-12345678",
    });
  });

  it("昵称缺省时仅携带 userId（server 端兜底默认名）", () => {
    expect(buildJoinOptions(null, "uid-12345678")).toEqual({ userId: "uid-12345678" });
  });
});
