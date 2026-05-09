/**
 * htmlGameView.ts — HTML/CSS 游戏视图控制器（替换原 Phaser RoomScene）。
 *
 * 为什么从 Phaser 切到 HTML？
 *  - Phaser 在 canvas 上手动叠 text + 矩形，每次 rebuildUI 要 destroy 几十个对象
 *    再重建；高频的 state_update / private_update / match_events 同时触发会出现
 *    布局重叠 / 文字叠加 / 子像素糊化等问题。CSS Grid + 浏览器原生文字渲染从
 *    根上消除这些 bug。
 *  - 文字清晰度：浏览器对系统字体永远做 subpixel hinting；canvas 文字纹理在
 *    高 DPI 屏靠 setResolution 烘焙，子像素仍然糊。
 *  - 房号气泡跟 Phaser 内"房间:"文本重复显示：HTML 版直接用顶部 header 的
 *    .room-pill 一处渲染，不再有两条信息源。
 *
 * 数据流：
 *   RoomClient → onStateUpdate / onPrivateUpdate / onEventLog / onError
 *      ↓
 *   HtmlGameView.applyState() → 仅更新需要变化的 DOM 节点
 *      ↓
 *   用户点击 button → 直接 send() Command 到服务端
 *
 * 渲染策略：
 *  - 顶部 / 玩家信息 / 商店 / 手牌 / 操作栏 / 事件日志，各分区独立 render*()
 *  - 每次 applyState 全量重绘当前分区（DOM 量小，diff 没必要）
 *  - 模态弹层（设置 / 选择 / 回放）独立管理 open/close 状态
 */

import type {
  PublicMatchView,
  PrivatePlayerView,
  PublicCardRef,
  PendingChoiceView,
  MatchEvent,
  MatchEventLog,
} from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";
import {
  buildBoardViewModel,
  type BoardViewModel,
} from "../viewmodel/BoardViewModel";
import type { CardTextEntry } from "../content/clientLocale";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
  type ClientSettings,
} from "../settings/clientSettings";
import { copyTextToClipboard } from "../lobby/roomBadge";

export interface HtmlGameViewOptions {
  roomClient: RoomClient;
  cardNames?: ReadonlyMap<string, string>;
  cardTexts?: ReadonlyMap<string, CardTextEntry>;
  /** 已挂载的 DOM 根元素（默认查 #game-view）。注入便于测试。 */
  root?: HTMLElement;
  /** 进入对局后的连接模式，影响等待文案。 */
  mode?: "quick" | "create" | "join";
}

/** 将命令负载序列化成简洁字符串，给事件日志条用。 */
function summarizeEvent(evt: MatchEvent): string {
  const sideLabel = evt.side !== undefined ? `P${evt.side + 1}` : "·";
  return `[${sideLabel}] ${evt.type}`;
}

/**
 * 构造 HtmlGameView 的所有 DOM 引用集合 — 一处集中查找，避免散落的
 * document.getElementById 散在各 render 方法里出错难排查。
 */
interface DomRefs {
  view: HTMLElement;
  roomId: HTMLElement;
  roomCopy: HTMLButtonElement;
  turnStatus: HTMLElement;
  settingsToggle: HTMLButtonElement;
  error: HTMLElement;
  opp: HTMLElement;
  me: HTMLElement;
  market: HTMLElement;
  fixed: HTMLElement;
  handCount: HTMLElement;
  hand: HTMLElement;
  actionBar: HTMLElement;
  events: HTMLElement;
  replayBtn: HTMLButtonElement;
  settingsModal: HTMLElement;
  shopPreviewToggle: HTMLInputElement;
  settingsClose: HTMLButtonElement;
  choiceModal: HTMLElement;
  choiceTitle: HTMLElement;
  choiceMeta: HTMLElement;
  choiceCandidates: HTMLElement;
  choiceStatus: HTMLElement;
  choiceActions: HTMLElement;
  replayModal: HTMLElement;
  replayBody: HTMLElement;
  replayClose: HTMLButtonElement;
  endBanner: HTMLElement;
}

