import { Client, type Room } from "colyseus.js";
import type { PublicMatchView, PrivatePlayerView, ClientCommand } from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export type StateUpdateHandler = (view: PublicMatchView) => void;
export type PrivateUpdateHandler = (view: PrivatePlayerView) => void;

/**
 * RoomClient — Colyseus 连接封装。
 *
 * 分层约束（non-negotiables.md）：
 *  - 客户端只接收公开视图与己方私有视图
 *  - 客户端只发送 Command，不发送结算结果
 */
export class RoomClient {
  private readonly client: Client;
  private room: Room<unknown> | null = null;

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

    this.room.onMessage(EVT.STATE_UPDATE, (msg: PublicMatchView) => {
      this.onStateUpdate?.(msg);
    });

    this.room.onMessage(EVT.PRIVATE_UPDATE, (msg: PrivatePlayerView) => {
      this.onPrivateUpdate?.(msg);
    });
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

  /** 主动离开房间 */
  leave(): void {
    this.room?.leave();
    this.room = null;
    this.onStateUpdate = null;
    this.onPrivateUpdate = null;
  }

  get roomId(): string | null {
    return this.room?.id ?? null;
  }
}
