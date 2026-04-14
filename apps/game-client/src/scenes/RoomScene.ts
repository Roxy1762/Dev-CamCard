import Phaser from "phaser";
import type { PublicMatchView } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";

const FONT = "monospace";
const C_TITLE = "#ffffff";
const C_LABEL = "#aaaaaa";
const C_VALUE = "#66ccff";
const C_HP = "#88ff88";
const C_BLOCK = "#ffcc44";
const C_LANE = "#cc88ff";

/**
 * RoomScene — 展示来自服务端的 PublicMatchView。
 *
 * 当前阶段：
 *  - 显示 roomId、回合数、双方玩家摘要（hp/block）、三栏商店标题
 *  - 不实现任何交互或动画
 *
 * UI 数据结构严格来自 PublicMatchView（packages/protocol），
 * 不直接写死字段，确保后续接入真实引擎时无缝切换。
 *
 * 后续将：
 *  - 接收 EVT.TURN_STARTED 等事件触发 UI 更新
 *  - 渲染卡牌、场馆、手牌区域（私有视图）
 */
export class RoomScene extends Phaser.Scene {
  private view!: PublicMatchView;
  private roomClient!: RoomClient;
  /** 当前所有 UI 文字对象，重绘时销毁后重建 */
  private uiTexts: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: "RoomScene" });
  }

  /**
   * Phaser 通过 scene.start("RoomScene", { view, roomClient }) 传递数据
   */
  init(data: { view: PublicMatchView; roomClient: RoomClient }): void {
    this.view = data.view;
    this.roomClient = data.roomClient;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0f0f1e");

    // 接管后续状态更新（BootScene 已将 roomClient 传入）
    this.roomClient.onStateUpdate = (newView: PublicMatchView) => {
      this.view = newView;
      this.rebuildUI();
    };

    this.rebuildUI();
  }

  private rebuildUI(): void {
    for (const t of this.uiTexts) t.destroy();
    this.uiTexts = [];

    const W = this.cameras.main.width;
    let y = 20;

    // ── 标题 ──────────────────────────────────────────────────────────────────
    y = this.row(W / 2, y, "Dev-CamCard · 课表风暴", 17, C_TITLE, true) + 10;

    // ── 房间信息 ──────────────────────────────────────────────────────────────
    y = this.row(20, y, `房间 ID: ${this.view.roomId}`, 13, C_LABEL) + 4;
    y = this.row(20, y, `回合: ${this.view.turnNumber}  ·  行动方: 玩家${this.view.activePlayer + 1}`, 13, C_LABEL) + 4;
    y = this.row(20, y, `状态: ${this.view.started ? "进行中" : "等待开始"}`, 13, C_LABEL) + 16;

    // ── 玩家摘要（左右两侧） ──────────────────────────────────────────────────
    const colX = [20, W / 2 + 10];
    const playerY = y;

    for (const player of this.view.players) {
      const x = colX[player.side];
      let py = playerY;

      py = this.row(x, py, `▌ ${player.name}`, 15, C_VALUE) + 6;
      py = this.row(x, py, `生命值  ${player.hp}`, 13, C_HP) + 4;
      py = this.row(x, py, `防备    ${player.block}`, 13, C_BLOCK) + 4;
      py = this.row(x, py, `牌堆 ${player.deckSize}  手牌 ${player.handSize}  弃 ${player.discardSize}`, 12, C_LABEL) + 4;
      py = this.row(x, py, `资源 ${player.resourcePool}  攻击 ${player.attackPool}`, 12, C_LABEL) + 4;

      const slots = player.scheduleSlots
        .map((s, i) => `[${i + 1}: ${s ? s.id : "空"}]`)
        .join(" ");
      py = this.row(x, py, `日程: ${slots}`, 12, C_LABEL) + 4;

      const reserve = player.reservedCard ? player.reservedCard.id : "无";
      this.row(x, py, `预约: ${reserve}`, 12, C_LABEL);
    }

    y = playerY + 130;

    // ── 三栏商店 ──────────────────────────────────────────────────────────────
    y = this.row(20, y, "商  店", 15, C_TITLE) + 10;

    const laneW = (W - 40) / 3;
    for (let i = 0; i < this.view.market.length; i++) {
      const lane = this.view.market[i];
      const lx = 20 + i * laneW;
      this.row(lx, y, `【${lane.lane.toUpperCase()}】`, 14, C_LANE);
      for (let si = 0; si < lane.slots.length; si++) {
        const card = lane.slots[si];
        this.row(lx, y + 20 + si * 16, `  ${card ? card.id : "（空）"}`, 12, C_LABEL);
      }
    }

    y += 60;

    // ── 固定补给 ──────────────────────────────────────────────────────────────
    y = this.row(20, y, "固定补给（无限牌堆）:", 14, C_TITLE) + 6;
    for (const id of this.view.fixedSupplies) {
      y = this.row(30, y, `• ${id}`, 12, C_LABEL) + 4;
    }

    // ── 底部状态 ──────────────────────────────────────────────────────────────
    this.row(
      W / 2,
      this.cameras.main.height - 18,
      "已连接房间 · 规则引擎将在后续版本接入",
      11,
      "#444466",
      true
    );
  }

  /** 添加一行文字，返回 y + fontSize（链式布局辅助） */
  private row(
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    centered = false
  ): number {
    const t = this.add
      .text(x, y, text, { fontSize: `${size}px`, color, fontFamily: FONT })
      .setOrigin(centered ? 0.5 : 0, 0);
    this.uiTexts.push(t);
    return y + size;
  }
}
