import Phaser from "phaser";
import type { MatchEvent, MatchEventLog } from "@dev-camcard/protocol";
import { EVT } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";

const FONT = "monospace";

/**
 * ReplayScene — 最小事件日志回放骨架。
 *
 * 当前能力（MVP shell）：
 *  - 展示服务端推送的完整事件列表（seq / 时间 / 类型 / 操作方）
 *  - 滚动查看（键盘上下方向键 / 点击按钮）
 *  - 点击"返回"回到 RoomScene
 *
 * 后续扩展入口：
 *  - 逐事件回放（播放器）：按 seq 重建快照并渲染
 *  - 持久化：从 API 加载历史 MatchEventLog
 */
export class ReplayScene extends Phaser.Scene {
  private matchLog: MatchEvent[] = [];
  private scrollOffset = 0;
  private roomClient!: RoomClient;
  private cardNames?: ReadonlyMap<string, string>;

  /** UI 对象列表（rerender 时销毁） */
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: "ReplayScene" });
  }

  init(data: {
    roomClient?: RoomClient;
    cardNames?: ReadonlyMap<string, string>;
    matchLog?: MatchEvent[];
  }): void {
    this.roomClient = data.roomClient!;
    this.cardNames = data.cardNames;
    this.matchLog = data.matchLog ?? [];
    this.scrollOffset = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#080818");

    // 若 roomClient 存在，监听完整事件日志推送（服务端响应 REQUEST_MATCH_EVENTS）
    if (this.roomClient) {
      this.roomClient.onEventLog = (log: MatchEventLog) => {
        this.matchLog = log.events;
        this.scrollOffset = 0;
        this.rerender();
      };
    }

    // 方向键滚动
    this.input.keyboard?.on("keydown-UP", () => {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.rerender();
    });
    this.input.keyboard?.on("keydown-DOWN", () => {
      this.scrollOffset = Math.min(Math.max(0, this.matchLog.length - 15), this.scrollOffset + 1);
      this.rerender();
    });

    this.rerender();
  }

  private rerender(): void {
    for (const obj of this.uiObjects) obj.destroy();
    this.uiObjects = [];

    const W = this.cameras.main.width;

    // 标题栏
    this.t(W / 2, 12, "事件日志 / 回放骨架", 14, "#aaaaff", true);
    this.hr(0, 28, W);

    // 返回按钮
    this.btn(W - 90, 6, 80, 22, "← 返回", 10, "#222244", "#8888cc", () => {
      this.scene.start("RoomScene");
    });

    if (this.matchLog.length === 0) {
      this.t(W / 2, 200, "（暂无事件记录）", 13, "#555566", true);
      return;
    }

    // 表头
    let y = 36;
    this.t(10,  y, "seq", 9, "#555577");
    this.t(50,  y, "时间(ms)", 9, "#555577");
    this.t(130, y, "类型", 9, "#555577");
    this.t(360, y, "操作方", 9, "#555577");
    this.t(420, y, "数据摘要", 9, "#555577");
    this.hr(0, y + 12, W);
    y += 16;

    const ROW_H = 14;
    const visible = this.matchLog.slice(this.scrollOffset, this.scrollOffset + 30);

    for (const evt of visible) {
      const color = this.eventColor(evt.type);
      const sideLabel = evt.side !== undefined ? `P${evt.side + 1}` : "-";
      const dataStr = evt.data ? JSON.stringify(evt.data).slice(0, 60) : "";
      const tsStr = String(evt.ts).slice(-6); // 最后6位 ms，足够区分

      this.t(10,  y, String(evt.seq), 8, "#444466");
      this.t(50,  y, tsStr, 8, "#444466");
      this.t(130, y, evt.type, 9, color);
      this.t(360, y, sideLabel, 9, "#6688aa");
      this.t(420, y, dataStr, 8, "#445566");
      y += ROW_H;
    }

    // 分页提示
    const total = this.matchLog.length;
    const end = Math.min(this.scrollOffset + 30, total);
    this.t(W / 2, y + 4,
      `显示 ${this.scrollOffset + 1}–${end} / 共 ${total} 条  (↑↓ 键滚动)`,
      9, "#444466", true);

    // 滚动按钮
    if (this.scrollOffset > 0) {
      this.btn(10, y, 60, 18, "↑ 上", 9, "#222233", "#8888cc", () => {
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.rerender();
      });
    }
    if (end < total) {
      this.btn(80, y, 60, 18, "↓ 下", 9, "#222233", "#8888cc", () => {
        this.scrollOffset = Math.min(total - 15, this.scrollOffset + 10);
        this.rerender();
      });
    }
  }

  private eventColor(type: string): string {
    if (type === "MATCH_START" || type === "MATCH_END") return "#ffcc44";
    if (type === EVT.MATCH_ENDED) return "#ff8844";
    if (type === "ASSIGN_ATTACK") return "#ff6666";
    if (type === "PLAY_CARD") return "#88ccff";
    if (type === "BUY_MARKET_CARD" || type === "BUY_FIXED_SUPPLY") return "#88ffcc";
    if (type === "CONCEDE") return "#ff4444";
    return "#8888aa";
  }

  // ── 辅助工厂 ─────────────────────────────────────────────────────────────────

  private t(x: number, y: number, text: string, size: number, color: string, centered = false): void {
    const obj = this.add.text(x, y, text, { fontSize: `${size}px`, color, fontFamily: FONT })
      .setOrigin(centered ? 0.5 : 0, 0);
    this.uiObjects.push(obj);
  }

  private hr(x: number, y: number, w: number): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x222244, 1);
    g.strokeLineShape(new Phaser.Geom.Line(x, y, x + w, y));
    this.uiObjects.push(g);
  }

  private btn(
    x: number, y: number, w: number, h: number,
    text: string, size: number, bg: string, fg: string,
    onClick: () => void
  ): void {
    const g = this.add.graphics();
    const c = Phaser.Display.Color.HexStringToColor(bg);
    g.fillStyle(c.color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(1, 0x8888cc, 0.5);
    g.strokeRect(0, 0, w, h);

    const t = this.add.text(Math.floor(w / 2), Math.floor(h / 2), text, {
      fontSize: `${size}px`, color: fg, fontFamily: FONT,
    }).setOrigin(0.5, 0.5);

    const zone = this.add.zone(0, 0, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerdown", onClick);

    const container = this.add.container(x, y, [g, t, zone]);
    this.uiObjects.push(container);
  }
}
