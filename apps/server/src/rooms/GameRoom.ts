import { Room, Client } from "colyseus";
import * as fs from "fs";
import * as path from "path";
import { EVT } from "@dev-camcard/protocol";
import type { ClientCommand, PlayerSide } from "@dev-camcard/protocol";
import {
  createMatchState,
  reduce,
  toPublicMatchView,
  toPrivatePlayerView,
} from "@dev-camcard/engine";
import type { InternalMatchState, RulesetConfig, EngineConfig, CardDef, CardInstance, MarketLaneState } from "@dev-camcard/engine";

// ── 数据加载（模块级，仅执行一次）────────────────────────────────────────────

// __dirname 在 dev (tsx) 和 prod (dist/) 下均指向 src/rooms 或 dist/rooms，
// 均距项目根目录 4 层，所以统一用 "../../../../data"。
const DATA_ROOT = path.resolve(__dirname, "../../../../data");

function loadJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}

interface RawCardJson {
  id: string;
  cost: number;
  type: "action" | "venue";
  lane?: string;
  isGuard?: boolean;
  durability?: number;
  activationsPerTurn?: number;
  abilities: CardDef["abilities"];
}

const starterCards: RawCardJson[] = loadJson("cards/starter.json");
const supplyCards: RawCardJson[] = loadJson("cards/fixed-supplies.json");
const marketCards: RawCardJson[] = loadJson("cards/market-core.json");
const ruleset: RulesetConfig = loadJson("rulesets/core-v1.json");

// cardId → cost 查找表
const costMap = new Map<string, number>();
// cardId → CardDef 查找表
const cardDefMap = new Map<string, CardDef>();

for (const c of [...starterCards, ...supplyCards, ...marketCards]) {
  costMap.set(c.id, c.cost);
  cardDefMap.set(c.id, {
    id: c.id,
    type: c.type,
    abilities: c.abilities ?? [],
    isGuard: c.isGuard,
    durability: c.durability,
    activationsPerTurn: c.activationsPerTurn,
  });
}

const ENGINE_CONFIG: EngineConfig = {
  ruleset,
  getCardCost: (cardId) => costMap.get(cardId) ?? 0,
  getCardDef: (cardId) => cardDefMap.get(cardId),
};

/**
 * 按商店栏（lane）分组市场牌，用于初始化市场槽位。
 * MVP：每栏最多 2 张（对应 ruleset.marketSlotsPerLane）。
 */
function buildInitialMarket(
  cards: RawCardJson[],
  ruleset: RulesetConfig,
  genId: () => string
): MarketLaneState[] {
  const laneOrder = ["course", "activity", "daily"] as const;
  const byLane: Record<string, RawCardJson[]> = {
    course: [],
    activity: [],
    daily: [],
  };

  for (const card of cards) {
    const lane = card.lane ?? "daily";
    if (lane in byLane) {
      byLane[lane].push(card);
    }
  }

  return laneOrder.slice(0, ruleset.marketLanesCount).map((lane) => {
    const candidates = byLane[lane];
    const slots: (CardInstance | null)[] = Array(ruleset.marketSlotsPerLane).fill(null);
    for (let i = 0; i < Math.min(candidates.length, ruleset.marketSlotsPerLane); i++) {
      slots[i] = { instanceId: genId(), cardId: candidates[i].id };
    }
    return { lane, slots };
  });
}

// ── GameRoom ──────────────────────────────────────────────────────────────────

/**
 * GameRoom — Colyseus 房间，接入真实规则引擎。
 *
 * 状态分层（docs/technical-decisions.md）：
 *  - InternalMatchState  服务端持有，禁止直接发送给客户端
 *  - PublicMatchView     广播给全部客户端
 *  - PrivatePlayerView   仅发给对应席位
 *
 * 客户端通过发送 ClientCommand（CMD.*）驱动 engine.reduce。
 */
export class GameRoom extends Room {
  maxClients = 2;

  private matchState!: InternalMatchState;
  /** sessionId → 席位 */
  private sideMap = new Map<string, PlayerSide>();
  /** 房间内 UUID 计数器（简单递增，测试友好） */
  private idCounter = 0;
  private genId = () => `room-${this.roomId}-${++this.idCounter}`;

  onCreate(_options: unknown): void {
    const baseState = createMatchState(this.roomId, ruleset, ["玩家一", "玩家二"], this.genId);

    // 用市场牌填充初始商店槽（MVP：固定按栏分配）
    const market = buildInitialMarket(marketCards, ruleset, this.genId);
    this.matchState = { ...baseState, market };

    // 统一消息处理器：客户端发 { type: CMD.*, ...payload }
    this.onMessage("*", (client: Client, type: string | number, message: unknown) => {
      const side = this.sideMap.get(client.sessionId);
      if (side === undefined) return;

      const command = { type: String(type), ...(message as object) } as ClientCommand;

      try {
        this.matchState = reduce(this.matchState, side, command, ENGINE_CONFIG);
        this.broadcastState();
      } catch (err) {
        client.send("error", { message: (err as Error).message });
      }
    });

    console.log(`[GameRoom] 房间已创建: ${this.roomId}`);
  }

  onJoin(client: Client, options: unknown): void {
    const opts = (options ?? {}) as { playerName?: string };
    const side = (this.clients.length - 1) as PlayerSide;
    this.sideMap.set(client.sessionId, side);

    // 更新席位玩家名称
    if (side === 0 || side === 1) {
      const players = this.matchState.players.map((p, i) =>
        i === side ? { ...p, name: opts.playerName ?? `玩家${side + 1}` } : p
      ) as [typeof this.matchState.players[0], typeof this.matchState.players[1]];
      this.matchState = { ...this.matchState, players };
    }

    console.log(`[GameRoom] 玩家加入: ${client.sessionId} (side=${side})`);

    // 向新加入的客户端发送当前快照
    client.send(EVT.STATE_UPDATE, toPublicMatchView(this.matchState));
    if (side === 0 || side === 1) {
      client.send(EVT.PRIVATE_UPDATE, toPrivatePlayerView(this.matchState, side));
    }
  }

  onLeave(client: Client, _graceful: boolean): void {
    this.sideMap.delete(client.sessionId);
    console.log(`[GameRoom] 玩家离开: ${client.sessionId}`);
  }

  onDispose(): void {
    console.log(`[GameRoom] 房间销毁: ${this.roomId}`);
  }

  // ── 私有辅助 ────────────────────────────────────────────────────────────────

  private broadcastState(): void {
    const publicView = toPublicMatchView(this.matchState);
    this.broadcast(EVT.STATE_UPDATE, publicView);

    for (const client of this.clients) {
      const side = this.sideMap.get(client.sessionId);
      if (side === 0 || side === 1) {
        client.send(EVT.PRIVATE_UPDATE, toPrivatePlayerView(this.matchState, side));
      }
    }
  }
}
