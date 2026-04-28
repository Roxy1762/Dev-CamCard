/**
 * clientLocale.ts
 *
 * 浏览器端最小 locale 加载层。
 *
 * 设计原则：
 *  - 不依赖 Node.js fs 模块，Vite 在构建时将 JSON 文件打包进 bundle
 *  - 支持 zh-CN 和 en-US；默认 zh-CN
 *  - buildCardNames() 返回 cardId → 展示名称 的 Map
 *  - 缺失文案时安全降级：Map 中不存在该 cardId，外部降级为 cardId 自身
 *  - 代码结构支持后续新增 locale 而无需改动 ViewModel 层
 *
 * 扩展 locale 步骤：
 *  1. 在 data/cards/text/<new-locale>/ 下创建对应文案文件
 *  2. 在 TEXT_FILES 中添加对应 locale 的导入与映射
 *  3. 将新 locale 加入 SupportedLocale 联合类型
 */

// ── zh-CN 文案（静态导入，Vite 构建时打包）────────────────────────────────────
import zhCN_starter from "./text/zh-CN/starter.json";
import zhCN_fixed from "./text/zh-CN/fixed-supplies.json";
import zhCN_market from "./text/zh-CN/market-core.json";
import zhCN_status from "./text/zh-CN/status.json";

// ── en-US 文案（最小占位，覆盖后可替换）─────────────────────────────────────
import enUS_starter from "./text/en-US/starter.json";
import enUS_fixed from "./text/en-US/fixed-supplies.json";
import enUS_market from "./text/en-US/market-core.json";
import enUS_status from "./text/en-US/status.json";

// ── 类型定义（与 @dev-camcard/schemas 的 CardTextFile 对应，不引入 fs 依赖）──

interface LocaleTextEntry {
  name: string;
  body: string;
  reminder?: string | null;
}

interface LocaleTextFile {
  schemaVersion: number;
  locale: string;
  cards: Record<string, LocaleTextEntry>;
}

// ── Locale 配置 ───────────────────────────────────────────────────────────────

export type SupportedLocale = "zh-CN" | "en-US";

/** 当前默认 locale（将来可改为运行时读取用户偏好） */
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

/** 各 locale 对应的文案文件列表 */
const TEXT_FILES: Record<SupportedLocale, LocaleTextFile[]> = {
  "zh-CN": [
    zhCN_starter as LocaleTextFile,
    zhCN_fixed as LocaleTextFile,
    zhCN_market as LocaleTextFile,
    zhCN_status as LocaleTextFile,
  ],
  "en-US": [
    enUS_starter as LocaleTextFile,
    enUS_fixed as LocaleTextFile,
    enUS_market as LocaleTextFile,
    enUS_status as LocaleTextFile,
  ],
};

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 构建 cardId → 展示名称 的 Map。
 *
 * @param locale  目标语言（默认 DEFAULT_LOCALE）
 * @returns       Map<cardId, localizedName>；缺失条目不在 Map 中（外部降级为 cardId）
 */
export function buildCardNames(
  locale: SupportedLocale = DEFAULT_LOCALE
): Map<string, string> {
  const map = new Map<string, string>();
  const files = TEXT_FILES[locale] ?? TEXT_FILES[DEFAULT_LOCALE];

  for (const file of files) {
    for (const [cardId, entry] of Object.entries(file.cards)) {
      if (entry.name) {
        map.set(cardId, entry.name);
      }
    }
  }

  return map;
}

/**
 * 卡牌完整文案条目 — 用于商店预览 / 手牌悬浮提示等渲染场景。
 * body 可能为多行规则文本；reminder 为辅助提示（非规则文本）。
 */
export interface CardTextEntry {
  name: string;
  body: string;
  reminder?: string | null;
}

/**
 * 构建 cardId → 完整文案 的 Map。
 *
 * 与 buildCardNames 相比，本函数额外包含 body / reminder，
 * 供需要展示规则文案的 UI（商店预览、手牌悬浮等）消费。
 */
export function buildCardTexts(
  locale: SupportedLocale = DEFAULT_LOCALE
): Map<string, CardTextEntry> {
  const map = new Map<string, CardTextEntry>();
  const files = TEXT_FILES[locale] ?? TEXT_FILES[DEFAULT_LOCALE];

  for (const file of files) {
    for (const [cardId, entry] of Object.entries(file.cards)) {
      if (!entry.name && !entry.body) continue;
      map.set(cardId, {
        name: entry.name,
        body: entry.body,
        reminder: entry.reminder ?? null,
      });
    }
  }

  return map;
}
