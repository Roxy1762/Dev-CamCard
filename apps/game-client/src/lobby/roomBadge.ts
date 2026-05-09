/**
 * roomBadge.ts — 剪贴板辅助。
 *
 * 历史：旧版本会在 #lobby / Phaser canvas 之外另挂一个浮动 HTML 房号气泡，
 * 但与游戏内顶栏重复显示且经常浮在按钮之上引起遮挡。HTML 版游戏视图把房号
 * 直接放在 game-header 里，不再需要这层浮层；本文件只保留 lobby 创建房间后
 * 复制房号要用的剪贴板兜底实现。
 */

/** 复制文本到剪贴板：先 Clipboard API，回退 execCommand("copy")。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