function readDom(root: HTMLElement): DomRefs {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`[htmlGameView] 缺少 DOM 元素 #${id}`);
    return el;
  };
  return {
    view: root,
    roomId: $("g-room-id"),
    roomCopy: $<HTMLButtonElement>("g-room-copy"),
    turnStatus: $("g-turn-status"),
    settingsToggle: $<HTMLButtonElement>("g-settings-toggle"),
    error: $("g-error"),
    opp: $("g-opp"),
    me: $("g-me"),
    market: $("g-market"),
    fixed: $("g-fixed-supplies"),
    handCount: $("g-hand-count"),
    hand: $("g-hand"),
    actionBar: $("g-action-bar"),
    events: $("g-events"),
    replayBtn: $<HTMLButtonElement>("g-replay-btn"),
    settingsModal: $("g-settings-modal"),
    shopPreviewToggle: $<HTMLInputElement>("g-shop-preview"),
    settingsClose: $<HTMLButtonElement>("g-settings-close"),
    choiceModal: $("g-choice-modal"),
    choiceTitle: $("g-choice-title"),
    choiceMeta: $("g-choice-meta"),
    choiceCandidates: $("g-choice-candidates"),
    choiceStatus: $("g-choice-status"),
    choiceActions: $("g-choice-actions"),
    replayModal: $("g-replay-modal"),
    replayBody: $("g-replay-body"),
    replayClose: $<HTMLButtonElement>("g-replay-close"),
    endBanner: $("g-end-banner"),
  };
}

export class HtmlGameView {
  private readonly client: RoomClient;
  private readonly cardNames?: ReadonlyMap<string, string>;
  private readonly cardTexts?: ReadonlyMap<string, CardTextEntry>;
  private readonly dom: DomRefs;

  private view: PublicMatchView | null = null;
  private privateView: PrivatePlayerView | null = null;
  private recentEvents: MatchEvent[] = [];
  private settings: ClientSettings;
  private unsubscribeSettings: (() => void) | null = null;

  /** 选择模式：玩家在选择面板里点过的实例 ID 集合。 */
  private choiceSelected = new Set<string>();

  /** 顶部错误提示自动消失计时器。 */
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  /** 防止重复请求事件日志。 */
  private replayLoading = false;

  constructor(opts: HtmlGameViewOptions) {
    this.client = opts.roomClient;
    this.cardNames = opts.cardNames;
    this.cardTexts = opts.cardTexts;

    const root =
      opts.root ?? (document.getElementById("game-view") as HTMLElement | null);
    if (!root) {
      throw new Error("[htmlGameView] 找不到 #game-view 容器");
    }
    this.dom = readDom(root);
    this.settings = getSettings();

    this.bindStaticEvents();
  }

  /**
   * 启动游戏视图：显示 #game-view，订阅 RoomClient 事件，开始接收状态。
   */
  start(): void {
    document.getElementById("lobby")?.classList.add("hidden");
    this.dom.view.classList.remove("hidden");

    // 初始房号渲染（client 此时已 connected，roomId 可读）
    const rid = this.client.roomId ?? "";
    this.dom.roomId.textContent = rid;
    this.dom.turnStatus.textContent = "已连接，等待对局开始...";

    // 订阅设置变更（商店预览开关）
    this.unsubscribeSettings = subscribeSettings((s) => {
      this.settings = s;
      this.dom.shopPreviewToggle.checked = s.showShopPreview;
      this.renderAll();
    });
    this.dom.shopPreviewToggle.checked = this.settings.showShopPreview;

    // 订阅 RoomClient 推送
    this.client.onStateUpdate = (v) => {
      this.view = v;
      this.renderAll();
    };
    this.client.onPrivateUpdate = (pv) => {
      this.privateView = pv;
      this.renderAll();
    };
    this.client.onEventLog = (log) => {
      this.recentEvents = log.events.slice(-8);
      this.renderEvents();
    };
    this.client.onError = (msg) => this.showError(msg);
  }

