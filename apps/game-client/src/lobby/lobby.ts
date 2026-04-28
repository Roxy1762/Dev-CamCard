/**
 * lobby.ts — HTML 版玩家主页面控制器。
 *
 * 职责：
 *  - 让玩家在 Phaser 启动前先选定模式（快速匹配 / 创建房间 / 加入指定房号）
 *  - 用统一的 connectWithFallback 走 ws 连接，失败时把错误展示在 lobby 上
 *  - 连接成功后切换到 Phaser 游戏视图，并把已经握手好的 RoomClient 传进去
 *  - 暴露管理后台访问入口（默认推断为同 host 的 :3001，可由 build 时覆盖）
 *
 * 设计取舍：
 *  - 表单全部用原生 DOM，避免引入框架；index.html 提前渲染好结构。
 *  - 房号 / 昵称记忆走 localStorage，刷新或重连不会丢。
 *  - 任何连接失败的错误都不会静默：状态文本必须更新。
 */

import { RoomClient } from "../network/RoomClient";
import { connectWithFallback, describeConnectError, type JoinAction } from "../network/connectFlow";
import { copyTextToClipboard } from "./roomBadge";

export type LobbyMode = "quick" | "create" | "join";

const PLAYER_NAME_KEY = "devCamCard_playerName";

interface LobbyDom {
  lobby: HTMLElement;
  game: HTMLElement;
  playerName: HTMLInputElement;
  quickBtn: HTMLButtonElement;
  createBtn: HTMLButtonElement;
  joinBtn: HTMLButtonElement;
  joinIdInput: HTMLInputElement;
  status: HTMLElement;
  createdRoomId: HTMLElement;
  copyRoomIdBtn: HTMLButtonElement;
  adminLink: HTMLAnchorElement;
}

export interface LobbyConnection {
  client: RoomClient;
  mode: LobbyMode;
  /** 玩家提交的昵称（已 trim，可能为 null 以走 server 默认）。 */
  playerName: string | null;
}

export interface LobbyControllerOptions {
  /** 管理后台地址；缺省按 window.location 推断（同 host : 3001）。 */
  adminUrl?: string;
  /** 连接成功后的回调，由调用方启动 Phaser。 */
  onConnected: (conn: LobbyConnection) => void;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[lobby] 缺少 DOM 元素 #${id}`);
  return el as T;
}

function readDom(): LobbyDom {
  return {
    lobby: $<HTMLElement>("lobby"),
    game: $<HTMLElement>("game"),
    playerName: $<HTMLInputElement>("player-name"),
    quickBtn: $<HTMLButtonElement>("quick-match"),
    createBtn: $<HTMLButtonElement>("create-room"),
    joinBtn: $<HTMLButtonElement>("join-room"),
    joinIdInput: $<HTMLInputElement>("join-room-id"),
    status: $<HTMLElement>("lobby-status"),
    createdRoomId: $<HTMLElement>("created-room-id"),
    copyRoomIdBtn: $<HTMLButtonElement>("copy-room-id"),
    adminLink: $<HTMLAnchorElement>("admin-link"),
  };
}

function inferAdminUrl(): string {
  // VITE 注入优先；否则按当前 host 推断同主机的 :3001（默认部署端口）。
  const viaEnv =
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_ADMIN_URL as string | undefined)
      : undefined;
  if (viaEnv && viaEnv.trim()) return viaEnv.trim();

  if (typeof window === "undefined") return "/admin";

  const { protocol, hostname } = window.location;
  // 公网部署若用同域反代到 admin，可在 .env 设 VITE_ADMIN_URL=/admin。
  return `${protocol}//${hostname}:3001`;
}

function loadSavedName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    if (name) localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

function setBusy(dom: LobbyDom, busy: boolean): void {
  dom.quickBtn.disabled = busy;
  dom.createBtn.disabled = busy;
  dom.joinBtn.disabled = busy;
  dom.playerName.disabled = busy;
  dom.joinIdInput.disabled = busy;
}

function setStatus(dom: LobbyDom, text: string, level: "info" | "error" = "info"): void {
  dom.status.textContent = text;
  dom.status.classList.toggle("error", level === "error");
}

