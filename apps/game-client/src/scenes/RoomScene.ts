import Phaser from "phaser";
import type { PublicMatchView, PrivatePlayerView, PublicCardRef } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";

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
const C_BTN_MY  = "#003355";   // 己方可操作按钮底色
const C_BTN_ACT = "#004400";   // 动作类按钮（END_TURN）
const C_BTN_DNG = "#440000";   // 危险类按钮（CONCEDE）
const C_BTN_SCH = "#223300";   // 日程类按钮
const C_VENUE   = "#553388";   // 场馆底色
const C_GUARD   = "#880022";   // 值守场馆底色
const C_RESERVE = "#334422";   // 预约位底色
const C_BTN_RSV = "#224433";   // 预约按钮底色（绿偏暗）

/**
 * RoomScene — 最小可玩的 Phaser 联机牌桌。
 *
 * 布局（900×640）：
 *  ┌────────────────────────────────────────────────────────┐
 *  │  顶栏：房间 ID / 回合 / 行动方 / 状态                      │  y=0~50
 *  ├──────────────────┬─────────────────────────────────────┤
 *  │  对方信息          │  商店区（三栏 + 固定补给）               │  y=50~260
 *  ├──────────────────┤                                     │
 *  │  己方信息          │                                     │  y=260~380
 *  ├──────────────────┴─────────────────────────────────────┤
 *  │  己方手牌区                                              │  y=380~500
 *  ├────────────────────────────────────────────────────────┤
 *  │  操作按钮区（READY / ATTACK ALL / END_TURN / CONCEDE）   │  y=500~580
 *  └────────────────────────────────────────────────────────┘
 *
 * 交互原则（non-negotiables.md）：
 *  - 客户端只发命令，不做规则判定
 *  - 全部用点击式交互，不做拖拽
 *  - 规则合法性由 server / engine 验证
 */
export class RoomScene extends Phaser.Scene {
  private view!: PublicMatchView;
  private privateView!: PrivatePlayerView;
  private roomClient!: RoomClient;

  /** 当前所有 UI 对象，rebuildUI 时销毁后重建 */
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  /** 日程安排 pending 状态：点击手牌后进入"选槽"模式 */
  private schedulePendingCard: PublicCardRef | null = null;

  constructor() {
    super({ key: "RoomScene" });
  }

