/**
 * main.ts — 游戏前端入口。
 *
 * 启动顺序：
 *  1) Lobby（HTML）让玩家选模式（快速匹配 / 创建房间 / 加入房号）
 *  2) RoomClient 完成 ws 握手后，把已连接的 client 传到 HtmlGameView
 *  3) HtmlGameView 显示 #game-view，订阅 RoomClient 推送，按状态更新 DOM
 *
 * 历史背景：
 *  - 早期版本游戏区跑在 Phaser canvas 上，存在文字渲染糊化、布局重叠、多次
 *    rebuildUI 累计未销毁对象等系列 bug。已切换到 HTML/CSS 渲染：
 *    浏览器原生字体永远清晰、CSS Grid 自动避免坐标重叠、点击事件天然可靠。
 *  - 旧的 Phaser scenes（BootScene / RoomScene / ReplayScene）已删除，
 *    回放也改为 HTML 模态弹层。
 */

import { startLobby, type LobbyConnection } from "./lobby/lobby";
import { HtmlGameView } from "./game/htmlGameView";
import { buildCardNames, buildCardTexts, DEFAULT_LOCALE } from "./content/clientLocale";

let activeView: HtmlGameView | null = null;

function bootGame(conn: LobbyConnection): void {
  // 切换到游戏视图前，先销毁上一个（如有，hot-reload 场景）
  if (activeView) {
    activeView.destroy();
    activeView = null;
  }

  // 文案 Map 在前端构建期就准备好（Vite 把 JSON 静态打包），无需异步等待。
  const cardNames = buildCardNames(DEFAULT_LOCALE);
  const cardTexts = buildCardTexts(DEFAULT_LOCALE);

  activeView = new HtmlGameView({
    roomClient: conn.client,
    cardNames,
    cardTexts,
    mode: conn.mode,
  });
  activeView.start();
}

startLobby({ onConnected: bootGame });
