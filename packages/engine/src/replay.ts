/**
 * replay.ts — 对局回放重建（纯函数）。
 *
 * 目的（docs/roadmap-next.md P0-4 的基础设施层）：
 *   把"事件日志查看器"升级为"逐事件重建播放器"前，先把可复用的最小核心抽出来：
 *     - buildReplayInitialState：基于 snapshot.initialSeed 重建对局的初始 InternalMatchState
 *       —— 与 GameRoom.onCreate 同一条 createSeededMatchState + createMarketState 路径。
 *     - reconstructCommand：把单条 MatchEvent（type + data）还原为可被 reduce 消费的
 *       ClientCommand。
 *     - replayFromEvents：以 initialState 为起点，按事件流逐步推进，输出每步快照与错误清单。
 *
 * 设计约束（与 non-negotiables.md 对齐）：
 *  - 纯函数：无 IO，所有输入显式传入，可单独测试。
 *  - 错误隔离：单条事件 reduce 抛错不会中断整个回放，会把错误记录到 errors[] 并以
 *    "上一帧 state" 继续推进，便于诊断"最早开始偏差的位置"。
 *  - 输入兼容：不识别的 event.type（含 MATCH_START / MATCH_END 等系统标签）只在
 *    回放轨迹中占据一帧（state = 上一帧），不调用 reduce。
 *
 * 这一层只暴露"如何重建状态"，不暴露具体 UI；
 * 渲染层（客户端 HtmlGameView 或 server-side snapshot 接口）独立消费。
 */

import type { ClientCommand, AttackAssignment, MatchEvent, Lane, PlayerSide } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { InternalMatchState } from "./types";
import { reduce, type EngineConfig } from "./reduce";
import {
  createSeededMatchState,
  createMarketState,
  type RulesetConfig,
} from "./init";

/**
 * 系统事件类型集合。
 * 这些事件由 server 写入，但不对应任何 ClientCommand —— 回放过程仅作为占位帧通过。
 */
export const SYSTEM_EVENT_TYPES: ReadonlySet<string> = new Set(["MATCH_START", "MATCH_END"]);

/** 回放过程中的一帧（与单条 event 一一对应） */
export interface ReplayStep {
  /** 原始事件（来自 server 落库 / 内存日志） */
  event: MatchEvent;
  /**
   * 应用该事件 *之后* 的内部状态：
   *  - 系统事件：复用上一帧（不调用 reduce）
   *  - 命令事件：reduce 的返回值
   *  - 命令事件出错：复用上一帧 state，并在 error 字段记录信息
   */
  state: InternalMatchState;
  /** 若该步出错，此字段为人类可读的错误描述；否则为 undefined */
  error?: string;
}

/** 回放执行的整体结果 */
export interface ReplayResult {
  /** 与 events 一一对应的逐帧记录 */
  steps: ReplayStep[];
  /** 末帧 state（便于直接消费） */
  finalState: InternalMatchState;
  /** 所有出错事件的简要清单（与 steps[].error 一致） */
  errors: Array<{ seq: number; type: string; message: string }>;
}

/** buildReplayInitialState 的输入参数 */
export interface ReplaySetup {
  roomId: string;
  ruleset: RulesetConfig;
  playerNames: [string, string];
  /** 对局初始 seed —— 来自 MatchSnapshot.initialSeed */
  initialSeed: number;
  /**
   * 市场每栏的 cardId 列表（已展开 rarity copies）。
   * 由调用方（server）按内容数据计算，传入与原对局一致的内容。
   */
  laneDefinitions: Array<{ lane: Lane; cardIds: string[] }>;
}

/**
 * buildReplayInitialState — 重建对局的初始 InternalMatchState。
 *
 * 该函数与 GameRoom.onCreate 的对局初始化路径严格一致：
 *   1. createSeededMatchState(roomId, ruleset, playerNames, initialSeed)
 *   2. createMarketState(laneDefinitions, marketSlotsPerLane, genId, () => rng.next())
 *   3. 把推进后的 rng.state() / counter() 写回 state
 *
 * 只要调用方提供同样的 ruleset / playerNames / initialSeed / laneDefinitions，
 * 就能得到与原对局逐字节一致的初始状态，从而保证后续 reduce 流的可复现性。
 */
export function buildReplayInitialState(setup: ReplaySetup): InternalMatchState {
  const { state: baseState, rng, genId, counter } = createSeededMatchState(
    setup.roomId,
    setup.ruleset,
    setup.playerNames,
    setup.initialSeed
  );

  const market = createMarketState(
    setup.laneDefinitions,
    setup.ruleset.marketSlotsPerLane,
    genId,
    () => rng.next()
  );

  return {
    ...baseState,
    market,
    rngState: rng.state(),
    idCounter: counter(),
  };
}

