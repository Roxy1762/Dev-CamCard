/**
 * roomBadge.ts — Phaser 场景顶部 HTML 房号气泡。
 *
 * 为什么用 HTML 而不是画在 Phaser 内？
 *  1. navigator.clipboard / execCommand("copy") 必须由 DOM 元素触发，Phaser 内部
 *     的 zone 触发器走的是 canvas 事件，部分浏览器拒绝接到剪贴板权限。
 *  2. 字号与移动端选择行为可继承系统 UI，不依赖 canvas 文字纹理 —— 高 DPI 下
 *     一定清晰。
 *  3. 全局单例：BootScene 挂出，RoomScene 切换时复用，不需要重新 mount 抖动。
 *
 * 修复的根因：上一版"复制房号"按钮挂在 #lobby DOM 中，进 Phaser 后 lobby 被
 * hidden，按钮也消失。本模块把按钮挂在 #game 容器之外的 body 上（fixed 定位），
 * 与 Phaser canvas 解耦，全程可见。
 */

export interface RoomBadgeOptions {
  roomId: string;
  /** 是否突出展示（创建房间模式下用大号气泡，引导玩家分享）。 */
  prominent?: boolean;
  /** 复制按钮回调，应返回是否成功。 */
  onCopy: () => Promise<boolean>;
}

const BADGE_ID = "dc-room-badge";

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

/**
 * 挂载房号气泡。重复调用同一 roomId 视为更新（不会重复挂）。
 */
export function mountRoomBadge(opts: RoomBadgeOptions): void {
  if (typeof document === "undefined") return;

  let el = document.getElementById(BADGE_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = BADGE_ID;
    document.body.appendChild(el);
  }

  const prominent = opts.prominent ?? false;
  const sizeStyles = prominent
    ? "padding:10px 14px; font-size:14px;"
    : "padding:6px 10px; font-size:12px;";

  el.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1000;
    display: flex;
    gap: 8px;
    align-items: center;
    background: rgba(15, 15, 30, 0.92);
    color: #ffd86b;
    border: 1px solid rgba(255, 216, 107, 0.4);
    border-radius: 10px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    ${sizeStyles}
  `;

  el.innerHTML = `
    <span style="opacity:0.7;">房号</span>
    <span data-role="rid" style="
      font-family: ui-monospace,'JetBrains Mono',monospace;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #ffd86b;
      user-select: all;
    "></span>
    <button data-role="copy" type="button" style="
      padding: 4px 10px;
      font-size: ${prominent ? 13 : 11}px;
      font-weight: 600;
      background: #2c2c4a;
      color: #ffd86b;
      border: 1px solid rgba(255, 216, 107, 0.35);
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
    ">📋 复制</button>
    <span data-role="hint" style="
      color: #aaffcc;
      font-size: ${prominent ? 12 : 11}px;
      opacity: 0;
      transition: opacity 0.15s ease;
    ">已复制</span>
  `;

  const ridEl = el.querySelector<HTMLSpanElement>('[data-role="rid"]')!;
  const btnEl = el.querySelector<HTMLButtonElement>('[data-role="copy"]')!;
  const hintEl = el.querySelector<HTMLSpanElement>('[data-role="hint"]')!;
  ridEl.textContent = opts.roomId;

  let lastClickAt = 0;
  btnEl.onclick = async () => {
    // 防抖：250ms 内重复点击只处理一次。
    const now = Date.now();
    if (now - lastClickAt < 250) return;
    lastClickAt = now;

    const ok = await opts.onCopy();
    if (ok) {
      btnEl.textContent = "✓ 已复制";
      btnEl.style.color = "#aaffcc";
      btnEl.style.borderColor = "rgba(170, 255, 204, 0.45)";
      hintEl.style.opacity = "1";
      setTimeout(() => {
        btnEl.textContent = "📋 复制";
        btnEl.style.color = "#ffd86b";
        btnEl.style.borderColor = "rgba(255, 216, 107, 0.35)";
        hintEl.style.opacity = "0";
      }, 1600);
    } else {
      btnEl.textContent = "复制失败";
      setTimeout(() => {
        btnEl.textContent = "📋 复制";
      }, 1600);
    }
  };
}

/** 从 DOM 移除房号气泡。 */
export function unmountRoomBadge(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(BADGE_ID);
  if (el?.parentNode) el.parentNode.removeChild(el);
}

/** 仅更新房号显示（不重建 DOM）。RoomScene 切换时若 roomId 不变，复用。 */
export function updateRoomBadgeId(roomId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(BADGE_ID);
  if (!el) return;
  const ridEl = el.querySelector<HTMLSpanElement>('[data-role="rid"]');
  if (ridEl) ridEl.textContent = roomId;
}
