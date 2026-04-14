import { Room, Client } from "colyseus";
import type {
  PublicMatchView,
  PublicPlayerSummary,
  MarketLane,
} from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";

/**
 * GameRoom — Colyseus 房间骨架（含 mock 公共状态）
 *
 * 当前阶段：
 *  - 维护极简 mock PublicMatchView，无真实规则逻辑
 *  - 玩家加入时发送当前状态快照
 *
 * 后续接入路径（任务 3 → 正式轮次）：
 *  1. 引入 packages/engine 规则引擎（纯函数 reduce）
 *  2. 用 @colyseus/schema 定义 Schema 类，替换 JSON 广播
 *  3. 接收 ClientCommand（packages/protocol），驱动 engine.reduce
 *
 * 参考 docs/technical-decisions.md：状态分层约定。
 */
export class GameRoom extends Room {
  maxClients = 2;

  private view!: PublicMatchView;

  onCreate(_options: unknown): void {
    this.view = buildMockView(this.roomId);
    console.log(`[GameRoom] 房间已创建: ${this.roomId}`);
  }

  onJoin(client: Client, options: unknown): void {
    const opts = (options ?? {}) as { playerName?: string };
    const side = this.clients.length - 1 as 0 | 1;

    // 更新对应席位的玩家名称
    if (side === 0 || side === 1) {
      this.view.players[side].name = opts.playerName ?? `玩家${side + 1}`;
    }

    console.log(`[GameRoom] 玩家加入: ${client.sessionId} (side=${side})`);

    // 向刚加入的客户端发送当前状态快照
    client.send(EVT.STATE_UPDATE, this.view);
  }

  onLeave(client: Client, _graceful: boolean): void {
    console.log(`[GameRoom] 玩家离开: ${client.sessionId}`);
  }

  onDispose(): void {
    console.log(`[GameRoom] 房间销毁: ${this.roomId}`);
  }
}

// ── Mock 状态构造 ──────────────────────────────────────────────────────────────

function makeMockPlayer(side: 0 | 1, name: string): PublicPlayerSummary {
  return {
    side,
    name,
    hp: 32,          // game-rules.md: 生命值 32
    block: 0,
    deckSize: 12,    // game-rules.md: 起始套牌 12
    handSize: 0,
    discardSize: 0,
    resourcePool: 0,
    attackPool: 0,
    venues: [],
    scheduleSlots: [null, null], // game-rules.md: 日程槽 2
    reservedCard: null,           // game-rules.md: 预约位 1
  };
}

function buildMockView(roomId: string): PublicMatchView {
  const market: MarketLane[] = [
    { lane: "course", slots: [null, null] },
    { lane: "activity", slots: [null, null] },
    { lane: "daily", slots: [null, null] },
  ];

  return {
    roomId,
    turnNumber: 0,
    activePlayer: 0,
    players: [
      makeMockPlayer(0, "玩家一"),
      makeMockPlayer(1, "玩家二"),
    ],
    market,
    fixedSupplies: [
      "supply_errand_runner",
      "supply_milk_bread",
      "supply_print_materials",
    ],
    started: false,
    ended: false,
    winner: null,
  };
}