/**
 * reconstructCommand — 把 MatchEvent 还原为可被 reduce 消费的 ClientCommand。
 *
 * 服务端 recordCommandEvent 落库的精简字段约定：
 *   instanceId / cardId / slotIndex / selectedInstanceIds / assignments
 *
 * 我们按命令类型从 event.data 中挑选对应字段。
 *  - 系统事件（MATCH_START / MATCH_END）与未知 type：返回 null（不可重放）。
 *  - playerName 在 READY 时不被记录；按 createSeededMatchState 默认值播放即可（不影响规则）。
 */
export function reconstructCommand(event: MatchEvent): ClientCommand | null {
  if (SYSTEM_EVENT_TYPES.has(event.type)) return null;

  const data = (event.data ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case CMD.READY:
      return { type: CMD.READY };
    case CMD.CONCEDE:
      return { type: CMD.CONCEDE };
    case CMD.END_TURN:
      return { type: CMD.END_TURN };
    case CMD.BUY_RESERVED_CARD:
      return { type: CMD.BUY_RESERVED_CARD };
    case CMD.PLAY_CARD:
      return { type: CMD.PLAY_CARD, instanceId: String(data["instanceId"] ?? "") };
    case CMD.PUT_CARD_TO_SCHEDULE:
      return {
        type: CMD.PUT_CARD_TO_SCHEDULE,
        instanceId: String(data["instanceId"] ?? ""),
        slotIndex: Number(data["slotIndex"] ?? 0),
      };
    case CMD.ACTIVATE_VENUE:
      return { type: CMD.ACTIVATE_VENUE, instanceId: String(data["instanceId"] ?? "") };
    case CMD.RESERVE_MARKET_CARD:
      return { type: CMD.RESERVE_MARKET_CARD, instanceId: String(data["instanceId"] ?? "") };
    case CMD.BUY_MARKET_CARD:
      return { type: CMD.BUY_MARKET_CARD, instanceId: String(data["instanceId"] ?? "") };
    case CMD.BUY_FIXED_SUPPLY:
      return { type: CMD.BUY_FIXED_SUPPLY, cardId: String(data["cardId"] ?? "") };
    case CMD.ASSIGN_ATTACK: {
      const raw = data["assignments"];
      const assignments: AttackAssignment[] = Array.isArray(raw)
        ? (raw as AttackAssignment[])
        : [];
      return { type: CMD.ASSIGN_ATTACK, assignments };
    }
    case CMD.SUBMIT_CHOICE: {
      const raw = data["selectedInstanceIds"];
      const selected: string[] = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
      return { type: CMD.SUBMIT_CHOICE, selectedInstanceIds: selected };
    }
    default:
      return null;
  }
}

/**
 * replayFromEvents — 从给定初始状态出发，按事件流逐步重建对局快照。
 *
 * 行为约定：
 *  - 系统事件（MATCH_START / MATCH_END）不调用 reduce，state 沿用前一帧。
 *  - 命令事件按 event.side 与 event.data 还原为 ClientCommand 并调用 reduce。
 *  - 任意一帧失败会被记录到 errors 与 step.error，但 *不会中断* 流程：
 *    后续 step 仍以上一帧成功的 state 继续推进，便于定位首个出错点。
 *
 * 这是 docs/roadmap-next.md P0-4 的核心原语：上层 UI 拿到 ReplayResult.steps
 * 后即可实现"步进 / 自动播放 / 跳转"型回放器，无须再在 UI 侧维护规则。
 */
export function replayFromEvents(
  initialState: InternalMatchState,
  events: ReadonlyArray<MatchEvent>,
  config: EngineConfig
): ReplayResult {
  const steps: ReplayStep[] = [];
  const errors: ReplayResult["errors"] = [];
  let currentState = initialState;

  for (const event of events) {
    if (SYSTEM_EVENT_TYPES.has(event.type)) {
      steps.push({ event, state: currentState });
      continue;
    }

    const command = reconstructCommand(event);
    if (!command) {
      const message = `未知事件类型: ${event.type}`;
      errors.push({ seq: event.seq, type: event.type, message });
      steps.push({ event, state: currentState, error: message });
      continue;
    }

    if (event.side !== 0 && event.side !== 1) {
      const message = `命令事件缺少 side: ${event.type}`;
      errors.push({ seq: event.seq, type: event.type, message });
      steps.push({ event, state: currentState, error: message });
      continue;
    }

    try {
      const nextState = reduce(currentState, event.side as PlayerSide, command, config);
      currentState = nextState;
      steps.push({ event, state: currentState });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ seq: event.seq, type: event.type, message });
      steps.push({ event, state: currentState, error: message });
    }
  }

  return {
    steps,
    finalState: currentState,
    errors,
  };
}
