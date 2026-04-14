import { Room, Client } from "colyseus";

/**
 * GameRoom — 最小 Colyseus 房间骨架
 *
 * 当前阶段：仅处理加入/离开事件，不含任何规则逻辑。
 * 后续将：
 *  1. 引入 @colyseus/schema 定义 PublicMatchView 状态
 *  2. 接入 packages/engine 规则引擎（纯函数 reduce）
 *  3. 处理来自客户端的 Command（packages/protocol 定义）
 *
 * 参考 docs/technical-decisions.md：状态分层约定。
 */
export class GameRoom extends Room {
  maxClients = 2;

  onCreate(_options: unknown): void {
    console.log(`[GameRoom] 房间已创建: ${this.roomId}`);
  }

  onJoin(client: Client, _options: unknown): void {
    console.log(`[GameRoom] 玩家加入: ${client.sessionId}`);
  }

  onLeave(client: Client, _graceful: boolean): void {
    console.log(`[GameRoom] 玩家离开: ${client.sessionId}`);
  }

  onDispose(): void {
    console.log(`[GameRoom] 房间销毁: ${this.roomId}`);
  }
}