  /** 销毁视图（场景切换时主动调用，断开订阅、清理 timer）。 */
  destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    this.client.onStateUpdate = null;
    this.client.onPrivateUpdate = null;
    this.client.onEventLog = null;
    this.client.onError = null;
  }

  // ── 事件绑定（一次性、与状态无关）─────────────────────────────────────────

  private bindStaticEvents(): void {
    this.dom.roomCopy.addEventListener("click", () => {
      const rid = this.dom.roomId.textContent ?? "";
      if (!rid) return;
      void copyTextToClipboard(rid).then((ok) => {
        if (ok) {
          this.dom.roomCopy.textContent = "✓ 已复制";
          this.dom.roomCopy.classList.add("copied");
          setTimeout(() => {
            this.dom.roomCopy.textContent = "📋 复制";
            this.dom.roomCopy.classList.remove("copied");
          }, 1600);
        } else {
          this.showError("复制失败，请手动选中房号");
        }
      });
    });

    this.dom.settingsToggle.addEventListener("click", () => {
      this.dom.settingsModal.classList.remove("hidden");
    });
    this.dom.settingsClose.addEventListener("click", () => {
      this.dom.settingsModal.classList.add("hidden");
    });
    this.dom.settingsModal.addEventListener("click", (e) => {
      if (e.target === this.dom.settingsModal) {
        this.dom.settingsModal.classList.add("hidden");
      }
    });
    this.dom.shopPreviewToggle.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      updateSettings({ showShopPreview: checked });
    });

    this.dom.replayBtn.addEventListener("click", () => {
      void this.openReplay();
    });
    this.dom.replayClose.addEventListener("click", () => {
      this.dom.replayModal.classList.add("hidden");
    });
    this.dom.replayModal.addEventListener("click", (e) => {
      if (e.target === this.dom.replayModal) {
        this.dom.replayModal.classList.add("hidden");
      }
    });
  }

  // ── 错误提示 ────────────────────────────────────────────────────────────────

  private showError(message: string): void {
    this.dom.error.textContent = message;
    this.dom.error.classList.remove("hidden");
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.dom.error.classList.add("hidden");
      this.errorTimer = null;
    }, 2800);
  }

  // ── 全量重绘入口 ────────────────────────────────────────────────────────────

  private renderAll(): void {
    if (!this.view || !this.privateView) return;
    const vm = buildBoardViewModel(
      this.view,
      this.privateView,
      this.cardNames,
      this.cardTexts
    );
    if (!vm.pendingChoice) {
      this.choiceSelected.clear();
    }

    this.renderHeader(vm);
    this.renderPlayer(this.dom.opp, vm.opp, vm, false);
    this.renderPlayer(this.dom.me, vm.me, vm, true);
    this.renderMarket(vm);
    this.renderFixedSupplies(vm);
    this.renderHand(vm);
    this.renderActionBar(vm);
    this.renderEvents();
    this.renderEndBanner(vm);
    this.renderChoice(vm);
  }

  // ── 顶部信息栏 ────────────────────────────────────────────────────────────

  private renderHeader(vm: BoardViewModel): void {
    this.dom.roomId.textContent = vm.roomId;

    const turnDesc = vm.ended
      ? `对局结束 · 胜者: 玩家${(vm.winner ?? 0) + 1}`
      : vm.started
      ? `第 ${vm.turnNumber} 回合 · ${vm.isMyTurn ? "● 我的回合" : "○ 等待对方"}`
      : "等待双方 READY...";
    this.dom.turnStatus.textContent = turnDesc;
    this.dom.turnStatus.classList.toggle("my-turn", vm.isMyTurn);

    this.dom.settingsToggle.textContent = this.settings.showShopPreview
      ? "⚙ 设置 · 预览开"
      : "⚙ 设置 · 预览关";
    this.dom.settingsToggle.classList.toggle(
      "preview-off",
      !this.settings.showShopPreview
    );
  }

  // ── 玩家卡片（对方 / 我方共用）──────────────────────────────────────────

  private renderPlayer(
    el: HTMLElement,
    p: BoardViewModel["me"] | BoardViewModel["opp"],
    vm: BoardViewModel,
    isMe: boolean
  ): void {
    const header = el.querySelector(".pc-header")!;
    header.querySelector(".tag")!.textContent = `[玩家${p.side + 1}]`;
    header.querySelector(".name")!.textContent = p.name;

    const vitals = el.querySelector(".vitals") as HTMLElement;
    vitals.innerHTML = "";
    vitals.appendChild(
      makeStat("HP", p.hp, isMe ? "hp" : "hp")
    );
    vitals.appendChild(makeStat("防备", p.block, "block"));
    if (!isMe) {
      vitals.appendChild(makeStat("手牌", p.handSize, "hand-size"));
      vitals.appendChild(makeStat("牌堆", p.deckSize, "deck-size"));
    }

    if (isMe) {
      const res = el.querySelector(".resources") as HTMLElement;
      res.innerHTML = "";
      res.appendChild(makeStat("资源", p.resourcePool, "res"));
      res.appendChild(makeStat("攻击", p.attackPool, "atk"));
      res.appendChild(makeStat("牌堆", p.deckSize, "deck-size"));
      res.appendChild(makeStat("弃", p.discardSize, "discard"));
    }

    // 场馆区
    const venues = el.querySelector(".venues") as HTMLElement;
    venues.innerHTML = "";
    if (p.venues.length === 0) {
      venues.style.display = "none";
    } else {
      venues.style.display = "flex";
      const oppHasGuard = !isMe && p.venues.some((v) => v.isGuard);
      const isOpponent = !isMe;

      for (const venue of p.venues) {
        const div = document.createElement("div");
        div.className = "venue" + (venue.isGuard ? " guard" : "");
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        const text = `${guardLabel} ${vm.getCardName(venue.cardId)} 耐久 ${venue.durability}/${venue.maxDurability}`;
        const span = document.createElement("span");
        span.textContent = text;
        div.appendChild(span);

        if (isMe && venue.activationsLeft > 0 && vm.isMyTurn) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = `启动(剩 ${venue.activationsLeft})`;
          btn.addEventListener("click", () => {
            this.client.send({
              type: CMD.ACTIVATE_VENUE,
              instanceId: venue.instanceId,
            });
          });
          div.appendChild(btn);
        } else if (isMe) {
          const note = document.createElement("span");
          note.style.opacity = "0.6";
          note.style.fontSize = "10.5px";
          note.textContent = `(本回合可启动 ${venue.activationsLeft})`;
          div.appendChild(note);
        }

        if (isOpponent && vm.isMyTurn && vm.me.attackPool > 0) {
          const canAttackVenue = !oppHasGuard || venue.isGuard;
          if (canAttackVenue) {
            const amount = Math.min(vm.me.attackPool, venue.durability);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = `攻击 ${amount}`;
            btn.addEventListener("click", () => {
              this.client.send({
                type: CMD.ASSIGN_ATTACK,
                assignments: [
                  {
                    amount,
                    target: "venue",
                    targetSide: vm.oppSide,
                    venueInstanceId: venue.instanceId,
                  },
                ],
              });
            });
            div.appendChild(btn);
          } else {
            const note = document.createElement("span");
            note.className = "guard-hint";
            note.textContent = "需先处理值守";
            div.appendChild(note);
          }
        }

        venues.appendChild(div);
      }
    }

    // 日程槽
    const sched = el.querySelector(".schedule") as HTMLElement;
    sched.innerHTML = "";
    const labelEl = document.createElement("span");
    labelEl.textContent = "日程:";
    labelEl.style.opacity = "0.7";
    sched.appendChild(labelEl);
    for (let i = 0; i < p.scheduleSlots.length; i++) {
      const slot = p.scheduleSlots[i];
      const span = document.createElement("span");
      span.className = "slot" + (slot ? "" : " empty");
      span.textContent = `[${i + 1}: ${slot ? vm.getCardName(slot.id) : "空"}]`;
      sched.appendChild(span);
    }

    // 预约位
    const reserved = el.querySelector(".reserved") as HTMLElement;
    reserved.innerHTML = "";
    reserved.classList.toggle("has", !!p.reservedCard);
    const r = document.createElement("span");
    r.textContent = p.reservedCard
      ? `预约位: [${vm.getCardName(p.reservedCard.id)}]`
      : "预约位: [空]";
    if (!p.reservedCard) r.style.color = "#555555";
    reserved.appendChild(r);
    if (isMe && p.reservedCard && vm.isMyTurn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "购买（折扣 1）";
      btn.addEventListener("click", () => {
        this.client.send({ type: CMD.BUY_RESERVED_CARD });
      });
      reserved.appendChild(btn);
    }

    if (isMe) {
      const warn = el.querySelector(".discard-warn") as HTMLElement;
      if (p.pendingDiscardCount > 0) {
        warn.textContent = `⚠ 下回合需弃 ${p.pendingDiscardCount} 张手牌`;
        warn.style.display = "";
      } else {
        warn.textContent = "";
        warn.style.display = "none";
      }
    }
  }

  // ── 商店三栏 ───────────────────────────────────────────────────────────────

  private renderMarket(vm: BoardViewModel): void {
    const previewOn = this.settings.showShopPreview;
    const canReserve =
      vm.isMyTurn && !vm.me.hasReservedThisTurn && vm.me.reservedCard === null;

    this.dom.market.innerHTML = "";
    for (const lane of vm.market) {
      const laneEl = document.createElement("div");
      laneEl.className = "lane";

      const title = document.createElement("div");
      title.className = "lane-title";
      title.textContent = lane.lane.toUpperCase();
      laneEl.appendChild(title);

      for (const card of lane.slots) {
        if (!card) {
          const empty = document.createElement("div");
          empty.className = "market-card empty";
          empty.textContent = "（空）";
          laneEl.appendChild(empty);
          continue;
        }

        const cardEl = document.createElement("div");
        cardEl.className = "market-card";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = vm.getCardName(card.id);
        cardEl.appendChild(name);

        if (previewOn) {
          const preview = document.createElement("div");
          preview.className = "preview";
          preview.textContent = this.composePreview(vm, card.id);
          cardEl.appendChild(preview);
        }

        if (vm.isMyTurn) {
          const actions = document.createElement("div");
          actions.className = "actions";

          const buy = document.createElement("button");
          buy.type = "button";
          buy.className = "buy-btn";
          buy.textContent = "购买";
          buy.addEventListener("click", () => {
            this.client.send({
              type: CMD.BUY_MARKET_CARD,
              instanceId: card.instanceId,
            });
          });
          actions.appendChild(buy);

          if (canReserve) {
            const reserve = document.createElement("button");
            reserve.type = "button";
            reserve.className = "reserve-btn";
            reserve.textContent = "预约(1资源)";
            reserve.addEventListener("click", () => {
              this.client.send({
                type: CMD.RESERVE_MARKET_CARD,
                instanceId: card.instanceId,
              });
            });
            actions.appendChild(reserve);
          }

          cardEl.appendChild(actions);
        }

        laneEl.appendChild(cardEl);
      }

      this.dom.market.appendChild(laneEl);
    }
  }

  // ── 固定补给 ───────────────────────────────────────────────────────────────

  private renderFixedSupplies(vm: BoardViewModel): void {
    const previewOn = this.settings.showShopPreview;
    this.dom.fixed.innerHTML = "";
    for (const cardId of vm.fixedSupplies) {
      const card = document.createElement("div");
      card.className = "fixed-card";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = `${vm.getCardName(cardId)}（无限）`;
      card.appendChild(name);

      if (previewOn) {
        const preview = document.createElement("div");
        preview.className = "preview";
        preview.textContent = this.composePreview(vm, cardId);
        card.appendChild(preview);
      }

      if (vm.isMyTurn) {
        const actions = document.createElement("div");
        actions.className = "actions";
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = "buy-btn";
        buy.textContent = "购买";
        buy.addEventListener("click", () => {
          this.client.send({ type: CMD.BUY_FIXED_SUPPLY, cardId });
        });
        actions.appendChild(buy);
        card.appendChild(actions);
      }

      this.dom.fixed.appendChild(card);
    }
  }

  private composePreview(vm: BoardViewModel, cardId: string): string {
    const text = vm.getCardText(cardId);
    if (!text) return `（暂无文案）${cardId}`;
    let combined = text.body || "";
    if (text.reminder) {
      combined = combined ? `${combined}\n${text.reminder}` : text.reminder;
    }
    return combined || `（暂无文案）${cardId}`;
  }

  // ── 手牌 ───────────────────────────────────────────────────────────────────

  private renderHand(vm: BoardViewModel): void {
    this.dom.handCount.textContent = String(vm.hand.length);
    this.dom.hand.innerHTML = "";

    for (const card of vm.hand) {
      const el = document.createElement("div");
      el.className = "hand-card";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = vm.getCardName(card.id);
      el.appendChild(name);

      if (vm.isStatusCard(card.id)) {
        el.classList.add("status");
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = vm.isPressureCard(card.id)
          ? "占位 · 需用清理效果"
          : "状态牌 · 不可主动操作";
        el.appendChild(hint);
      } else if (vm.isMyTurn) {
        const actions = document.createElement("div");
        actions.className = "actions";

        const play = document.createElement("button");
        play.type = "button";
        play.textContent = "点击打出";
        play.addEventListener("click", () => {
          this.client.send({
            type: CMD.PLAY_CARD,
            instanceId: card.instanceId,
          });
        });
        actions.appendChild(play);

        const freeSlot = vm.me.scheduleSlots.findIndex((s) => s === null);
        if (freeSlot !== -1) {
          const sched = document.createElement("button");
          sched.type = "button";
          sched.className = "schedule-btn";
          sched.textContent = `安排→槽${freeSlot + 1}`;
          sched.addEventListener("click", () => {
            this.client.send({
              type: CMD.PUT_CARD_TO_SCHEDULE,
              instanceId: card.instanceId,
              slotIndex: freeSlot,
            });
          });
          actions.appendChild(sched);
        }

        el.appendChild(actions);
      } else {
        el.classList.add("opp-style");
      }

      this.dom.hand.appendChild(el);
    }
  }

  // ── 操作按钮区 ─────────────────────────────────────────────────────────────

  private renderActionBar(vm: BoardViewModel): void {
    this.dom.actionBar.innerHTML = "";

    if (vm.ended) {
      const hint = document.createElement("div");
      hint.className = "turn-hint";
      hint.textContent = "对局已结束";
      this.dom.actionBar.appendChild(hint);
      return;
    }

    if (!vm.started) {
      const ready = document.createElement("button");
      ready.type = "button";
      ready.className = "ready-btn";
      ready.textContent = "✓ READY";
      ready.addEventListener("click", () => {
        this.client.send({ type: CMD.READY });
      });
      this.dom.actionBar.appendChild(ready);
    }

    if (vm.started && vm.isMyTurn) {
      const oppHasGuard = vm.opp.venues.some((v) => v.isGuard);
      if (vm.me.attackPool > 0) {
        if (oppHasGuard) {
          const warn = document.createElement("div");
          warn.className = "guard-warn";
          warn.textContent = "⚠ 对方有值守场馆，先在上方摧毁后才能攻击玩家";
          this.dom.actionBar.appendChild(warn);
        } else {
          const attack = document.createElement("button");
          attack.type = "button";
          attack.className = "attack-btn";
          attack.textContent = `⚔ 攻击对手（全力 ${vm.me.attackPool}）`;
          attack.addEventListener("click", () => {
            this.client.send({
              type: CMD.ASSIGN_ATTACK,
              assignments: [
                { amount: vm.me.attackPool, target: "player", targetSide: vm.oppSide },
              ],
            });
          });
          this.dom.actionBar.appendChild(attack);
        }
      }

      const endTurn = document.createElement("button");
      endTurn.type = "button";
      endTurn.className = "end-turn-btn";
      endTurn.textContent = "⏎ 结束回合";
      endTurn.addEventListener("click", () => {
        this.client.send({ type: CMD.END_TURN });
      });
      this.dom.actionBar.appendChild(endTurn);
    }

    if (vm.started && !vm.isMyTurn) {
      const hint = document.createElement("div");
      hint.className = "turn-hint";
      hint.textContent = "等待对方操作...";
      this.dom.actionBar.appendChild(hint);
    }

    const concede = document.createElement("button");
    concede.type = "button";
    concede.className = "concede-btn";
    concede.textContent = "✕ 投降";
    concede.addEventListener("click", () => {
      if (confirm("确认投降？")) {
        this.client.send({ type: CMD.CONCEDE });
      }
    });
    this.dom.actionBar.appendChild(concede);
  }

  // ── 事件日志条 ─────────────────────────────────────────────────────────────

  private renderEvents(): void {
    this.dom.events.innerHTML = "";
    if (this.recentEvents.length === 0) {
      const empty = document.createElement("span");
      empty.style.opacity = "0.5";
      empty.textContent = "(暂无)";
      this.dom.events.appendChild(empty);
      return;
    }
    const shown = this.recentEvents.slice(-4);
    for (const evt of shown) {
      const span = document.createElement("span");
      span.textContent = summarizeEvent(evt);
      this.dom.events.appendChild(span);
    }
  }

  private renderEndBanner(vm: BoardViewModel): void {
    if (!vm.ended) {
      this.dom.endBanner.classList.add("hidden");
      return;
    }
    const myWin = vm.winner === vm.mySide;
    this.dom.endBanner.textContent = myWin ? "🎉 你赢了！" : "💀 你输了";
    this.dom.endBanner.classList.toggle("win", myWin);
    this.dom.endBanner.classList.toggle("lose", !myWin);
    this.dom.endBanner.classList.remove("hidden");
  }

  // ── 待处理选择面板 ─────────────────────────────────────────────────────────

  private renderChoice(vm: BoardViewModel): void {
    const choice = vm.pendingChoice;
    if (!choice) {
      this.dom.choiceModal.classList.add("hidden");
      return;
    }
    this.dom.choiceModal.classList.remove("hidden");
    this.dom.choiceTitle.textContent = this.choiceTitleText(choice);
    this.dom.choiceMeta.textContent = "";
    this.dom.choiceCandidates.innerHTML = "";
    this.dom.choiceStatus.textContent = "";
    this.dom.choiceActions.innerHTML = "";

    if (choice.type === "chooseTarget") {
      for (const cand of choice.candidates) {
        const key =
          cand.kind === "player" ? `player:${cand.side}` : cand.instanceId;
        const isSelected = this.choiceSelected.has(key);
        const div = document.createElement("div");
        div.className =
          "candidate target" +
          (isSelected ? " selected target" : "") +
          (cand.kind === "player" ? " player" : "");
        div.textContent =
          cand.kind === "player"
            ? `玩家 (P${cand.side + 1})`
            : vm.getCardName(cand.cardId);
        div.addEventListener("click", () => {
          this.choiceSelected.clear();
          this.choiceSelected.add(key);
          this.renderChoice(vm);
        });
        this.dom.choiceCandidates.appendChild(div);
      }
      this.dom.choiceStatus.textContent =
        this.choiceSelected.size === 0 ? "请选择一个目标" : "已选 1 个目标";
      if (this.choiceSelected.size === 1) {
        const confirmBtn = makeBtn("确认目标", "#442200", "#ffcc88", () => {
          this.client.send({
            type: CMD.SUBMIT_CHOICE,
            selectedInstanceIds: Array.from(this.choiceSelected),
          });
          this.choiceSelected.clear();
        });
        this.dom.choiceActions.appendChild(confirmBtn);
      }
      return;
    }

    if (choice.type === "gainFaceUpCardDecision") {
      this.dom.choiceMeta.textContent = `目标：${
        choice.destination === "deckTop" ? "牌堆顶" : "弃牌堆"
      }`;
      for (const c of choice.candidates) {
        const isSelected = this.choiceSelected.has(c.instanceId);
        const div = document.createElement("div");
        div.className = "candidate" + (isSelected ? " selected" : "");
        div.textContent = vm.getCardName(c.id);
        div.addEventListener("click", () => {
          this.choiceSelected.clear();
          this.choiceSelected.add(c.instanceId);
          this.renderChoice(vm);
        });
        this.dom.choiceCandidates.appendChild(div);
      }
      this.dom.choiceStatus.textContent =
        this.choiceSelected.size === 0 ? "请选择一张牌（或跳过）" : "已选 1 张";

      const submit = makeBtn(
        this.choiceSelected.size === 0 ? "跳过（不获取）" : "确认获取",
        this.choiceSelected.size === 0 ? "#333333" : "#004422",
        this.choiceSelected.size === 0 ? "#888888" : "#aaffaa",
        () => {
          this.client.send({
            type: CMD.SUBMIT_CHOICE,
            selectedInstanceIds: Array.from(this.choiceSelected),
          });
          this.choiceSelected.clear();
        }
      );
      this.dom.choiceActions.appendChild(submit);
      return;
    }

    // 卡牌选择类（hand / discard / scry）
    let candidates: PublicCardRef[] = [];
    if (choice.type === "chooseCardsFromHand") candidates = vm.hand;
    else if (choice.type === "chooseCardsFromDiscard") candidates = vm.discard;
    else if (choice.type === "chooseCardsFromHandOrDiscard")
      candidates = [...vm.hand, ...vm.discard];
    else if (choice.type === "scryDecision") candidates = choice.revealedCards;

    if (choice.type === "scryDecision") {
      this.dom.choiceMeta.textContent = `（选择要弃掉的牌，最多 ${choice.maxDiscard} 张；不选则全部放回）`;
    }

    for (const c of candidates) {
      const isSelected = this.choiceSelected.has(c.instanceId);
      const div = document.createElement("div");
      div.className = "candidate" + (isSelected ? " selected" : "");
      div.textContent = vm.getCardName(c.id);
      div.addEventListener("click", () => {
        if (this.choiceSelected.has(c.instanceId)) {
          this.choiceSelected.delete(c.instanceId);
        } else {
          this.choiceSelected.add(c.instanceId);
        }
        this.renderChoice(vm);
      });
      this.dom.choiceCandidates.appendChild(div);
    }
    if (candidates.length === 0) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.55";
      empty.textContent = "（无可选牌）";
      this.dom.choiceCandidates.appendChild(empty);
    }

    const maxCount =
      choice.type === "scryDecision"
        ? choice.maxDiscard
        : (choice as { maxCount: number }).maxCount;
    const selCount = this.choiceSelected.size;
    this.dom.choiceStatus.textContent = `已选: ${selCount} / 最多 ${maxCount} 张`;

    if (selCount <= maxCount) {
      const label = selCount === 0 ? "跳过（不选）" : `确认 ${selCount} 张`;
      const btn = makeBtn(label, "#004422", "#aaffaa", () => {
        this.client.send({
          type: CMD.SUBMIT_CHOICE,
          selectedInstanceIds: Array.from(this.choiceSelected),
        });
        this.choiceSelected.clear();
      });
      this.dom.choiceActions.appendChild(btn);
    }
  }

  private choiceTitleText(choice: PendingChoiceView): string {
    switch (choice.type) {
      case "chooseCardsFromHand":
        return `请从手牌中选择最多 ${choice.maxCount} 张牌报废`;
      case "chooseCardsFromDiscard":
        return `请从弃牌堆中选择最多 ${choice.maxCount} 张牌报废`;
      case "chooseCardsFromHandOrDiscard":
        return `请从手牌或弃牌堆中选择最多 ${choice.maxCount} 张牌报废`;
      case "scryDecision":
        return `预习：查看牌堆顶 ${choice.revealedCards.length} 张，可弃掉其中 ${choice.maxDiscard} 张`;
      case "gainFaceUpCardDecision":
        return "免费获取一张市场牌（费用已满足）";
      case "chooseTarget":
        return choice.targetType === "opponentPlayer"
          ? "选择目标：对手玩家"
          : choice.targetType === "opponentVenue"
          ? "选择目标：对方场馆"
          : "选择目标：己方场馆";
    }
  }

  // ── 回放（HTML 模态版，替代旧 ReplayScene）────────────────────────────────

  private async openReplay(): Promise<void> {
    if (this.replayLoading) return;
    this.replayLoading = true;
    this.dom.replayBtn.textContent = "回放加载中...";
    try {
      const log = await this.client.requestEventLogOnce();
      this.renderReplay(log);
      this.dom.replayModal.classList.remove("hidden");
    } catch (err) {
      this.showError(
        err instanceof Error ? err.message : "加载回放失败"
      );
    } finally {
      this.replayLoading = false;
      this.dom.replayBtn.textContent = "查看回放";
    }
  }

  private renderReplay(log: MatchEventLog): void {
    this.dom.replayBody.innerHTML = "";
    if (log.events.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "#666677";
      empty.textContent = "（暂无事件记录）";
      this.dom.replayBody.appendChild(empty);
      return;
    }
    const tbl = document.createElement("div");
    tbl.className = "replay-table";

    const head = document.createElement("div");
    head.className = "row head";
    for (const h of ["seq", "ts(ms)", "类型", "操作方", "数据"]) {
      const c = document.createElement("span");
      c.textContent = h;
      head.appendChild(c);
    }
    tbl.appendChild(head);

    for (const evt of log.events) {
      const row = document.createElement("div");
      row.className = "row";
      const cells = [
        String(evt.seq),
        String(evt.ts).slice(-6),
        evt.type,
        evt.side !== undefined ? `P${evt.side + 1}` : "-",
        evt.data ? JSON.stringify(evt.data).slice(0, 80) : "",
      ];
      for (const v of cells) {
        const c = document.createElement("span");
        c.textContent = v;
        row.appendChild(c);
      }
      tbl.appendChild(row);
    }

    this.dom.replayBody.appendChild(tbl);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.style.marginTop = "8px";
    meta.textContent = `共 ${log.events.length} 条事件`;
    this.dom.replayBody.appendChild(meta);
  }
}

function makeStat(label: string, value: number, kind: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "v " + kind;
  const lbl = document.createElement("span");
  lbl.className = "label";
  lbl.textContent = `${label}:`;
  const val = document.createElement("span");
  val.textContent = String(value);
  span.appendChild(lbl);
  span.appendChild(val);
  return span;
}

function makeBtn(
  text: string,
  bg: string,
  fg: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.style.background = bg;
  btn.style.color = fg;
  btn.addEventListener("click", onClick);
  return btn;
}
