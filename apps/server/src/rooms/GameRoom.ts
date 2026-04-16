import { Room, Client } from "colyseus";
import * as path from "path";
import { EVT } from "@dev-camcard/protocol";
import type { ClientCommand, PlayerSide } from "@dev-camcard/protocol";
import {
  createMatchState,
  createMarketState,
  reduce,
  toPublicMatchView,
  toPrivatePlayerView,
} from "@dev-camcard/engine";
import type { InternalMatchState, RulesetConfig, EngineConfig, CardDef } from "@dev-camcard/engine";
import {
  loadRuleBatch,
  loadSetManifest,
  type CardRuleData,
} from "@dev-camcard/schemas";

// ── 数据加载（模块级，仅执行一次）────────────────────────────────────────────

// __dirname 在 dev (tsx) 和 prod (dist/) 下均指向 src/rooms 或 dist/rooms，
// 均距项目根目录 4 层，所以统一用 "../../../../"。
const DATA_ROOT = path.resolve(__dirname, "../../../../");

// v2 规则数据：从 data/cards/rules/ 加载，不含本地化文案
const allRules: CardRuleData[] = loadRuleBatch(DATA_ROOT, [
  "data/cards/rules/starter.json",
  "data/cards/rules/fixed-supplies.json",
  "data/cards/rules/market-core.json",
  "data/cards/rules/status.json",
]);

// ruleset：从 data/rulesets/ 加载（仍使用旧格式，无变化）
import * as fs from "fs";
function loadJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}
const ruleset: RulesetConfig = loadJson("data/rulesets/core-v1.json");

// cardId → cost 查找表
const costMap = new Map<string, number>();
// cardId → CardDef 查找表（引擎只需要 id/type/abilities/isGuard/durability/activationsPerTurn/isPressure）
const cardDefMap = new Map<string, CardDef>();

for (const rule of allRules) {
  costMap.set(rule.id, rule.cost);
  cardDefMap.set(rule.id, {
    id: rule.id,
    type: rule.type,
    // abilities 结构与引擎兼容：trigger/effects/condition 均保留
    abilities: rule.abilities as CardDef["abilities"],
    isGuard: rule.isGuard,
    durability: rule.durability,
    activationsPerTurn: rule.activationsPerTurn,
    // isPressure：优先 JSON 字段，否则检查 tags 数组是否含 "pressure"
    isPressure: rule.isPressure ?? rule.tags.includes("pressure"),
  });
}

// 市场牌列表（来自 rules/market-core.json）
const marketRules = allRules.filter((r) => !r.starter && !r.fixedSupply && !r.isPressure && !r.tags.includes("pressure"));

const ENGINE_CONFIG: EngineConfig = {
  ruleset,
  getCardCost: (cardId) => costMap.get(cardId) ?? 0,
  getCardDef: (cardId) => cardDefMap.get(cardId),
};

/**
 * buildLaneDefinitions — 将市场牌规则按 lane 分组，返回引擎 createMarketState 所需格式。
 */
function buildLaneDefinitions(
  rules: CardRuleData[],
  laneCount: number
): Array<{ lane: "course" | "activity" | "daily"; cardIds: string[] }> {
  const laneOrder = ["course", "activity", "daily"] as const;
  const byLane: Record<string, string[]> = { course: [], activity: [], daily: [] };

  for (const rule of rules) {
    const lane = rule.lane;
    if (lane in byLane) {
      byLane[lane].push(rule.id);
    }
  }

  return laneOrder.slice(0, laneCount).map((lane) => ({
    lane,
    cardIds: byLane[lane],
  }));
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
 *
 * v2 迁移：从 data/cards/rules/*.json 加载规则（不含本地化文案），
 * 通过 @dev-camcard/schemas 的 loadRuleBatch 获取 CardRuleData[]。
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

    // 用引擎纯函数构造真实市场状态（每栏公开 2 张，其余入隐藏牌堆，已洗牌）
    const laneDefinitions = buildLaneDefinitions(marketRules, ruleset.marketLanesCount);
    const market = createMarketState(laneDefinitions, ruleset.marketSlotsPerLane, this.genId);
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
