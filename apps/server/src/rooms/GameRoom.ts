import { Room, Client } from "colyseus";
import * as path from "path";
import * as fs from "fs";
import { EVT } from "@dev-camcard/protocol";
import type { ClientCommand, PlayerSide, MatchEvent, MatchSnapshot, MatchEventLog } from "@dev-camcard/protocol";
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
  assertRulesetDef,
  type CardRuleData,
} from "@dev-camcard/schemas";
import { getPrisma } from "../prisma";
import { Prisma } from "@prisma/client";

// ── 数据加载（模块级，仅执行一次）────────────────────────────────────────────

// __dirname 在 dev (tsx) 和 prod (dist/) 下均指向 src/rooms 或 dist/rooms，
// 均距项目根目录 4 层，所以统一用 "../../../../"。
const DATA_ROOT = path.resolve(__dirname, "../../../../");

// v2 规则数据：从 data/cards/rules/ 加载，不含本地化文案
const CONTENT_SETS = [
  "data/cards/rules/starter.json",
  "data/cards/rules/fixed-supplies.json",
  "data/cards/rules/market-core.json",
  "data/cards/rules/status.json",
];

const allRules: CardRuleData[] = loadRuleBatch(DATA_ROOT, CONTENT_SETS);

// ruleset：从 data/rulesets/ 加载，并通过 AJV 校验
function loadJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}

const RULESET_FILE = "data/rulesets/core-v1.json";
const rulesetRaw: unknown = loadJson(RULESET_FILE);
assertRulesetDef(rulesetRaw);
const ruleset = rulesetRaw as RulesetConfig;

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

/** 断线重连超时（秒）— 60 秒内重连即可恢复 */
const RECONNECTION_TIMEOUT_SECS = 60;

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
 *
 * 持久化：对局开始时写 Match + MatchPlayer，事件逐条落库，结束时写 winner/endedAt。
 * 所有 DB 操作均 fire-and-forget（不阻塞游戏逻辑，错误仅 log）。
 */
export class GameRoom extends Room {
  maxClients = 2;

  private matchState!: InternalMatchState;
  /** sessionId → 席位 */
  private sideMap = new Map<string, PlayerSide>();
  /** 房间内 UUID 计数器（简单递增，测试友好） */
  private idCounter = 0;
  private genId = () => `room-${this.roomId}-${++this.idCounter}`;

  // ── 事件日志 ─────────────────────────────────────────────────────────────────
  private matchEvents: MatchEvent[] = [];
  private matchSnapshot!: MatchSnapshot;
  private eventSeq = 0;

  // ── DB 写入状态 ───────────────────────────────────────────────────────────────
  /** DB 创建成功后置 true，防止重复写入 MATCH_END */
  private dbMatchCreated = false;
  /** 对局结束事件是否已持久化 */
  private dbMatchEnded = false;

  private pushEvent(type: string, side?: PlayerSide, data?: Record<string, unknown>): void {
    this.matchEvents.push({ seq: this.eventSeq++, ts: Date.now(), type, side, data });
  }

