import Phaser from "phaser";
import type { PublicMatchView, PrivatePlayerView, PublicCardRef, PendingChoiceView, MatchEvent } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";
import { buildBoardViewModel, type BoardViewModel } from "../viewmodel/BoardViewModel";
import type { CardTextEntry } from "../content/clientLocale";
import {
  getSettings,
  subscribeSettings,
  updateSettings,
  type ClientSettings,
} from "../settings/clientSettings";
import { createUI, type UIKit } from "./uiKit";
import { BASE_WIDTH, BASE_HEIGHT } from "../main";

// ── 颜色/样式常量 ─────────────────────────────────────────────────────────────
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

  /**
   * 可选注入卡牌完整文案（含 body / reminder），用于商店预览渲染。
   */
  private cardTexts?: ReadonlyMap<string, CardTextEntry>;

  /** 当前客户端设置快照；订阅 settings 模块在变更时自动重绘。 */
  private settings: ClientSettings = getSettings();
  private unsubscribeSettings: (() => void) | null = null;

  /** 设备像素比；由 main.ts 在 init 时注入，用于 camera zoom + UI kit 内部判断。 */
  private dpr = 1;

  /** 统一文字 / 按钮工厂；rebuildUI 时 push 到 uiObjects 自动清理。 */
  private ui!: UIKit;

  /** 最小事件日志（最近 N 条，用于底部摘要显示） */
  private recentEvents: MatchEvent[] = [];

  /** 顶部错误提示（服务端拒绝命令 / 非法操作） */
  private errorText: string | null = null;
  private errorClearTimer: Phaser.Time.TimerEvent | null = null;

  /** 避免重复点击“查看回放”并重复发请求 */
  private replayLoading = false;

  constructor() {
    super({ key: "RoomScene" });
  }

  init(data: { view: PublicMatchView; privateView: PrivatePlayerView; roomClient: RoomClient; cardNames?: ReadonlyMap<string, string>; cardTexts?: ReadonlyMap<string, CardTextEntry>; dpr?: number }): void {
    this.view = data.view;
    this.privateView = data.privateView;
    this.roomClient = data.roomClient;
    this.cardNames = data.cardNames;
    this.cardTexts = data.cardTexts;
    this.dpr = data.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0f0f1e");
    // origin=0 + zoom=dpr：世界坐标 [0, BASE_WIDTH/HEIGHT] → 画布像素 [0, BASE×dpr]。
    // 这是文字清晰度的真正修复点：canvas backing buffer 与最终物理像素 1:1，无插值。
    this.cameras.main.setOrigin(0, 0);
    if (this.dpr !== 1) this.cameras.main.setZoom(this.dpr);
    this.ui = createUI(this, this.uiObjects);

    this.roomClient.onStateUpdate = (v: PublicMatchView) => {
      this.view = v;
      this.rebuildUI();
    };
    this.roomClient.onPrivateUpdate = (pv: PrivatePlayerView) => {
      this.privateView = pv;
      this.rebuildUI();
    };
    this.roomClient.onEventLog = (log) => {
      // 保留最近 8 条事件供底部摘要显示
      this.recentEvents = log.events.slice(-8);
      this.rebuildUI();
    };
    this.roomClient.onError = (message: string) => {
      this.showError(message);
    };

    // 订阅设置变化（例如商店预览开关），变更时自动重绘 UI。
    this.settings = getSettings();
    this.unsubscribeSettings = subscribeSettings((s) => {
      this.settings = s;
      this.rebuildUI();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSettings?.();
      this.unsubscribeSettings = null;
    });

    this.rebuildUI();
  }

  // ── UI 重建入口 ──────────────────────────────────────────────────────────────

  private rebuildUI(): void {
    for (const obj of this.uiObjects) obj.destroy();
    // Must clear in-place — this.ui's track() closure captures the original array reference.
    // Reassigning this.uiObjects = [] would leave the UIKit pushing into a stale array,
    // causing accumulated (non-destroyed) objects on every rebuildUI call.
    this.uiObjects.length = 0;
    this.schedulePendingCard = null;

    // 构建 ViewModel —— 所有 draw 方法从此消费，不再直接访问 this.view / this.privateView
    const vm = buildBoardViewModel(this.view, this.privateView, this.cardNames, this.cardTexts);

    if (!vm.pendingChoice) {
      this.choiceSelected.clear();
    }

    if (vm.pendingChoice) {
      this.drawTopBar(vm);
      this.drawErrorBanner();
      this.drawChoicePanel(vm, vm.pendingChoice);
      this.drawSettingsMenu();
      return;
    }

    this.drawTopBar(vm);
    this.drawErrorBanner();
    this.drawOpponentInfo(vm);
    this.drawShopArea(vm);
    this.drawMyInfo(vm);
    this.drawHandArea(vm);
    this.drawActionButtons(vm);
    this.drawEventLogStrip();
    this.drawSettingsMenu();
  }

  // ── 顶栏 ─────────────────────────────────────────────────────────────────────

  private drawTopBar(vm: BoardViewModel): void {
    const W = BASE_WIDTH;
    const active = vm.isMyTurn ? "● 我的回合" : "○ 等待对方";
    const status = vm.ended
      ? `对局结束 · 胜者: 玩家${(vm.winner ?? 0) + 1}`
      : vm.started
      ? `第 ${vm.turnNumber} 回合  ${active}`
      : "等待双方 READY...";

    this.txt(10, 6, `房间: ${vm.roomId}`, 11, C_LABEL);
    this.txt(W / 2, 6, status, 13, vm.isMyTurn ? "#88ff88" : C_LABEL, true);

    // 右上角设置入口（齿轮 + 商店预览开关状态指示）
    const gearLabel = this.settings.showShopPreview ? "⚙ 设置 · 预览开" : "⚙ 设置 · 预览关";
    this.btn(
      W - 130,
      4,
      120,
      20,
      gearLabel,
      9,
      this.settings.showShopPreview ? "#22334a" : "#332233",
      "#cccccc",
      () => this.openSettingsMenu()
    );

    this.hr(0, 26, W);
  }

  /**
   * 设置弹层 —— 当前只有"商店牌预览"一个开关，未来可扩展为更多项。
   * 直接复用 rebuildUI() 流程，把弹层作为最上层 UI 层叠出来。
   */
  private settingsMenuOpen = false;

  private openSettingsMenu(): void {
    this.settingsMenuOpen = !this.settingsMenuOpen;
    this.rebuildUI();
  }

  private drawSettingsMenu(): void {
    if (!this.settingsMenuOpen) return;
    const W = BASE_WIDTH;

    const panelW = 280;
    const panelH = 130;
    const panelX = W - panelW - 10;
    const panelY = 28;

    const mask = this.add.graphics();
    mask.fillStyle(0x000000, 0.55);
    mask.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    this.uiObjects.push(mask);

    // 点击空白处关闭
    const dismissZone = this.add.zone(0, 0, BASE_WIDTH, BASE_HEIGHT)
      .setOrigin(0, 0)
      .setInteractive();
    dismissZone.on("pointerdown", () => {
      this.settingsMenuOpen = false;
      this.rebuildUI();
    });
    this.uiObjects.push(dismissZone);

    // 设置面板背景（拦截点击避免穿透到 dismissZone）
    const bg = this.add.graphics();
    bg.fillStyle(0x14142a, 1);
    bg.fillRect(panelX, panelY, panelW, panelH);
    bg.lineStyle(1, 0x4a4a7a, 1);
    bg.strokeRect(panelX, panelY, panelW, panelH);
    this.uiObjects.push(bg);
    const blockZone = this.add.zone(panelX, panelY, panelW, panelH).setOrigin(0, 0).setInteractive();
    blockZone.on("pointerdown", () => {
      /* 吞掉点击 —— 防止落到 dismissZone */
    });
    this.uiObjects.push(blockZone);

    this.txt(panelX + 10, panelY + 8, "⚙ 设置", 13, "#ffd86b");

    this.txt(panelX + 10, panelY + 32, "商店牌预览", 11, "#cccccc");
    this.txt(
      panelX + 10,
      panelY + 48,
      "悬停或常驻显示卡牌效果，便于决策。",
      9,
      "#888899"
    );

    const previewOn = this.settings.showShopPreview;
    this.btn(
      panelX + 10,
      panelY + 70,
      120,
      26,
      previewOn ? "✓ 已开启" : "已关闭",
      11,
      previewOn ? "#1f3a26" : "#3a1f26",
      previewOn ? "#aaffcc" : "#ffaacc",
      () => updateSettings({ showShopPreview: !previewOn })
    );

    this.btn(
      panelX + panelW - 70,
      panelY + 70,
      60,
      26,
      "关闭",
      11,
      "#222244",
      "#cccccc",
      () => {
        this.settingsMenuOpen = false;
        this.rebuildUI();
      }
    );
  }

  private drawErrorBanner(): void {
    if (!this.errorText) return;
    this.txtBox(10, 30, BASE_WIDTH - 20, 18, this.errorText, 10, "#441111", "#ffaaaa");
  }

  private showError(message: string): void {
    this.errorText = message;
    this.errorClearTimer?.remove(false);
    this.errorClearTimer = this.time.delayedCall(2600, () => {
      this.errorText = null;
      this.errorClearTimer = null;
      this.rebuildUI();
    });
    this.rebuildUI();
  }

  // ── 对方信息区 ────────────────────────────────────────────────────────────────

  private drawOpponentInfo(vm: BoardViewModel): void {
    const opp = vm.opp;

    let y = this.errorText ? 54 : 32;
    this.txt(10, y, `▌ 对方 [玩家${opp.side + 1}] ${opp.name}`, 13, C_VALUE);
    y += 18;
    this.txt(10, y, `HP: ${opp.hp}   防备: ${opp.block}   手牌数: ${opp.handSize}   牌堆: ${opp.deckSize}`, 12, C_HP);
    y += 16;

    if (opp.venues.length > 0) {
      const hasGuard = opp.venues.some((venue) => venue.isGuard);
      this.txt(10, y, "对方场馆:", 11, C_LABEL);
      y += 14;
      for (const venue of opp.venues) {
        const guardLabel = venue.isGuard ? "【值守】" : "【场馆】";
        const canAttackThisVenue = vm.isMyTurn && vm.me.attackPool > 0 && (!hasGuard || venue.isGuard);
        const attackAmount = Math.min(vm.me.attackPool, venue.durability);

        this.txt(
          20,
          y,
          `${guardLabel} ${vm.getCardName(venue.cardId)}  耐久:${venue.durability}/${venue.maxDurability}`,
          11,
          venue.isGuard ? C_GUARD : C_VENUE
        );

        if (canAttackThisVenue && attackAmount > 0) {
          this.btn(
            240,
            y - 2,
            140,
            18,
            `攻击场馆 ${attackAmount}`,
            9,
            venue.isGuard ? C_GUARD : C_VENUE,
            C_BTN_TXT,
            () => {
              this.roomClient.send({
                type: CMD.ASSIGN_ATTACK,
                assignments: [
                  {
                    amount: attackAmount,
                    target: "venue",
                    targetSide: vm.oppSide,
                    venueInstanceId: venue.instanceId,
                  },
                ],
              });
            }
          );
          y += 22;
        } else {
          if (vm.isMyTurn && vm.me.attackPool > 0 && hasGuard && !venue.isGuard) {
            this.txt(240, y, "需先处理值守场馆", 10, "#ff9999");
          }
          y += 14;
        }
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

    this.hr(0, y, BASE_WIDTH / 2);
  }

  // ── 商店区（三栏 + 固定补给）────────────────────────────────────────────────

  private drawShopArea(vm: BoardViewModel): void {
    const W = BASE_WIDTH;
    const shopX = Math.floor(W / 2);

    let y = this.errorText ? 54 : 32;
    this.txt(shopX + 4, y, "【商  店】", 13, C_TITLE);
    y += 18;

    const canReserve = vm.isMyTurn && !vm.me.hasReservedThisTurn && vm.me.reservedCard === null;
    const laneW = Math.floor((W - shopX - 8) / 3);
    const previewOn = this.settings.showShopPreview;
    // 预览模式下整张卡变高（显示规则文案）；关闭时维持紧凑布局。
    const slotH = previewOn ? 78 : 46;
    const cardBtnH = previewOn ? 20 : 22;
    const reserveBtnH = previewOn ? 16 : 18;

    for (let i = 0; i < vm.market.length; i++) {
      const lane = vm.market[i];
      const lx = shopX + 4 + i * laneW;
      this.txt(lx, y, lane.lane.toUpperCase(), 11, C_LANE);
      for (let si = 0; si < lane.slots.length; si++) {
        const card = lane.slots[si];
        const by = y + 14 + si * slotH;
        if (card) {
          // 预览正文：仅在开启时绘制，作为底层信息块。
          if (previewOn) {
            const previewText = this.composeCardPreviewText(vm, card.id);
            const previewH = slotH - cardBtnH - (canReserve ? reserveBtnH + 2 : 0) - 2;
            if (previewH >= 14) {
              this.txtBox(
                lx,
                by + cardBtnH + (canReserve ? reserveBtnH + 2 : 0) + 1,
                laneW - 4,
                previewH,
                previewText,
                8,
                "#11142a",
                "#9aaecc"
              );
            }
          }

          if (vm.isMyTurn) {
            this.btn(lx, by, laneW - 4, cardBtnH, `${vm.getCardName(card.id)}(买)`, 9, C_BTN_MY, C_BTN_TXT, () => {
              this.roomClient.send({ type: CMD.BUY_MARKET_CARD, instanceId: card.instanceId });
            });
            if (canReserve) {
              this.btn(lx, by + cardBtnH + 2, laneW - 4, reserveBtnH, `预约(1资源)`, 9, C_BTN_RSV, "#aaffcc", () => {
                this.roomClient.send({ type: CMD.RESERVE_MARKET_CARD, instanceId: card.instanceId });
              });
            }
          } else {
            this.txtBox(lx, by, laneW - 4, cardBtnH, vm.getCardName(card.id), 9, C_BTN, C_LABEL);
          }
        } else {
          this.txtBox(lx, by, laneW - 4, slotH - 4, "（空）", 9, C_BTN, "#555555");
        }
      }
    }

    y += 14 + 2 * slotH + 4;

    this.txt(shopX + 4, y, "固定补给:", 11, C_LABEL);
    y += 14;
    const fixedH = previewOn ? 36 : 22;
    for (const cardId of vm.fixedSupplies) {
      const label = `${vm.getCardName(cardId)}（无限，点击买）`;
      if (previewOn) {
        const text = this.composeCardPreviewText(vm, cardId);
        // 把按钮 + 预览文案做成上下两层。
        if (vm.isMyTurn) {
          this.btn(shopX + 4, y, W - shopX - 12, 18, label, 10, C_BTN_MY, C_BTN_TXT, () => {
            this.roomClient.send({ type: CMD.BUY_FIXED_SUPPLY, cardId });
          });
        } else {
          this.txtBox(shopX + 4, y, W - shopX - 12, 18, vm.getCardName(cardId), 10, C_BTN, C_LABEL);
        }
        this.txtBox(shopX + 4, y + 18, W - shopX - 12, fixedH - 18, text, 8, "#11142a", "#9aaecc");
        y += fixedH + 4;
      } else {
        if (vm.isMyTurn) {
          this.btn(shopX + 4, y, W - shopX - 12, 22, label, 10, C_BTN_MY, C_BTN_TXT, () => {
            this.roomClient.send({ type: CMD.BUY_FIXED_SUPPLY, cardId });
          });
        } else {
          this.txtBox(shopX + 4, y, W - shopX - 12, 22, vm.getCardName(cardId), 10, C_BTN, C_LABEL);
        }
        y += 26;
      }
    }
  }

  /**
   * 组合一张卡的预览文案（body + reminder）。文案缺失时回退到 cardId 提示，
   * 让玩家至少能看到这是什么 cardId（便于反馈缺资源问题）。
   */
  private composeCardPreviewText(vm: BoardViewModel, cardId: string): string {
    const text = vm.getCardText(cardId);
    if (!text) return `（暂无文案）${cardId}`;
    let combined = text.body || "";
    if (text.reminder) {
      combined = combined ? `${combined}\n${text.reminder}` : text.reminder;
    }
    return combined || `（暂无文案）${cardId}`;
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

    // pendingDiscardCount 提示（下回合开始时需丢弃）
    if (me.pendingDiscardCount > 0) {
      this.txt(10, y, `⚠ 下回合需弃 ${me.pendingDiscardCount} 张手牌`, 11, "#ffcc44");
      y += 16;
    }

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
    const W = BASE_WIDTH;
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

      // 状态/压力牌：不可打出、不可安排，灰色显示并提示玩家其用途。
      // 否则点击 PLAY_CARD 会被服务端拒绝，触发顶部错误旗，体验差。
      if (vm.isStatusCard(card.id)) {
        const label = vm.isPressureCard(card.id)
          ? `${vm.getCardName(card.id)}\n(占位 · 需用清理效果)`
          : `${vm.getCardName(card.id)}\n(状态牌 · 不可主动操作)`;
        this.txtBox(cx, HAND_Y, CARD_W, CARD_H, label, 9, "#332222", "#aa6666");
        continue;
      }

      if (vm.isMyTurn) {
        const freeSlotIdx = vm.me.scheduleSlots.findIndex((s) => s === null);

        this.btn(cx, HAND_Y, CARD_W, CARD_H - 26, `${vm.getCardName(card.id)}\n(点击打出)`, 9, C_BTN_MY, C_BTN_TXT, () => {
          this.roomClient.send({ type: CMD.PLAY_CARD, instanceId: card.instanceId });
        });

        if (freeSlotIdx !== -1) {
          this.btn(cx, HAND_Y + CARD_H - 24, CARD_W, 22, `打出并安排→槽${freeSlotIdx + 1}`, 9, C_BTN_SCH, C_BTN_TXT, () => {
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
    const W = BASE_WIDTH;
    const BTN_Y = 500;
    const BTN_H = 40;

    if (!vm.started) {
      this.btn(10, BTN_Y, 160, BTN_H, "✓ READY", 14, "#004422", "#aaffaa", () => {
        this.roomClient.send({ type: CMD.READY });
      });
    }

    if (!vm.ended && vm.isMyTurn) {
      const oppSide = vm.oppSide;
      const oppHasGuard = vm.opp.venues.some((venue) => venue.isGuard);

      if (vm.me.attackPool > 0) {
        if (oppHasGuard) {
          this.txt(190, BTN_Y + 12, "⚠ 对方有值守场馆，需先在上方摧毁后才能攻击玩家", 10, "#ffaaaa");
        } else {
          const label = `⚔ 攻击对手（全力 ${vm.me.attackPool}）`;
          this.btn(190, BTN_Y, 220, BTN_H, label, 12, C_BTN_DNG, "#ffaaaa", () => {
            this.roomClient.send({
              type: CMD.ASSIGN_ATTACK,
              assignments: [{ amount: vm.me.attackPool, target: "player", targetSide: oppSide }],
            });
          });
        }
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
      BASE_HEIGHT - 16,
      vm.isMyTurn ? "你的回合 — 点击手牌打出，点击商店购买，点击场馆启动" : "等待对方操作...",
      10,
      "#444466",
      true
    );
  }

  // ── 待处理选择面板 ────────────────────────────────────────────────────────────

  private drawChoicePanel(vm: BoardViewModel, choice: PendingChoiceView): void {
    const W = BASE_WIDTH;
    const H = BASE_HEIGHT;

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

  // ── 事件日志条（底部最近摘要）────────────────────────────────────────────────

  private drawEventLogStrip(): void {
    const W = BASE_WIDTH;
    const H = BASE_HEIGHT;
    const STRIP_Y = H - 58;

    if (this.recentEvents.length === 0) return;

    this.hr(0, STRIP_Y - 2, W);
    this.txt(10, STRIP_Y, "近期事件:", 9, "#555577");

    // 显示最近 4 条
    const shown = this.recentEvents.slice(-4);
    shown.forEach((evt, i) => {
      const sideLabel = evt.side !== undefined ? `P${evt.side + 1}` : "  ";
      const line = `[${sideLabel}] ${evt.type}`;
      this.txt(10 + i * Math.floor((W - 20) / 4), STRIP_Y + 11, line, 8, "#445566");
    });

    // 回放入口按钮
    this.btn(
      W - 124,
      STRIP_Y,
      114,
      30,
      this.replayLoading ? "回放加载中..." : "查看回放",
      9,
      "#222233",
      "#6688aa",
      () => {
        void this.openReplay();
      }
    );
  }

  private async openReplay(): Promise<void> {
    if (this.replayLoading) return;

    this.replayLoading = true;
    this.rebuildUI();

    try {
      const log = await this.roomClient.requestEventLogOnce();
      this.replayLoading = false;
      this.scene.pause();
      this.scene.launch("ReplayScene", {
        roomClient: this.roomClient,
        cardNames: this.cardNames,
        matchLog: log.events,
        parentSceneKey: this.scene.key,
      });
    } catch (err) {
      this.replayLoading = false;
      this.showError(err instanceof Error ? err.message : "加载回放失败");
    }
  }

  // ── UI 辅助工厂（薄包装：统一走 uiKit） ─────────────────────────────────────
  //
  // 这些方法保留是为了兼容大量已有 callsite 的签名（size 仍按数字传入）；
  // 内部完全委派给 createUI 工厂，确保字体栈 / 分辨率 / padding 一处修改全局生效。
  // 同时统一把 size 抬一档：原始 8/9/10 像素的字号在高 DPI 屏依然偏细，
  // 抬到 minSize=10 后既保持布局，又让小字也清晰。

  private adjustSize(size: number): number {
    // 8 → 10，9 → 11，10 → 11；中等及以上字号保持原值。
    if (size <= 8) return 10;
    if (size === 9) return 11;
    if (size === 10) return 11;
    return size;
  }

  private txt(
    x: number, y: number, text: string, size: number,
    color: string, centered = false
  ): Phaser.GameObjects.Text {
    return this.ui.text(x, y, text, {
      size: this.adjustSize(size),
      color,
      centered,
    });
  }

  private hr(x: number, y: number, w: number): void {
    this.ui.hr(x, y, w);
  }

  private txtBox(
    x: number, y: number, w: number, h: number,
    text: string, size: number, bgColor: string, textColor: string
  ): Phaser.GameObjects.Container {
    return this.ui.textBox(x, y, w, h, text, {
      size: this.adjustSize(size),
      bgColor,
      textColor,
    });
  }

  private btn(
    x: number, y: number, w: number, h: number,
    text: string, size: number, bgColor: string, textColor: string,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    return this.ui.button(
      x, y, w, h, text,
      { size: this.adjustSize(size), bgColor, textColor },
      onClick
    );
  }
}
