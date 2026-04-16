import Phaser from "phaser";
import type { PublicMatchView, PrivatePlayerView, PublicCardRef, PendingChoiceView } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";
import { buildBoardViewModel, type BoardViewModel } from "../viewmodel/BoardViewModel";

// ── 颜色/样式常量 ─────────────────────────────────────────────────────────────
const FONT = "monospace";
const C_TITLE   = "#ffffff";
const C_LABEL   = "#aaaaaa";
const C_VALUE   = "#66ccff";
const C_HP      = "#88ff88";
const C_BLOCK   = "#ffcc44";
const C_ATTACK  = "#ff8844";
const C_RES     = "#88ccff";
const C_LANE    = "#cc88ff";
const C_BTN     = "#222244";
const C_BTN_TXT = "#ffffff";
const C_BTN_MY  = "#003355";
const C_BTN_ACT = "#004400";
const C_BTN_DNG = "#440000";
const C_BTN_SCH = "#223300";
const C_VENUE   = "#553388";
const C_GUARD   = "#880022";
const C_RESERVE = "#334422";
const C_BTN_RSV = "#224433";

/**
 * RoomScene — 最小可玩的 Phaser 联机牌桌。
 *
 * 渲染层通过 ViewModel（BoardViewModel）读取状态，
 * 不再直接散乱引用原始 PublicMatchView / PrivatePlayerView。
 *
 * 布局（900×640）：
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  顶栏：房间 ID / 回合 / 行动方 / 状态                       │  y=0~50
 *  ├──────────────────┬───────────────────────────────────────┤
 *  │  对方信息          │  商店区（三栏 + 固定补给）                │  y=50~260
 *  ├──────────────────┤                                       │
 *  │  己方信息          │                                       │  y=260~380
 *  ├──────────────────┴───────────────────────────────────────┤
 *  │  己方手牌区                                                │  y=380~500
 *  ├──────────────────────────────────────────────────────────┤
 *  │  操作按钮区（READY / ATTACK ALL / END_TURN / CONCEDE）    │  y=500~580
 *  └──────────────────────────────────────────────────────────┘
 */
export class RoomScene extends Phaser.Scene {
  private view!: PublicMatchView;
  private privateView!: PrivatePlayerView;
  private roomClient!: RoomClient;

  /** 当前所有 UI 对象，rebuildUI 时销毁后重建 */
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  /** 日程安排 pending 状态：点击手牌后进入"选槽"模式 */
  private schedulePendingCard: PublicCardRef | null = null;

  /**
   * 待提交选择：玩家在选择 UI 中已点击的实例 ID 集合。
   */
  private choiceSelected: Set<string> = new Set();

  /**
   * 可选注入本地化卡牌名称（cardId → localizedName）。
   * 未来可通过 content-loader 填充；当前为 undefined（降级为 cardId）。
   */
  private cardNames?: ReadonlyMap<string, string>;

  constructor() {
    super({ key: "RoomScene" });
  }

  init(data: { view: PublicMatchView; privateView: PrivatePlayerView; roomClient: RoomClient; cardNames?: ReadonlyMap<string, string> }): void {
    this.view = data.view;
    this.privateView = data.privateView;
    this.roomClient = data.roomClient;
    this.cardNames = data.cardNames;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0f0f1e");

    this.roomClient.onStateUpdate = (v: PublicMatchView) => {
      this.view = v;
      this.rebuildUI();
    };
    this.roomClient.onPrivateUpdate = (pv: PrivatePlayerView) => {
      this.privateView = pv;
      this.rebuildUI();
    };

    this.rebuildUI();
  }

  // ── UI 重建入口 ──────────────────────────────────────────────────────────────

  private rebuildUI(): void {
    for (const obj of this.uiObjects) obj.destroy();
    this.uiObjects = [];
    this.schedulePendingCard = null;

    // 构建 ViewModel —— 所有 draw 方法从此消费，不再直接访问 this.view / this.privateView
    const vm = buildBoardViewModel(this.view, this.privateView, this.cardNames);

    if (!vm.pendingChoice) {
      this.choiceSelected.clear();
    }

    if (vm.pendingChoice) {
      this.drawTopBar(vm);
      this.drawChoicePanel(vm, vm.pendingChoice);
      return;
    }

    this.drawTopBar(vm);
    this.drawOpponentInfo(vm);
    this.drawShopArea(vm);
    this.drawMyInfo(vm);
    this.drawHandArea(vm);
    this.drawActionButtons(vm);
  }

