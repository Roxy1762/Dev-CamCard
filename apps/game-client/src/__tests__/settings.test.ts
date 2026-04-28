/**
 * settings.test.ts — 客户端设置存储最小验证。
 *
 * 覆盖：
 *  1. 默认值（showShopPreview = true）
 *  2. updateSettings 后 getSettings 反映变化
 *  3. subscribeSettings 在变化时回调
 *  4. localStorage 异常时降级到默认值
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSettings,
  updateSettings,
  subscribeSettings,
  _resetSettingsCacheForTesting,
} from "../settings/clientSettings";

beforeEach(() => {
  // 每个 case 都重置 localStorage + 内存缓存。
  if (typeof localStorage !== "undefined") localStorage.clear();
  _resetSettingsCacheForTesting();
});

describe("clientSettings", () => {
  it("默认开启商店预览", () => {
    const s = getSettings();
    expect(s.showShopPreview).toBe(true);
  });

  it("updateSettings 持久化并即时生效", () => {
    const next = updateSettings({ showShopPreview: false });
    expect(next.showShopPreview).toBe(false);
    expect(getSettings().showShopPreview).toBe(false);
  });

  it("订阅者在 update 时收到回调", () => {
    const fn = vi.fn();
    const off = subscribeSettings(fn);
    updateSettings({ showShopPreview: false });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].showShopPreview).toBe(false);
    off();

    // 取消订阅后不再回调
    updateSettings({ showShopPreview: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("localStorage 损坏的 JSON 不会污染设置", () => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("devCamCard_settings_v1", "{not_json");
    _resetSettingsCacheForTesting();
    expect(getSettings().showShopPreview).toBe(true);
  });
});
