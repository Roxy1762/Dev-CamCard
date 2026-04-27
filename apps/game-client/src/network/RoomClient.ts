import { Client, type Room } from "colyseus.js";
import type {
  PublicMatchView,
  PrivatePlayerView,
  ClientCommand,
  MatchEventLog,
} from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";

function normalizeServerUrl(raw: string): string {
  if (raw.startsWith("http://")) {
    return `ws://${raw.slice("http://".length)}`;
  }
  if (raw.startsWith("https://")) {
    return `wss://${raw.slice("https://".length)}`;
  }
  return raw;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = normalizeServerUrl(url.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function isLoopbackHost(host: string): boolean {
  if (!host) return false;
  const hostname = host.replace(/^\[/, "").replace(/\]$/, "").split(":")[0];
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function extractHostname(wsOrHttpUrl: string): string {
  // 不依赖 URL 构造器，避免 ws:// 在某些环境下解析异常。
  const stripped = wsOrHttpUrl
    .replace(/^wss?:\/\//, "")
    .replace(/^https?:\/\//, "");
  const noPath = stripped.split("/")[0];
  return noPath;
}

/**
 * 计算客户端实际要尝试的 ws 候选地址。
 *
 * 关键约束（这是一类生产事故的根因）：
 *  - VITE_SERVER_URL 在构建时被 Vite 烧入产物。一旦 .env 里写错（最常见的是
 *    "ws://localhost:2567"），所有用户在公网域名打开页面时也只会去连本机
 *    127.0.0.1，于是看到 "已尝试: ws://localhost:2567"。
 *  - 解决：浏览器运行时检测页面 host，如果 explicit URL 指向 loopback 而页面
 *    并不在 loopback 上，把 explicit URL 当作"显式坏配置"忽略，回退到按
 *    window.location 推导的同域 + :2567 兜底。
 *  - 同时，把按 window.location 推导出的候选地址也纳入返回，作为"explicit
 *    虽然能解析但仍不通"的额外回退（只有 explicit 与 page-host 的 hostname
 *    一致时才视为同一目标，避免重复尝试）。
 */
export function resolveDefaultServerUrls(): string[] {
  const explicitRaw = (
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_SERVER_URL as string | undefined)
      : undefined
  )?.trim();

  const isBrowser = typeof window !== "undefined" && !!window.location;

  if (!isBrowser) {
    return explicitRaw ? dedupeUrls([explicitRaw]) : ["ws://localhost:2567"];
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const { hostname, host } = window.location;
  const sameHost = `${protocol}//${host}`;
  const host2567 = `${protocol}//${hostname}:2567`;
  const pageOnLoopback = isLoopbackHost(host);

  // 在浏览器里访问公网域名时，明确忽略 explicit=loopback 的旧产物。
  // 这种情况大多是开发者把 VITE_SERVER_URL=ws://localhost:2567 写进了 .env，
  // 然后镜像里残留下来；再加上 mixed-content 阻断，就会"完全连不上"。
  if (explicitRaw) {
    const explicitHostname = extractHostname(explicitRaw);
    const explicitOnLoopback = isLoopbackHost(explicitHostname);
    if (explicitOnLoopback && !pageOnLoopback) {
      // 直接走"同 host + :2567"兜底，不再使用错误的 explicit。
      return dedupeUrls([sameHost, host2567]);
    }
    // explicit 看起来合理：优先尝试它，再附带 page-host 兜底。
    return dedupeUrls([explicitRaw, sameHost, host2567]);
  }

  return dedupeUrls([sameHost, host2567]);
}

let serverUrlsCache: string[] | null = null;
function getServerUrls(): string[] {
  if (!serverUrlsCache) serverUrlsCache = resolveDefaultServerUrls();
  return serverUrlsCache;
}

/** 测试钩子：清空模块级缓存，让下一次读取重新解析。 */
export function __resetServerUrlsCacheForTests(): void {
  serverUrlsCache = null;
}

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
 *  - joinOrCreate / create / joinById 成功后自动把 reconnectionToken 存进
 *    localStorage
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

  constructor(serverUrl?: string) {
    const url = serverUrl ?? getServerUrls()[0] ?? "ws://localhost:2567";
    this.client = new Client(url);
  }

  static getDefaultServerUrls(): string[] {
    return [...getServerUrls()];
  }

  /**
   * 加入或创建房间（快速匹配），并注册内部状态转发。
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
   * 强制创建一个新房间（用于"和朋友开房"场景，避免被自动塞进别人开的房间）。
   */
  async create(
    roomName: string,
    options: Record<string, unknown>
  ): Promise<void> {
    this.room = await this.client.create(roomName, options);
    this.saveReconnectionToken();
    this.registerHandlers();
  }

  /**
   * 通过房间号加入指定房间。
   */
  async joinById(
    roomId: string,
    options: Record<string, unknown>
  ): Promise<void> {
    this.room = await this.client.joinById(roomId, options);
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
