/**
 * clientSettings.ts
 *
 * 客户端可玩性设置最小存储层。
 *
 * 设计原则：
 *  - localStorage 持久化，缺失键安全降级到默认值
 *  - 单个 settings 对象一次读写，避免多键散乱
 *  - listeners 订阅模型 —— UI 更新设置后无须自行触发重绘
 *  - 任何 storage 异常（隐私模式 / 配额）均吞掉，仅在内存中维护
 */

const STORAGE_KEY = "devCamCard_settings_v1";

export interface ClientSettings {
  /** 是否在商店区显示卡牌预览（body 文案）。默认开启。 */
  showShopPreview: boolean;
}

const DEFAULTS: ClientSettings = {
  showShopPreview: true,
};

let cached: ClientSettings | null = null;
const listeners = new Set<(s: ClientSettings) => void>();

function readFromStorage(): ClientSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ClientSettings>;
    return {
      showShopPreview:
        typeof parsed.showShopPreview === "boolean"
          ? parsed.showShopPreview
          : DEFAULTS.showShopPreview,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeToStorage(s: ClientSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore — 隐私模式 / 配额耗尽时不影响内存设置 */
  }
}

/** 读取当前设置（首次访问时从 localStorage 解析并缓存）。 */
export function getSettings(): ClientSettings {
  if (!cached) cached = readFromStorage();
  return { ...cached };
}

/**
 * 局部更新设置，写回 localStorage 并通知所有订阅者。
 */
export function updateSettings(patch: Partial<ClientSettings>): ClientSettings {
  const next = { ...getSettings(), ...patch };
  cached = next;
  writeToStorage(next);
  for (const fn of listeners) {
    try {
      fn({ ...next });
    } catch {
      /* listener 异常不影响其它订阅者 */
    }
  }
  return { ...next };
}

/**
 * 订阅设置变化。返回取消订阅函数。
 */
export function subscribeSettings(fn: (s: ClientSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 测试用：重置内存缓存（不会清空 localStorage）。 */
export function _resetSettingsCacheForTesting(): void {
  cached = null;
}