export function startLobby(opts: LobbyControllerOptions): void {
  const dom = readDom();
  const adminUrl = opts.adminUrl ?? inferAdminUrl();
  dom.adminLink.href = adminUrl;
  dom.adminLink.textContent = `运营后台（${adminUrl}）`;

  dom.playerName.value = loadSavedName();

  // 若 URL 带 ?room=ABCD 则预填房号，方便邀请链接直接 paste。
  const params = new URLSearchParams(window.location.search);
  const presetRoom = params.get("room");
  if (presetRoom) dom.joinIdInput.value = presetRoom.trim();

  const playerName = (): string | null => {
    const raw = dom.playerName.value.trim();
    return raw ? raw : null;
  };

  const launch = async (mode: LobbyMode, joinAction: JoinAction<RoomClient>) => {
    setBusy(dom, true);
    setStatus(dom, "正在连接服务器...");
    dom.createdRoomId.classList.add("hidden");
    dom.copyRoomIdBtn.classList.add("hidden");
    dom.copyRoomIdBtn.classList.remove("copied");
    dom.copyRoomIdBtn.textContent = "📋 复制房号";

    const name = playerName();
    if (name) saveName(name);

    try {
      const result = await connectWithFallback<RoomClient>({
        urls: RoomClient.getDefaultServerUrls(),
        hasToken: !!RoomClient.loadReconnectionToken(),
        clearToken: () => RoomClient.clearReconnectionToken(),
        createClient: (url) => new RoomClient(url),
        joinAction,
        onStatus: (m) => setStatus(dom, m),
      });

      setStatus(dom, "已连接，进入对局界面...");
      opts.onConnected({ client: result.client, mode, playerName: name });
    } catch (err) {
      const tried = RoomClient.getDefaultServerUrls().join("  /  ");
      setStatus(
        dom,
        `连接失败：${describeConnectError(err)}\n已尝试: ${tried}`,
        "error"
      );
      setBusy(dom, false);
    }
  };

  dom.quickBtn.addEventListener("click", () => {
    void launch("quick", (client) =>
      client.joinOrCreate("game_room", playerName() ? { playerName: playerName() } : {})
    );
  });

  dom.createBtn.addEventListener("click", () => {
    void launch("create", async (client) => {
      await client.create("game_room", playerName() ? { playerName: playerName() } : {});
      const id = client.roomId;
      if (id) {
        dom.createdRoomId.textContent = id;
        dom.createdRoomId.classList.remove("hidden");
        dom.copyRoomIdBtn.classList.remove("hidden");
        dom.copyRoomIdBtn.dataset.roomId = id;
      }
    });
  });

  dom.copyRoomIdBtn.addEventListener("click", () => {
    const id =
      dom.copyRoomIdBtn.dataset.roomId ?? dom.createdRoomId.textContent ?? "";
    void copyTextToClipboard(id).then((ok) => {
      if (ok) {
        dom.copyRoomIdBtn.textContent = "✓ 已复制";
        dom.copyRoomIdBtn.classList.add("copied");
        setStatus(dom, `已复制房号 ${id}，把它发给好友吧。`);
        setTimeout(() => {
          dom.copyRoomIdBtn.textContent = "📋 复制房号";
          dom.copyRoomIdBtn.classList.remove("copied");
        }, 1800);
      } else {
        setStatus(dom, "复制失败，请手动选中房号复制。", "error");
      }
    });
  });

  dom.joinBtn.addEventListener("click", () => {
    const roomId = dom.joinIdInput.value.trim();
    if (!roomId) {
      setStatus(dom, "请先填写房间号。", "error");
      return;
    }
    void launch("join", (client) =>
      client.joinById(roomId, playerName() ? { playerName: playerName() } : {})
    );
  });

  // 回车在房号输入框里直接触发"加入"
  dom.joinIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dom.joinBtn.click();
    }
  });
}

export function showGameView(): void {
  const lobby = document.getElementById("lobby");
  const game = document.getElementById("game");
  if (lobby) lobby.classList.add("hidden");
  if (game) game.classList.remove("hidden");
}
