import { Client, type Room } from "colyseus.js";
import type {
  PublicMatchView,
  PrivatePlayerView,
  ClientCommand,
  MatchEventLog,
} from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";

function resolveDefaultServerUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicit) return explicit;

  if (typeof window === "undefined") {
    return "ws://localhost:2567";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const { hostname, host } = window.location;

  // Vite dev：前端与 Colyseus 分端口运行（前端端口任意，server 固定 2567）。
  if (import.meta.env.DEV) {
    return `${protocol}//${hostname}:2567`;
  }

  // 生产构建：默认走同 host，由 nginx 把 /matchmake 与 /game_room 反代到 server。
  // 这样无论部署在 localhost、IP 还是域名上，浏览器都不需要直连 2567。
  return `${protocol}//${host}`;
}

const SERVER_URL = resolveDefaultServerUrl();

/** localStorage key — 存储上次的 reconnectionToken */
const STORAGE_KEY = "devCamCard_reconnectionToken";

export type StateUpdateHandler = (view: PublicMatchView) => void;
export type PrivateUpdateHandler = (view: PrivatePlayerView) => void;
export type EventLogHandler = (log: MatchEventLog) => void;
export type ErrorHandler = (message: string) => void;

/**
 * RoomClient — Colyseus 连接封装。
 *
 * 分层约束（non-negotiables.md）：
 *  - 客户端只接收公开视图与己方私有视图
 *  - 客户端只发送 Command，不发送结算结果
 *
 * 重连支持：
 *  - joinOrCreate 成功后自动将 reconnectionToken 存入 localStorage
 *  - reconnect() 使用存储的 token 尝试重连
 *  - 重连成功后服务端会推送最新状态 + 事件日志
 */
export class RoomClient {
  private readonly client: Client;
  private room: Room<unknown> | null = null;
  private eventLogWaiters: Array<(log: MatchEventLog) => void> = [];

  /**
   * 公开状态更新回调 — 每次收到 state_update 时调用。
   * 可在连接后替换（供 RoomScene 更新自身 UI）。
   */
  public onStateUpdate: StateUpdateHandler | null = null;

  /**
   * 私有视图更新回调 — 每次收到 private_update 时调用。
   * 包含己方手牌等私有信息。
   */
  public onPrivateUpdate: PrivateUpdateHandler | null = null;

  /**
   * 事件日志回调 — 每次收到 match_events 时调用。
   * 重连后服务端会主动推送完整事件流。
   */
  public onEventLog: EventLogHandler | null = null;

  /**
   * 错误回调 — 服务端拒绝命令或出现可见错误时触发。
   */
  public onError: ErrorHandler | null = null;

  constructor(serverUrl: string = SERVER_URL) {
    this.client = new Client(serverUrl);
  }

  /**
   * 加入或创建房间，并注册内部状态转发。
   */
  async joinOrCreate(
    roomName: string,
    options: Record<string, unknown>
  ): Promise<void> {
    this.room = await this.client.joinOrCreate(roomName, options);
    this.saveReconnectionToken();
    this.registerHandlers();
  }

  /**
   * 使用 localStorage 中的 reconnectionToken 重连已有房间。
   * 成功后注册与 joinOrCreate 相同的消息处理器。
   * 失败时抛出错误（调用方负责 fallback）。
   */
  async reconnect(): Promise<void> {
    const token = RoomClient.loadReconnectionToken();
    if (!token) throw new Error("no_token");
    this.room = await this.client.reconnect(token);
    this.saveReconnectionToken();
    this.registerHandlers();
  }

  /**
   * 向服务端发送命令。
   * Colyseus 的 send(type, payload) 会被服务端的 onMessage("*", ...) 接收，
   * 服务端重建 { type, ...payload } 后交给 engine.reduce。
   */
  send<T extends ClientCommand>(command: T): void {
    if (!this.room) return;
    const { type, ...payload } = command as { type: string } & Record<string, unknown>;
    this.room.send(type, payload);
  }

  /**
   * 向服务端请求完整事件日志（回放入口）。
   */
  requestEventLog(): void {
    this.room?.send("REQUEST_MATCH_EVENTS", {});
  }

  /**
   * 一次性请求完整事件日志。
   * 不会覆盖全局 onEventLog 回调，适合临时打开回放界面。
   */
  requestEventLogOnce(): Promise<MatchEventLog> {
    if (!this.room) {
      return Promise.reject(new Error("room_not_connected"));
    }

    return new Promise<MatchEventLog>((resolve) => {
      this.eventLogWaiters.push(resolve);
      this.requestEventLog();
    });
  }

  /** 主动离开房间（清理 token，不需要重连） */
  leave(): void {
    RoomClient.clearReconnectionToken();
    this.room?.leave();
    this.room = null;
    this.eventLogWaiters = [];
    this.onStateUpdate = null;
    this.onPrivateUpdate = null;
    this.onEventLog = null;
    this.onError = null;
  }

  get roomId(): string | null {
    return this.room?.id ?? null;
  }

  // ── token 持久化 ─────────────────────────────────────────────────────────────

  static loadReconnectionToken(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  static clearReconnectionToken(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  private saveReconnectionToken(): void {
    if (!this.room) return;
    const token = (this.room as unknown as { reconnectionToken?: string }).reconnectionToken;
    if (token) {
      try {
        localStorage.setItem(STORAGE_KEY, token);
      } catch {
        // ignore (SSR / private browsing)
      }
    }
  }

  // ── 消息处理器注册 ────────────────────────────────────────────────────────────

  private registerHandlers(): void {
    if (!this.room) return;

    this.room.onMessage(EVT.STATE_UPDATE, (msg: PublicMatchView) => {
      this.onStateUpdate?.(msg);
    });

    this.room.onMessage(EVT.PRIVATE_UPDATE, (msg: PrivatePlayerView) => {
      this.onPrivateUpdate?.(msg);
    });

    this.room.onMessage(EVT.MATCH_EVENTS, (msg: MatchEventLog) => {
      this.onEventLog?.(msg);

      if (this.eventLogWaiters.length > 0) {
        const waiters = this.eventLogWaiters.splice(0, this.eventLogWaiters.length);
        for (const resolve of waiters) {
          resolve(msg);
        }
      }
    });

    this.room.onMessage("error", (msg: { message?: string }) => {
      this.onError?.(msg.message ?? "服务器返回未知错误");
    });
  }
}