  // ── 顶栏 ─────────────────────────────────────────────────────────────────────

  private drawTopBar(vm: BoardViewModel): void {
    const W = this.cameras.main.width;
    const active = vm.isMyTurn ? "● 我的回合" : "○ 等待对方";
    const status = vm.ended
      ? `对局结束 · 胜者: 玩家${(vm.winner ?? 0) + 1}`
      : vm.started
      ? `第 ${vm.turnNumber} 回合  ${active}`
      : "等待双方 READY...";

    this.txt(10, 6, `房间: ${vm.roomId}`, 11, C_LABEL);
    this.txt(W / 2, 6, status, 13, vm.isMyTurn ? "#88ff88" : C_LABEL, true);
    this.hr(0, 26, W);
  }

  // ── 对方信息区 ────────────────────────────────────────────────────────────────

  private drawOpponentInfo(vm: BoardViewModel): void {
    const opp = vm.opp;

    let y = 32;
    this.txt(10, y, `▌ 对方 [玩家${opp.side + 1}] ${opp.name}`, 13, C_VALUE);
    y += 18;
    this.txt(10, y, `HP: ${opp.hp}   防备: ${opp.block}   手牌数: ${opp.handSize}   牌堆: ${opp.deckSize}`, 12, C_HP);
    y += 16;

    if (opp.venues.length > 0) {
      this.txt(10, y, "对方场馆:", 11, C_LABEL);
      y += 14;
      for (const venue of opp.venues) {
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        this.txt(20, y, `${guardLabel} ${vm.getCardName(venue.cardId)}  耐久:${venue.activationsLeft}/${venue.activationsLeft}`, 11, C_VENUE);
        y += 14;
      }
    }

    const schedParts = opp.scheduleSlots.map((s, i) => `[${i + 1}: ${s ? vm.getCardName(s.id) : "空"}]`).join(" ");
    this.txt(10, y, `日程: ${schedParts}`, 11, C_LABEL);
    y += 14;

    const oppReserveLabel = opp.reservedCard
      ? `预约位: [已预约: ${vm.getCardName(opp.reservedCard.id)}]`
      : "预约位: [空]";
    this.txt(10, y, oppReserveLabel, 11, opp.reservedCard ? "#aaffaa" : "#555555");
    y += 14;

    this.hr(0, y, this.cameras.main.width / 2);
  }

  // ── 商店区（三栏 + 固定补给）────────────────────────────────────────────────

  private drawShopArea(vm: BoardViewModel): void {
    const W = this.cameras.main.width;
    const shopX = Math.floor(W / 2);

    let y = 32;
    this.txt(shopX + 4, y, "【商  店】", 13, C_TITLE);
    y += 18;

    const canReserve = vm.isMyTurn && !vm.me.hasReservedThisTurn && vm.me.reservedCard === null;
    const laneW = Math.floor((W - shopX - 8) / 3);
    for (let i = 0; i < vm.market.length; i++) {
      const lane = vm.market[i];
      const lx = shopX + 4 + i * laneW;
      this.txt(lx, y, lane.lane.toUpperCase(), 11, C_LANE);
      for (let si = 0; si < lane.slots.length; si++) {
        const card = lane.slots[si];
        const by = y + 14 + si * 46;
        if (card) {
          if (vm.isMyTurn) {
            this.btn(lx, by, laneW - 4, 22, `${vm.getCardName(card.id)}(买)`, 9, C_BTN_MY, C_BTN_TXT, () => {
              this.roomClient.send({ type: CMD.BUY_MARKET_CARD, instanceId: card.instanceId });
            });
            if (canReserve) {
              this.btn(lx, by + 24, laneW - 4, 18, `预约(1资源)`, 9, C_BTN_RSV, "#aaffcc", () => {
                this.roomClient.send({ type: CMD.RESERVE_MARKET_CARD, instanceId: card.instanceId });
              });
            }
          } else {
            this.txtBox(lx, by, laneW - 4, 42, vm.getCardName(card.id), 9, C_BTN, C_LABEL);
          }
        } else {
          this.txtBox(lx, by, laneW - 4, 42, "（空）", 9, C_BTN, "#555555");
        }
      }
    }

    y += 14 + 2 * 46 + 4;

    this.txt(shopX + 4, y, "固定补给:", 11, C_LABEL);
    y += 14;
    for (const cardId of vm.fixedSupplies) {
      if (vm.isMyTurn) {
        this.btn(shopX + 4, y, W - shopX - 12, 22, `${vm.getCardName(cardId)}（无限，点击买）`, 10, C_BTN_MY, C_BTN_TXT, () => {
          this.roomClient.send({ type: CMD.BUY_FIXED_SUPPLY, cardId });
        });
      } else {
        this.txtBox(shopX + 4, y, W - shopX - 12, 22, vm.getCardName(cardId), 10, C_BTN, C_LABEL);
      }
      y += 26;
    }
  }

