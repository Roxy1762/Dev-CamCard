/**
 * roomBadge.test.ts — 房号气泡 / 剪贴板逻辑最小验证。
 *
 * 修复目标：上一版"复制房号"按钮挂在 #lobby 上，进 Phaser 后 lobby 被 hidden，
 * 导致按钮看不见。修复方案是把房号气泡挂到 body 上的 fixed 浮层 + 复用同一个
 * 剪贴板回退实现（roomBadge.ts → copyTextToClipboard）。
 *
 * 此测试覆盖剪贴板回退逻辑（不依赖 DOM 环境），DOM 渲染由 e2e 验证。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyTextToClipboard } from "../lobby/roomBadge";

afterEach(() => {
  // 清理可能注入的 navigator.clipboard mock
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  } catch {
    /* ignore */
  }
});

describe("copyTextToClipboard", () => {
  it("空字符串直接返回 false（不调用 clipboard API）", async () => {
    const writeText = vi.fn();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const ok = await copyTextToClipboard("");
    expect(ok).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Clipboard API 可用时走 writeText 路径并返回 true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const ok = await copyTextToClipboard("ROOM77");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ROOM77");
  });

  it("Clipboard API 抛异常时不向上冒泡（回退路径会接住）", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("权限拒绝"));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    // 没有 document 环境时回退路径返回 false，但不应抛错
    await expect(copyTextToClipboard("X")).resolves.toBeTypeOf("boolean");
  });
});
