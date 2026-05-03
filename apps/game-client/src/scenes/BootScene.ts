import Phaser from "phaser";
import { RoomClient } from "../network/RoomClient";
import type { PublicMatchView, PrivatePlayerView } from "@dev-camcard/protocol";
import { preloadRuntimePlaceholders } from "../assets/runtimeAssets";
import { buildCardNames, buildCardTexts, DEFAULT_LOCALE } from "../content/clientLocale";
import { copyTextToClipboard, mountRoomBadge, unmountRoomBadge } from "../lobby/roomBadge";
import { createUI } from "./uiKit";
import { BASE_WIDTH, BASE_HEIGHT } from "../main";

interface BootSceneData {
  /** 由 lobby 完成 ws 握手后传入；BootScene 不再自己发起连接。 */
  roomClient: RoomClient;
  /** lobby 模式：影响等待文案（"创建房间"时给玩家提示房号 / "等待对手加入"）。 */
  mode?: "quick" | "create" | "join";
  playerName?: string | null;
  /** 由 main.ts 注入的设备像素比；用于 camera zoom。 */
  dpr?: number;
}

/**
 * BootScene — 接管已连接的 RoomClient，等待首帧后切换到 RoomScene。
 *
 * 职责：
 *  1. 预加载占位资源
 *  2. 显示等待状态（含房号；"创建房间"模式下挂出 HTML 复制房号气泡，
 *     这样即便 lobby 已隐藏，玩家依然能拿到房号发给好友）
 *  3. 等到首个 PublicMatchView + PrivatePlayerView 后切换到 RoomScene
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    preloadRuntimePlaceholders(this.load);
  }

  create(data: BootSceneData): void {
    // camera 调整为 origin=0 + zoom=dpr：让逻辑坐标 [0, BASE_WIDTH/HEIGHT] 一一映射
    // 到画布像素 [0, BASE×dpr]。这样画布内每个文字 / 边框都按硬件像素 1:1 烘焙，
    // FIT 再 CSS 缩放到容器 —— 不再经历"低分辨率画布 → CSS 拉伸"的二次插值。
    const dpr = data.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.cameras.main.setOrigin(0, 0);
    if (dpr !== 1) this.cameras.main.setZoom(dpr);

    const ui = createUI(this);
    const cx = BASE_WIDTH / 2;
    const cy = BASE_HEIGHT / 2;

    ui.text(cx, cy - 60, "Dev-CamCard · 课表风暴", {
      size: 22,
      color: "#cccccc",
      centered: true,
      weight: "bold",
    });

    const roomLine = ui.text(cx, cy - 20, "", {
      size: 16,
      color: "#ffd86b",
      centered: true,
      align: "center",
    });

    const initialMessage =
      data.mode === "create"
        ? "房间已创建，等待对手加入..."
        : data.mode === "join"
        ? "正在加入房间..."
        : "已连接，等待开局...";

    const statusText = ui.text(cx, cy + 20, initialMessage, {
      size: 16,
      color: "#aaaaaa",
      centered: true,
    });

    if (!data?.roomClient) {
      statusText.setText("RoomClient 未传入，请回到主页面重新进入。");
      statusText.setColor("#ff6666");
      return;
    }

    const roomClient = data.roomClient;
    const roomId = roomClient.roomId;
    if (roomId) {
      const hint = data.mode === "create" ? "把房间号发给好友：" : "房间号：";
      roomLine.setText(`${hint}${roomId}`);

      // HTML 浮层挂在 #game 容器上方，独立于 Phaser canvas —— 这是修复"复制
      // 房号按钮看不到"的关键：以前按钮挂在 #lobby 里，进 Phaser 后 lobby 被
      // hidden，按钮也跟着消失。挂到 #game 上后玩家全程都能用。
      mountRoomBadge({
        roomId,
        prominent: data.mode === "create",
        onCopy: async () => {
          const ok = await copyTextToClipboard(roomId);
          return ok;
        },
      });
    }

    // 进 RoomScene 前清掉房号气泡；游戏进行中不再展示该浮层。
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unmountRoomBadge();
    });

    // 构建 locale 文案 Map（早于网络请求，纯同步）
    const cardNames = buildCardNames(DEFAULT_LOCALE);
    // 完整文案（含 body / reminder）用于商店预览 / 手牌悬浮
    const cardTexts = buildCardTexts(DEFAULT_LOCALE);

    // 等待 state_update + private_update 均到达后再切换场景
    let firstView: PublicMatchView | null = null;
    let firstPrivate: PrivatePlayerView | null = null;
    let transitioned = false;

    const tryTransition = () => {
      if (transitioned || !firstView || !firstPrivate) return;
      transitioned = true;
      this.scene.start("RoomScene", {
        view: firstView,
        privateView: firstPrivate,
        roomClient,
        cardNames,
        cardTexts,
        dpr,
      });
    };

    roomClient.onStateUpdate = (view) => {
      firstView = view;
      tryTransition();
    };
    roomClient.onPrivateUpdate = (pv) => {
      firstPrivate = pv;
      tryTransition();
    };
    roomClient.onError = (msg) => {
      statusText.setText(`服务器错误：${msg}`);
      statusText.setColor("#ff6666");
    };
  }
}
