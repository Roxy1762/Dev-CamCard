import { Client, type Room } from "colyseus.js";
import type { PublicMatchView } from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export type StateUpdateHandler = (view: PublicMatchView) => void;

/**
 * RoomClient — Colyseus 连接封装。
 *
 * 当前阶段：使用消息（onMessage）接收服务端推送的 PublicMatchView 快照。
 * 后续将迁移到 @colyseus/schema 状态同步，
 * 届时可无缝替换此处的实现而不影响上层调用方。
 *
 * 分层约束（non-negotiables.md）：
 *  - 客户端只接收公开视图，私有手牌通过独立消息接收
 *  - 客户端只发送 Command，不发送结算结果
 */
export class RoomClient {
  private readonly client: Client;
  private room: Room<unknown> | null = null;

  /**
   * 状态更新回调 — 可在连接后替换（供 RoomScene 更新自身 UI）。
   * 每次收到 state_update 消息时调用。
   */
  public onStateUpdate: StateUpdateHandler | null = null;

  constructor(serverUrl: string = SERVER_URL) {
    this.client = new Client(serverUrl);
  }

  /**
   * 加入或创建房间，并注册内部状态转发。
   * 初始状态将通过 onStateUpdate 回调推送。
   */
  async joinOrCreate(
    roomName: string,
    options: Record<string, unknown>
  ): Promise<void> {
    this.room = await this.client.joinOrCreate(roomName, options);

    this.room.onMessage(EVT.STATE_UPDATE, (msg: PublicMatchView) => {
      this.onStateUpdate?.(msg);
    });
  }

  /** 主动离开房间 */
  leave(): void {
    this.room?.leave();
    this.room = null;
    this.onStateUpdate = null;
  }

  get roomId(): string | null {
    return this.room?.id ?? null;
  }
}