  onCreate(_options: unknown): void {
    const baseState = createMatchState(this.roomId, ruleset, ["玩家一", "玩家二"], this.genId);

    // 用引擎纯函数构造真实市场状态（每栏公开 2 张，其余入隐藏牌堆，已洗牌）
    const laneDefinitions = buildLaneDefinitions(marketRules, ruleset.marketLanesCount);
    const market = createMarketState(laneDefinitions, ruleset.marketSlotsPerLane, this.genId);
    this.matchState = { ...baseState, market };

    // 初始化快照元数据
    this.matchSnapshot = {
      matchId: this.roomId,
      rulesetVersion: RULESET_FILE.replace("data/rulesets/", "").replace(".json", ""),
      contentSets: CONTENT_SETS.map((p) => p.split("/").pop()!.replace(".json", "")),
      startedAt: Date.now(),
    };

    // 记录对局开始事件
    this.pushEvent("MATCH_START");

    // ── 持久化：写 Match 记录（players 在 onJoin 时追加）────────────────────
    this.dbCreateMatch().catch((err) =>
      console.error("[GameRoom][DB] 创建 Match 失败:", err)
    );

    // 统一消息处理器：客户端发 { type: CMD.*, ...payload }
    this.onMessage("*", (client: Client, type: string | number, message: unknown) => {
      const side = this.sideMap.get(client.sessionId);
      if (side === undefined) return;

      const command = { type: String(type), ...(message as object) } as ClientCommand;

      try {
        const prevState = this.matchState;
        this.matchState = reduce(this.matchState, side, command, ENGINE_CONFIG);

        // 记录事件（精简 payload）
        this.recordCommandEvent(command, side, prevState);

        this.broadcastState();
      } catch (err) {
        client.send("error", { message: (err as Error).message });
      }
    });

    // 客户端可请求事件日志（重连后同步 or 回放入口）
    this.onMessage("REQUEST_MATCH_EVENTS", (client: Client) => {
      this.sendEventLog(client);
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

      // 持久化玩家信息
      const playerName = opts.playerName ?? `玩家${side + 1}`;
      this.dbUpsertPlayer(side, playerName).catch((err) =>
        console.error("[GameRoom][DB] upsert MatchPlayer 失败:", err)
      );
    }

    console.log(`[GameRoom] 玩家加入: ${client.sessionId} (side=${side})`);

    // 向新加入的客户端发送当前快照
    client.send(EVT.STATE_UPDATE, toPublicMatchView(this.matchState));
    if (side === 0 || side === 1) {
      client.send(EVT.PRIVATE_UPDATE, toPrivatePlayerView(this.matchState, side));
    }
    // 同步事件日志
    this.sendEventLog(client);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const side = this.sideMap.get(client.sessionId);
    console.log(`[GameRoom] 玩家断线: ${client.sessionId} (side=${side}, consented=${consented})`);

    if (consented) {
      // 主动离开：立即清理
      this.sideMap.delete(client.sessionId);
      return;
    }

    // 非主动断线：允许 60 秒内重连
    try {
      await this.allowReconnection(client, RECONNECTION_TIMEOUT_SECS);
      // 重连成功：重新发送当前状态
      console.log(`[GameRoom] 玩家重连成功: ${client.sessionId} (side=${side})`);
      client.send(EVT.STATE_UPDATE, toPublicMatchView(this.matchState));
      if (side === 0 || side === 1) {
        client.send(EVT.PRIVATE_UPDATE, toPrivatePlayerView(this.matchState, side));
      }
      // 同步事件日志（让客户端恢复 pendingChoice 等状态）
      this.sendEventLog(client);
    } catch {
      // 超时未重连：清理席位
      console.log(`[GameRoom] 重连超时，清理席位: ${client.sessionId}`);
      this.sideMap.delete(client.sessionId);
    }
  }

  onDispose(): void {
    // 记录对局结束
    this.pushEvent("MATCH_END");
    // 若对局已经有结果，持久化 endedAt + winner
    if (!this.dbMatchEnded && this.dbMatchCreated) {
      this.dbEndMatch(this.matchState.winner ?? null).catch((err) =>
        console.error("[GameRoom][DB] endMatch 失败:", err)
      );
    }
    console.log(`[GameRoom] 房间销毁: ${this.roomId}, 事件总数: ${this.matchEvents.length}`);
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

  private sendEventLog(client: Client): void {
    const log: MatchEventLog = {
      snapshot: this.matchSnapshot,
      events: this.matchEvents,
    };
    client.send(EVT.MATCH_EVENTS, log);
  }

  /**
   * 为已执行成功的命令记录事件（精简 payload，不存完整状态）。
   */
  private recordCommandEvent(
    command: ClientCommand,
    side: PlayerSide,
    _prevState: InternalMatchState
  ): void {
    const type = command.type;
    const baseData: Record<string, unknown> = {};

    // 按命令类型提取最小字段
    const cmd = command as unknown as Record<string, unknown>;
    if ("instanceId" in cmd) baseData["instanceId"] = cmd["instanceId"];
    if ("cardId" in cmd) baseData["cardId"] = cmd["cardId"];
    if ("slotIndex" in cmd) baseData["slotIndex"] = cmd["slotIndex"];
    if ("selectedInstanceIds" in cmd) baseData["selectedInstanceIds"] = cmd["selectedInstanceIds"];
    if (type === "ASSIGN_ATTACK" && "assignments" in cmd) {
      baseData["assignments"] = cmd["assignments"];
    }

    const data = Object.keys(baseData).length > 0 ? baseData : undefined;
    this.pushEvent(type, side, data);

    // ── 持久化事件 ──────────────────────────────────────────────────────────
    const evt = this.matchEvents[this.matchEvents.length - 1];
    this.dbWriteEvent(evt).catch((err) =>
      console.error("[GameRoom][DB] 写入事件失败:", err)
    );

    // 若对局已结束，记录 MATCH_END 并持久化
    if (this.matchState.ended && this.matchEvents[this.matchEvents.length - 1]?.type !== "MATCH_END") {
      this.pushEvent("MATCH_END", undefined, { winner: this.matchState.winner });
      const endEvt = this.matchEvents[this.matchEvents.length - 1];
      this.dbWriteEvent(endEvt).catch((err) =>
        console.error("[GameRoom][DB] 写入 MATCH_END 事件失败:", err)
      );
      if (!this.dbMatchEnded && this.dbMatchCreated) {
        this.dbMatchEnded = true;
        this.dbEndMatch(this.matchState.winner ?? null).catch((err) =>
          console.error("[GameRoom][DB] endMatch 失败:", err)
        );
      }
    }
  }

  // ── DB 操作（fire-and-forget，不阻塞游戏逻辑）──────────────────────────────

  private async dbCreateMatch(): Promise<void> {
    const prisma = getPrisma();
    await prisma.match.create({
      data: {
        id: this.roomId,
        rulesetVersion: this.matchSnapshot.rulesetVersion,
        contentSets: this.matchSnapshot.contentSets,
        startedAt: new Date(this.matchSnapshot.startedAt),
      },
    });
    this.dbMatchCreated = true;
  }

  private async dbUpsertPlayer(side: PlayerSide, name: string): Promise<void> {
    if (!this.dbMatchCreated) return; // Match 尚未落库，跳过（极低概率竞争）
    const prisma = getPrisma();
    await prisma.matchPlayer.upsert({
      where: { matchId_side: { matchId: this.roomId, side } },
      create: { matchId: this.roomId, side, name },
      update: { name },
    });
  }

  private async dbWriteEvent(evt: MatchEvent): Promise<void> {
    if (!this.dbMatchCreated) return; // 等待 match 落库
    const prisma = getPrisma();
    await prisma.matchEvent.create({
      data: {
        matchId: this.roomId,
        seq: evt.seq,
        ts: BigInt(evt.ts),
        type: evt.type,
        side: evt.side ?? null,
        data: evt.data != null ? (evt.data as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  private async dbEndMatch(winner: number | null): Promise<void> {
    const prisma = getPrisma();
    await prisma.match.update({
      where: { id: this.roomId },
      data: {
        endedAt: new Date(),
        winner,
      },
    });
  }
}
