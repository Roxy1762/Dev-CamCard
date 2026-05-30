import { Room, Client } from "colyseus";
import { EVT } from "@dev-camcard/protocol";
import type {
  ClientCommand,
  PlayerSide,
  MatchEvent,
  MatchSnapshot,
  MatchEventLog,
} from "@dev-camcard/protocol";
import {
  buildReplayInitialState,
  hashStringToSeed,
  reduce,
  toPublicMatchView,
  toPrivatePlayerView,
} from "@dev-camcard/engine";
import type { InternalMatchState } from "@dev-camcard/engine";
import { getPrisma } from "../prisma";
import { Prisma } from "@prisma/client";
// 内容（规则 / ruleset / 引擎配置 / lane 定义）由 content.ts 统一加载，
// 与只读回放端点共用同一份，确保 live 与回放重建逐字节一致。
import {
  ruleset,
  ENGINE_CONFIG,
  laneDefinitions,
  RULESET_VERSION,
  CONTENT_SET_NAMES,
} from "../content";

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

  // ── 事件日志 ─────────────────────────────────────────────────────────────────
  private matchEvents: MatchEvent[] = [];
  private matchSnapshot!: MatchSnapshot;
  private eventSeq = 0;

  // ── DB 写入状态 ───────────────────────────────────────────────────────────────
  /** Match 创建流程（用于串行等待，避免 join/event 提前到达时丢记录） */
  private dbCreatePromise: Promise<void> | null = null;
  /** Match 是否已成功落库 */
  private dbMatchCreated = false;
  /** Match 是否已写入 endedAt/winner */
  private dbMatchEnded = false;
  /** 防止多处并发重复执行 endMatch */
  private dbEndPromise: Promise<void> | null = null;

  private pushEvent(type: string, side?: PlayerSide, data?: Record<string, unknown>): MatchEvent {
    const evt: MatchEvent = { seq: this.eventSeq++, ts: Date.now(), type, side, data };
    this.matchEvents.push(evt);
    return evt;
  }

  onCreate(options: unknown): void {
    const opts = (options ?? {}) as { seed?: number | string };
    const seedInput = opts.seed ?? this.roomId;
    const initialSeed =
      typeof seedInput === "string" ? hashStringToSeed(seedInput) : (seedInput | 0) >>> 0;

    // 与 replay.ts 共用同一条初始化路径，确保 live 与回放重建逐字节一致。
    this.matchState = buildReplayInitialState({
      roomId: this.roomId,
      ruleset,
      playerNames: ["玩家一", "玩家二"],
      initialSeed,
      laneDefinitions,
    });

    // 初始化快照元数据（含 seed，供回放重建使用）
    this.matchSnapshot = {
      matchId: this.roomId,
      rulesetVersion: RULESET_VERSION,
      contentSets: CONTENT_SET_NAMES,
      startedAt: Date.now(),
      initialSeed,
    };

    // 记录对局开始事件
    this.pushEvent("MATCH_START");

    // ── 持久化：写 Match 记录（players 在 onJoin 时追加）────────────────────
    this.dbCreatePromise = this.dbCreateMatch().catch((err) => {
      console.error("[GameRoom][DB] 创建 Match 失败:", err);
    });

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
      void this.dbUpsertPlayer(side, playerName).catch((err) =>
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
    const endEvt = this.pushMatchEndOnce({ winner: this.matchState.winner ?? null });
    if (endEvt) {
      void this.dbWriteEvent(endEvt).catch((err) =>
        console.error("[GameRoom][DB] 写入 MATCH_END 事件失败:", err)
      );
    }

    void this.dbEndMatch(this.matchState.winner ?? null).catch((err) =>
      console.error("[GameRoom][DB] endMatch 失败:", err)
    );

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

  private hasRecordedMatchEnd(): boolean {
    return this.matchEvents.some((evt) => evt.type === "MATCH_END");
  }

  private pushMatchEndOnce(data?: Record<string, unknown>): MatchEvent | null {
    if (this.hasRecordedMatchEnd()) {
      return null;
    }
    return this.pushEvent("MATCH_END", undefined, data);
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
    const evt = this.pushEvent(type, side, data);

    // ── 持久化事件 ──────────────────────────────────────────────────────────
    void this.dbWriteEvent(evt).catch((err) =>
      console.error("[GameRoom][DB] 写入事件失败:", err)
    );

    // 若对局已结束，记录 MATCH_END 并持久化
    if (this.matchState.ended) {
      const endEvt = this.pushMatchEndOnce({ winner: this.matchState.winner ?? null });
      if (endEvt) {
        void this.dbWriteEvent(endEvt).catch((err) =>
          console.error("[GameRoom][DB] 写入 MATCH_END 事件失败:", err)
        );
      }

      void this.dbEndMatch(this.matchState.winner ?? null).catch((err) =>
        console.error("[GameRoom][DB] endMatch 失败:", err)
      );
    }
  }

  // ── DB 操作（fire-and-forget，不阻塞游戏逻辑）──────────────────────────────

  private async ensureDbMatchCreated(): Promise<boolean> {
    if (this.dbMatchCreated) return true;
    if (!this.dbCreatePromise) return false;
    await this.dbCreatePromise;
    return this.dbMatchCreated;
  }

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
    if (!(await this.ensureDbMatchCreated())) return;
    const prisma = getPrisma();
    await prisma.matchPlayer.upsert({
      where: { matchId_side: { matchId: this.roomId, side } },
      create: { matchId: this.roomId, side, name },
      update: { name },
    });
  }

  private async dbWriteEvent(evt: MatchEvent): Promise<void> {
    if (!(await this.ensureDbMatchCreated())) return;
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
    if (this.dbMatchEnded) return;
    if (this.dbEndPromise) {
      await this.dbEndPromise;
      return;
    }

    this.dbEndPromise = (async () => {
      if (!(await this.ensureDbMatchCreated())) return;
      const prisma = getPrisma();
      await prisma.match.update({
        where: { id: this.roomId },
        data: {
          endedAt: new Date(),
          winner,
        },
      });
      this.dbMatchEnded = true;
    })();

    try {
      await this.dbEndPromise;
    } finally {
      this.dbEndPromise = null;
    }
  }
}