  // ── 己方信息区 ────────────────────────────────────────────────────────────────

  private drawMyInfo(vm: BoardViewModel): void {
    const me = vm.me;

    let y = 140;
    this.txt(10, y, `▌ 我 [玩家${me.side + 1}] ${me.name}`, 13, C_VALUE);
    y += 18;
    this.txt(10, y, `HP: ${me.hp}   防备: ${me.block}`, 12, C_HP);
    y += 16;
    this.txt(10, y, `资源: ${me.resourcePool}   攻击: ${me.attackPool}   牌堆: ${me.deckSize}   弃: ${me.discardSize}`, 12, C_RES);
    y += 16;

    if (me.venues.length > 0) {
      this.txt(10, y, "我的场馆:", 11, C_LABEL);
      y += 14;
      for (const venue of me.venues) {
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        const canActivate = vm.isMyTurn && venue.activationsLeft > 0;
        const label = `${guardLabel} ${vm.getCardName(venue.cardId)}  启动:${venue.activationsLeft}次`;
        if (canActivate) {
          this.btn(14, y, 220, 22, `${label} (点击启动)`, 10, C_VENUE, C_BTN_TXT, () => {
            this.roomClient.send({ type: CMD.ACTIVATE_VENUE, instanceId: venue.instanceId });
          });
        } else {
          this.txtBox(14, y, 220, 22, label, 10, C_VENUE, C_LABEL);
        }
        y += 26;
      }
    }

    const schedParts = me.scheduleSlots.map((s, i) => `[${i + 1}: ${s ? vm.getCardName(s.id) : "空"}]`).join("  ");
    this.txt(10, y, `日程: ${schedParts}`, 11, C_LABEL);
    y += 18;

    if (me.reservedCard) {
      this.txt(10, y, `预约位: [${vm.getCardName(me.reservedCard.id)}]`, 11, "#aaffaa");
      if (vm.isMyTurn) {
        this.btn(130, y, 160, 18, `购买预约牌（折扣1）`, 10, C_BTN_RSV, "#aaffcc", () => {
          this.roomClient.send({ type: CMD.BUY_RESERVED_CARD });
        });
      }
    } else {
      this.txt(10, y, "预约位: [空]", 11, "#555555");
    }
  }

  // ── 手牌区 ────────────────────────────────────────────────────────────────────