  init(data: { view: PublicMatchView; privateView: PrivatePlayerView; roomClient: RoomClient }): void {
    this.view = data.view;
    this.privateView = data.privateView;
    this.roomClient = data.roomClient;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0f0f1e");

    // 接管后续更新
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

  // ── UI 重建入口 ───────────────────────────────────────────────────────────────

  private rebuildUI(): void {
    // 销毁全部旧 UI 对象
    for (const obj of this.uiObjects) obj.destroy();
    this.uiObjects = [];
    this.schedulePendingCard = null;

    this.drawTopBar();
    this.drawOpponentInfo();
    this.drawShopArea();
    this.drawMyInfo();
    this.drawHandArea();
    this.drawActionButtons();
  }

  // ── 顶栏 ─────────────────────────────────────────────────────────────────────

  private drawTopBar(): void {
    const W = this.cameras.main.width;
    const v = this.view;
    const mySide = this.privateView.side;
    const active = v.activePlayer === mySide ? "● 我的回合" : "○ 等待对方";
    const status = v.ended
      ? `对局结束 · 胜者: 玩家${(v.winner ?? 0) + 1}`
      : v.started
      ? `第 ${v.turnNumber} 回合  ${active}`
      : "等待双方 READY...";

    this.txt(10, 6, `房间: ${v.roomId}`, 11, C_LABEL);
    this.txt(W / 2, 6, status, 13, v.activePlayer === mySide ? "#88ff88" : C_LABEL, true);
    this.hr(0, 26, W);
  }

  // ── 对方信息区 ────────────────────────────────────────────────────────────────

  private drawOpponentInfo(): void {
    const mySide = this.privateView.side;
    const oppSide: 0 | 1 = mySide === 0 ? 1 : 0;
    const opp = this.view.players[oppSide];

    let y = 32;
    this.txt(10, y, `▌ 对方 [玩家${oppSide + 1}] ${opp.name}`, 13, C_VALUE);
    y += 18;
    this.txt(10, y, `HP: ${opp.hp}   防备: ${opp.block}   手牌数: ${opp.handSize}   牌堆: ${opp.deckSize}`, 12, C_HP);
    y += 16;

    // 对方场馆（只显示基本信息，不能交互）
    if (opp.venues.length > 0) {
      this.txt(10, y, "对方场馆:", 11, C_LABEL);
      y += 14;
      for (const venue of opp.venues) {
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        this.txt(20, y, `${guardLabel} ${venue.cardId}  耐久:${venue.activationsLeft}/${venue.activationsLeft}`, 11, C_VENUE);
        y += 14;
      }
    }

    // 对方日程槽
    const schedParts = opp.scheduleSlots.map((s, i) => `[${i + 1}: ${s ? s.id : "空"}]`).join(" ");
    this.txt(10, y, `日程: ${schedParts}`, 11, C_LABEL);
    y += 14;

    // 对方预约位（只显示占位状态，不显示牌面）
    const oppReserveLabel = opp.reservedCard
      ? `预约位: [已预约: ${opp.reservedCard.id}]`
      : "预约位: [空]";
    this.txt(10, y, oppReserveLabel, 11, opp.reservedCard ? "#aaffaa" : "#555555");
    y += 14;

    this.hr(0, y, this.cameras.main.width / 2);
  }

  // ── 商店区（三栏 + 固定补给）────────────────────────────────────────────────

  private drawShopArea(): void {
    const W = this.cameras.main.width;
    const shopX = Math.floor(W / 2);
    const mySide = this.privateView.side;
    const isMyTurn = this.view.activePlayer === mySide && this.view.started;

    let y = 32;
    this.txt(shopX + 4, y, "【商  店】", 13, C_TITLE);
    y += 18;

    // 三栏商店
    const me = this.view.players[mySide];
    const canReserve = isMyTurn && !me.hasReservedThisTurn && me.reservedCard === null;
    const laneW = Math.floor((W - shopX - 8) / 3);
    for (let i = 0; i < this.view.market.length; i++) {
      const lane = this.view.market[i];
      const lx = shopX + 4 + i * laneW;
      this.txt(lx, y, lane.lane.toUpperCase(), 11, C_LANE);
      for (let si = 0; si < lane.slots.length; si++) {
        const card = lane.slots[si];
        const by = y + 14 + si * 46;
        if (card) {
          if (isMyTurn) {
            // 买按钮
            this.btn(lx, by, laneW - 4, 22, `${card.id}(买)`, 9, C_BTN_MY, C_BTN_TXT, () => {
              this.roomClient.send({ type: CMD.BUY_MARKET_CARD, instanceId: card.instanceId });
            });
            // 预约按钮（资源 ≥1 且未预约过且预约位空）
            if (canReserve) {
              this.btn(lx, by + 24, laneW - 4, 18, `预约(1资源)`, 9, C_BTN_RSV, "#aaffcc", () => {
                this.roomClient.send({ type: CMD.RESERVE_MARKET_CARD, instanceId: card.instanceId });
              });
            }
          } else {
            this.txtBox(lx, by, laneW - 4, 42, card.id, 9, C_BTN, C_LABEL);
          }
        } else {
          this.txtBox(lx, by, laneW - 4, 42, "（空）", 9, C_BTN, "#555555");
        }
      }
    }

    y += 14 + 2 * 46 + 4;

    // 固定补给
    this.txt(shopX + 4, y, "固定补给:", 11, C_LABEL);
    y += 14;
    for (const cardId of this.view.fixedSupplies) {
      if (isMyTurn) {
        this.btn(shopX + 4, y, W - shopX - 12, 22, `${cardId}（无限，点击买）`, 10, C_BTN_MY, C_BTN_TXT, () => {
          this.roomClient.send({ type: CMD.BUY_FIXED_SUPPLY, cardId });
        });
      } else {
        this.txtBox(shopX + 4, y, W - shopX - 12, 22, cardId, 10, C_BTN, C_LABEL);
      }
      y += 26;
    }
  }

  // ── 己方信息区 ────────────────────────────────────────────────────────────────

  private drawMyInfo(): void {
    const mySide = this.privateView.side;
    const me = this.view.players[mySide];
    const isMyTurn = this.view.activePlayer === mySide && this.view.started;

    let y = 140;
    this.txt(10, y, `▌ 我 [玩家${mySide + 1}] ${me.name}`, 13, C_VALUE);
    y += 18;
    this.txt(10, y, `HP: ${me.hp}   防备: ${me.block}`, 12, C_HP);
    y += 16;
    this.txt(10, y, `资源: ${me.resourcePool}   攻击: ${me.attackPool}   牌堆: ${me.deckSize}   弃: ${me.discardSize}`, 12, C_RES);
    y += 16;

    // 己方场馆区 + 启动按钮
    if (me.venues.length > 0) {
      this.txt(10, y, "我的场馆:", 11, C_LABEL);
      y += 14;
      for (const venue of me.venues) {
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        const canActivate = isMyTurn && venue.activationsLeft > 0;
        const label = `${guardLabel} ${venue.cardId}  启动:${venue.activationsLeft}次`;
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

    // 日程槽
    const schedParts = me.scheduleSlots.map((s, i) => `[${i + 1}: ${s ? s.id : "空"}]`).join("  ");
    this.txt(10, y, `日程: ${schedParts}`, 11, C_LABEL);
    y += 18;

    // 己方预约位
    if (me.reservedCard) {
      this.txt(10, y, `预约位: [${me.reservedCard.id}]`, 11, "#aaffaa");
      // 显示购买预约牌按钮（仅未来回合可用）
      if (isMyTurn) {
        this.btn(130, y, 160, 18, `购买预约牌（折扣1）`, 10, C_BTN_RSV, "#aaffcc", () => {
          this.roomClient.send({ type: CMD.BUY_RESERVED_CARD });
        });
      }
    } else {
      this.txt(10, y, "预约位: [空]", 11, "#555555");
    }
  }

  // ── 手牌区 ────────────────────────────────────────────────────────────────────

  private drawHandArea(): void {
    const W = this.cameras.main.width;
    const mySide = this.privateView.side;
    const hand = this.privateView.hand;
    const isMyTurn = this.view.activePlayer === mySide && this.view.started;

    const CARD_W = 120;
    const CARD_H = 80;
    const HAND_Y = 390;
    const startX = 10;

    this.txt(startX, HAND_Y - 18, `手牌（${hand.length} 张）:`, 12, C_LABEL);
    this.hr(0, HAND_Y - 20, W);

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const cx = startX + i * (CARD_W + 4);

      if (isMyTurn) {
        // 右键选项：点击播放，也可安排（如果还有空日程槽）
        const me = this.view.players[mySide];
        const freeSlotIdx = me.scheduleSlots.findIndex((s) => s === null);

        // 主按钮：打出
        this.btn(cx, HAND_Y, CARD_W, CARD_H - 26, `${card.id}\n(点击打出)`, 9, C_BTN_MY, C_BTN_TXT, () => {
          this.roomClient.send({ type: CMD.PLAY_CARD, instanceId: card.instanceId });
        });

        // 安排按钮（若有空槽）
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
        this.txtBox(cx, HAND_Y, CARD_W, CARD_H, card.id, 9, C_BTN, C_LABEL);
      }
    }
  }

  // ── 操作按钮区 ────────────────────────────────────────────────────────────────

  private drawActionButtons(): void {
    const W = this.cameras.main.width;
    const mySide = this.privateView.side;
    const me = this.view.players[mySide];
    const isMyTurn = this.view.activePlayer === mySide && this.view.started;
    const BTN_Y = 500;
    const BTN_H = 40;

    // READY（游戏未开始时显示）
    if (!this.view.started) {
      this.btn(10, BTN_Y, 160, BTN_H, "✓ READY", 14, "#004422", "#aaffaa", () => {
        this.roomClient.send({ type: CMD.READY });
      });
    }

    if (!this.view.ended && isMyTurn) {
      const oppSide: 0 | 1 = mySide === 0 ? 1 : 0;

      // ATTACK ALL（若有攻击力）
      if (me.attackPool > 0) {
        const label = `⚔ 攻击对手（全力 ${me.attackPool}）`;
        this.btn(190, BTN_Y, 220, BTN_H, label, 12, C_BTN_DNG, "#ffaaaa", () => {
          this.roomClient.send({
            type: CMD.ASSIGN_ATTACK,
            assignments: [{ amount: me.attackPool, target: "player", targetSide: oppSide }],
          });
        });
      }

      // END_TURN
      this.btn(424, BTN_Y, 140, BTN_H, "⏎ 结束回合", 13, C_BTN_ACT, "#aaffaa", () => {
        this.roomClient.send({ type: CMD.END_TURN });
      });
    }

    // CONCEDE（任意时刻）
    if (!this.view.ended) {
      this.btn(W - 130, BTN_Y, 120, BTN_H, "✕ 投降", 12, C_BTN_DNG, "#ffaaaa", () => {
        this.roomClient.send({ type: CMD.CONCEDE });
      });
    }

    // 对局结束：显示结果
    if (this.view.ended) {
      const winner = this.view.winner;
      const myWin = winner === mySide;
      const msg = myWin ? "🎉 你赢了！" : "💀 你输了";
      this.txt(W / 2, BTN_Y + 10, msg, 22, myWin ? "#88ff88" : "#ff6666", true);
    }

    // 底部状态提示
    this.txt(
      W / 2,
      this.cameras.main.height - 16,
      isMyTurn ? "你的回合 — 点击手牌打出，点击商店购买，点击场馆启动" : "等待对方操作...",
      10,
      "#444466",
      true
    );
  }

  // ── UI 辅助工厂 ───────────────────────────────────────────────────────────────

  /** 添加一行文字，返回文字对象 */
  private txt(
    x: number, y: number, text: string, size: number,
    color: string, centered = false
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontSize: `${size}px`, color, fontFamily: FONT })
      .setOrigin(centered ? 0.5 : 0, 0);
    this.uiObjects.push(t);
    return t;
  }

  /** 添加水平分割线 */
  private hr(x: number, y: number, w: number): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x333355, 1);
    g.strokeLineShape(new Phaser.Geom.Line(x, y, x + w, y));
    this.uiObjects.push(g);
  }

  /** 添加纯文本框（不可点击） */
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

  /** 添加可点击按钮，返回 container */
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