  private drawHandArea(vm: BoardViewModel): void {
    const W = this.cameras.main.width;
    const hand = vm.hand;

    const CARD_W = 120;
    const CARD_H = 80;
    const HAND_Y = 390;
    const startX = 10;

    this.txt(startX, HAND_Y - 18, `手牌（${hand.length} 张）:`, 12, C_LABEL);
    this.hr(0, HAND_Y - 20, W);

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const cx = startX + i * (CARD_W + 4);

      if (vm.isMyTurn) {
        const freeSlotIdx = vm.me.scheduleSlots.findIndex((s) => s === null);

        this.btn(cx, HAND_Y, CARD_W, CARD_H - 26, `${vm.getCardName(card.id)}\n(点击打出)`, 9, C_BTN_MY, C_BTN_TXT, () => {
          this.roomClient.send({ type: CMD.PLAY_CARD, instanceId: card.instanceId });
        });

        if (freeSlotIdx !== -1) {
          this.btn(cx, HAND_Y + CARD_H - 24, CARD_W, 22, `安排→槽${freeSlotIdx + 1}`, 9, C_BTN_SCH, C_BTN_TXT, () => {
            this.roomClient.send({
              type: CMD.PUT_CARD_TO_SCHEDULE,
              instanceId: card.instanceId,
              slotIndex: freeSlotIdx,
            });
          });
        }
      } else {
        this.txtBox(cx, HAND_Y, CARD_W, CARD_H, vm.getCardName(card.id), 9, C_BTN, C_LABEL);
      }
    }
  }

  // ── 操作按钮区 ────────────────────────────────────────────────────────────────

  private drawActionButtons(vm: BoardViewModel): void {
    const W = this.cameras.main.width;
    const BTN_Y = 500;
    const BTN_H = 40;

    if (!vm.started) {
      this.btn(10, BTN_Y, 160, BTN_H, "✓ READY", 14, "#004422", "#aaffaa", () => {
        this.roomClient.send({ type: CMD.READY });
      });
    }

    if (!vm.ended && vm.isMyTurn) {
      const oppSide = vm.oppSide;

      if (vm.me.attackPool > 0) {
        const label = `⚔ 攻击对手（全力 ${vm.me.attackPool}）`;
        this.btn(190, BTN_Y, 220, BTN_H, label, 12, C_BTN_DNG, "#ffaaaa", () => {
          this.roomClient.send({
            type: CMD.ASSIGN_ATTACK,
            assignments: [{ amount: vm.me.attackPool, target: "player", targetSide: oppSide }],
          });
        });
      }

      this.btn(424, BTN_Y, 140, BTN_H, "⏎ 结束回合", 13, C_BTN_ACT, "#aaffaa", () => {
        this.roomClient.send({ type: CMD.END_TURN });
      });
    }

    if (!vm.ended) {
      this.btn(W - 130, BTN_Y, 120, BTN_H, "✕ 投降", 12, C_BTN_DNG, "#ffaaaa", () => {
        this.roomClient.send({ type: CMD.CONCEDE });
      });
    }

    if (vm.ended) {
      const myWin = vm.winner === vm.mySide;
      const msg = myWin ? "🎉 你赢了！" : "💀 你输了";
      this.txt(W / 2, BTN_Y + 10, msg, 22, myWin ? "#88ff88" : "#ff6666", true);
    }

    this.txt(
      W / 2,
      this.cameras.main.height - 16,
      vm.isMyTurn ? "你的回合 — 点击手牌打出，点击商店购买，点击场馆启动" : "等待对方操作...",
      10,
      "#444466",
      true
    );
  }

  // ── 待处理选择面板 ────────────────────────────────────────────────────────────

  private drawChoicePanel(vm: BoardViewModel, choice: PendingChoiceView): void {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;

    const mask = this.add.graphics();
    mask.fillStyle(0x000000, 0.75);
    mask.fillRect(0, 30, W, H - 30);
    this.uiObjects.push(mask);

    let y = 50;
    const titleText = this.choiceTitleText(choice);
    this.txt(W / 2, y, titleText, 14, "#ffff88", true);
    y += 28;

    // ── chooseTarget：目标选择 UI ───────────────────────────────────────────
    if (choice.type === "chooseTarget") {
      const CARD_W = 160;
      const CARD_H = 60;
      const startX = Math.max(10, (W - choice.candidates.length * (CARD_W + 8)) / 2);

      for (let i = 0; i < choice.candidates.length; i++) {
        const cand = choice.candidates[i];
        const selKey = cand.kind === "player" ? `player:${cand.side}` : cand.instanceId;
        const isSelected = this.choiceSelected.has(selKey);
        const label = cand.kind === "player"
          ? `玩家 (P${cand.side})`
          : vm.getCardName(cand.cardId);
        const cx = startX + i * (CARD_W + 8);

        this.btn(cx, y, CARD_W, CARD_H, (isSelected ? "✓ " : "") + label, 9,
          isSelected ? "#662222" : "#222244", isSelected ? "#ffaaaa" : "#cccccc",
          () => {
            // 目标只能选 1 个：清除后选新的
            this.choiceSelected.clear();
            this.choiceSelected.add(selKey);
            this.rebuildUI();
          });
      }

      y += CARD_H + 16;
      const selCount = this.choiceSelected.size;
      this.txt(W / 2, y, selCount === 0 ? "请选择一个目标" : `已选目标`, 11, "#aaaaaa", true);
      y += 20;

      if (selCount === 1) {
        this.btn(W / 2 - 90, y, 180, 36, "确认目标", 12, "#442200", "#ffcc88", () => {
          this.roomClient.send({
            type: CMD.SUBMIT_CHOICE,
            selectedInstanceIds: Array.from(this.choiceSelected),
          });
          this.choiceSelected.clear();
        });
      }
      return;
    }

    // ── gainFaceUpCardDecision：市场牌选择 UI ───────────────────────────────
    if (choice.type === "gainFaceUpCardDecision") {
      const CARD_W = 130;
      const CARD_H = 60;
      const startX = Math.max(10, (W - choice.candidates.length * (CARD_W + 6)) / 2);

      this.txt(W / 2, y,
        `目标：${choice.destination === "deckTop" ? "牌堆顶" : "弃牌堆"}`, 11, "#aaaaaa", true);
      y += 16;

      for (let i = 0; i < choice.candidates.length; i++) {
        const c = choice.candidates[i];
        const cx = startX + i * (CARD_W + 6);
        const isSelected = this.choiceSelected.has(c.instanceId);
        this.btn(cx, y, CARD_W, CARD_H,
          (isSelected ? "✓ " : "") + vm.getCardName(c.id), 9,
          isSelected ? "#226622" : "#222244",
          isSelected ? "#aaffaa" : "#cccccc",
          () => {
            // 只能选 1 张
            this.choiceSelected.clear();
            this.choiceSelected.add(c.instanceId);
            this.rebuildUI();
          });
      }

      y += CARD_H + 16;
      const selCount = this.choiceSelected.size;
      this.txt(W / 2, y, selCount === 0 ? "请选择一张牌（或跳过）" : `已选 1 张`, 11, "#aaaaaa", true);
      y += 20;

      this.btn(W / 2 - 180, y, 160, 36,
        selCount === 0 ? "跳过（不获取）" : "确认获取", 12,
        selCount === 0 ? "#333333" : "#004422",
        selCount === 0 ? "#888888" : "#aaffaa",
        () => {
          this.roomClient.send({
            type: CMD.SUBMIT_CHOICE,
            selectedInstanceIds: Array.from(this.choiceSelected),
          });
          this.choiceSelected.clear();
        });
      return;
    }

    // ── 卡牌选择 UI（hand / discard / scry）───────────────────────────────
    let candidates: PublicCardRef[] = [];
    if (choice.type === "chooseCardsFromHand") {
      candidates = vm.hand;
    } else if (choice.type === "chooseCardsFromDiscard") {
      candidates = vm.discard;
    } else if (choice.type === "chooseCardsFromHandOrDiscard") {
      candidates = [...vm.hand, ...vm.discard];
    } else if (choice.type === "scryDecision") {
      candidates = choice.revealedCards;
    }

    const CARD_W = 130;
    const CARD_H = 60;
    const startX = Math.max(10, (W - candidates.length * (CARD_W + 6)) / 2);

    if (choice.type === "chooseCardsFromHandOrDiscard" && vm.hand.length > 0) {
      this.txt(startX, y, "← 手牌", 10, "#aaaaff");
      if (vm.discard.length > 0) {
        this.txt(startX + vm.hand.length * (CARD_W + 6) + 4, y, "弃牌堆 →", 10, "#ffaaaa");
      }
      y += 14;
    }
    if (choice.type === "scryDecision") {
      this.txt(W / 2, y, `（选择要弃掉的牌，最多 ${choice.maxDiscard} 张；不选则全部放回）`, 11, "#aaaaaa", true);
      y += 16;
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cx = startX + i * (CARD_W + 6);
      const isSelected = this.choiceSelected.has(c.instanceId);
      this.btn(cx, y, CARD_W, CARD_H,
        (isSelected ? "✓ " : "") + vm.getCardName(c.id), 9,
        isSelected ? "#226622" : "#222244",
        isSelected ? "#aaffaa" : "#cccccc",
        () => {
          if (this.choiceSelected.has(c.instanceId)) this.choiceSelected.delete(c.instanceId);
          else this.choiceSelected.add(c.instanceId);
          this.rebuildUI();
        });
    }

    if (candidates.length === 0) {
      this.txt(W / 2, y + 20, "（无可选牌）", 12, "#666666", true);
    }

    y += CARD_H + 16;

    const selCount = this.choiceSelected.size;
    const maxCount = choice.type === "scryDecision"
      ? choice.maxDiscard
      : (choice as { maxCount: number }).maxCount;
    this.txt(W / 2, y, `已选: ${selCount} / 最多 ${maxCount} 张`, 11, "#aaaaaa", true);
    y += 20;

    if (selCount <= maxCount) {
      const btnLabel = selCount === 0 ? "跳过（不选）" : `确认报废 / 弃掉 ${selCount} 张`;
      this.btn(W / 2 - 100, y, 200, 36, btnLabel, 12, "#004422", "#aaffaa", () => {
        this.roomClient.send({
          type: CMD.SUBMIT_CHOICE,
          selectedInstanceIds: Array.from(this.choiceSelected),
        });
        this.choiceSelected.clear();
      });
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
        return `免费获取一张市场牌（费用已满足）`;
      case "chooseTarget":
        return choice.targetType === "opponentPlayer" ? "选择目标：对手玩家"
          : choice.targetType === "opponentVenue" ? "选择目标：对方场馆"
          : "选择目标：己方场馆";
    }
  }

  // ── UI 辅助工厂 ───────────────────────────────────────────────────────────────

  private txt(
    x: number, y: number, text: string, size: number,
    color: string, centered = false
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontSize: `${size}px`, color, fontFamily: FONT })
      .setOrigin(centered ? 0.5 : 0, 0);
    this.uiObjects.push(t);
    return t;
  }

  private hr(x: number, y: number, w: number): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x333355, 1);
    g.strokeLineShape(new Phaser.Geom.Line(x, y, x + w, y));
    this.uiObjects.push(g);
  }

  private txtBox(
    x: number, y: number, w: number, h: number,
    text: string, size: number, bgColor: string, textColor: string
  ): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(Phaser.Display.Color.HexStringToColor(bgColor).color, 1);
    g.fillRect(0, 0, w, h);
    const t = this.add.text(4, Math.floor(h / 2), text, {
      fontSize: `${size}px`, color: textColor, fontFamily: FONT,
      wordWrap: { width: w - 8 },
    }).setOrigin(0, 0.5);
    const container = this.add.container(x, y, [g, t]);
    this.uiObjects.push(container);
    return container;
  }

  private btn(
    x: number, y: number, w: number, h: number,
    text: string, size: number, bgColor: string, textColor: string,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    const colorObj = Phaser.Display.Color.HexStringToColor(bgColor);
    g.fillStyle(colorObj.color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, 0x8888cc, 0.6);
    g.strokeRect(0, 0, w, h);

    const t = this.add.text(Math.floor(w / 2), Math.floor(h / 2), text, {
      fontSize: `${size}px`, color: textColor, fontFamily: FONT,
      wordWrap: { width: w - 6 }, align: "center",
    }).setOrigin(0.5, 0.5);

    const zone = this.add.zone(0, 0, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerdown", onClick);
    zone.on("pointerover", () => {
      g.clear();
      g.fillStyle(colorObj.color, 1);
      g.fillRect(0, 0, w, h);
      g.lineStyle(2, 0xaaaaff, 1);
      g.strokeRect(0, 0, w, h);
    });
    zone.on("pointerout", () => {
      g.clear();
      g.fillStyle(colorObj.color, 1);
      g.fillRect(0, 0, w, h);
      g.lineStyle(1, 0x8888cc, 0.6);
      g.strokeRect(0, 0, w, h);
    });

    const container = this.add.container(x, y, [g, t, zone]);
    this.uiObjects.push(container);
    return container;
  }
}
