import Phaser from "phaser";
import type { MatchEvent } from "@dev-camcard/protocol";
import type { RoomClient } from "../network/RoomClient";
import { createUI, type UIKit } from "./uiKit";
import { BASE_WIDTH, BASE_HEIGHT } from "../main";

/**
 * ReplayScene — 最小事件日志回放骨架。
 *
 * 当前能力（MVP shell）：
 *  - 展示完整事件列表（seq / 时间 / 类型 / 操作方）
 *  - 滚动查看（键盘上下方向键 / 点击按钮）
 *  - 作为覆盖层打开，返回后恢复 RoomScene
 *
 * 后续扩展入口：
 *  - 逐事件回放（播放器）：按 seq 重建快照并渲染
 *  - 持久化：从 API 加载历史 MatchEventLog
 */
export class ReplayScene extends Phaser.Scene {
  private matchLog: MatchEvent[] = [];
  private scrollOffset = 0;
  private roomClient?: RoomClient;
  private parentSceneKey: string | null = null;
  private loading = false;
  private errorMessage: string | null = null;

  /** UI 对象列表（rerender 时销毁） */
  private uiObjects: Phaser.GameObjects.GameObject[] = [];
  private ui!: UIKit;
  private dpr = 1;

  constructor() {
    super({ key: "ReplayScene" });
  }

  init(data: {
    roomClient?: RoomClient;
    cardNames?: ReadonlyMap<string, string>;
    matchLog?: MatchEvent[];
    parentSceneKey?: string;
    dpr?: number;
  }): void {
    this.roomClient = data.roomClient;
    this.matchLog = data.matchLog ?? [];
    this.parentSceneKey = data.parentSceneKey ?? null;
    this.scrollOffset = 0;
    this.loading = false;
    this.errorMessage = null;
    this.dpr = data.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#080818");
    this.cameras.main.setOrigin(0, 0);
    if (this.dpr !== 1) this.cameras.main.setZoom(this.dpr);
    this.ui = createUI(this, this.uiObjects);

    // 若外部未提前注入完整日志，则按需拉取一次。
    if (this.matchLog.length === 0 && this.roomClient) {
      this.loading = true;
      void this.roomClient
        .requestEventLogOnce()
        .then((log) => {
          this.matchLog = log.events;
          this.scrollOffset = 0;
          this.loading = false;
          this.errorMessage = null;
          this.rerender();
        })
        .catch((err) => {
          this.loading = false;
          this.errorMessage = err instanceof Error ? err.message : "拉取事件日志失败";
          this.rerender();
        });
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

    const W = BASE_WIDTH;

    // 标题栏
    this.ui.text(W / 2, 12, "事件日志 / 回放骨架", { size: 16, color: "#aaaaff", centered: true, weight: "bold" });
    this.ui.hr(0, 32, W, 0x222244);

    // 返回按钮
    this.ui.button(W - 90, 6, 80, 24, "← 返回", { size: 11, bgColor: "#222244", textColor: "#8888cc" }, () => {
      if (this.parentSceneKey) {
        this.scene.stop("ReplayScene");
        this.scene.resume(this.parentSceneKey);
        return;
      }
      this.scene.start("BootScene");
    });

    if (this.loading) {
      this.ui.text(W / 2, BASE_HEIGHT / 2, "正在加载完整事件日志…", { size: 14, color: "#7777aa", centered: true });
      return;
    }

    if (this.errorMessage) {
      this.ui.text(W / 2, BASE_HEIGHT / 2, this.errorMessage, { size: 14, color: "#ff8888", centered: true });
      return;
    }

    if (this.matchLog.length === 0) {
      this.ui.text(W / 2, BASE_HEIGHT / 2, "（暂无事件记录）", { size: 14, color: "#666677", centered: true });
      return;
    }

    // 表头
    let y = 40;
    this.ui.text(10, y, "seq", { size: 11, color: "#8888aa" });
    this.ui.text(50, y, "时间(ms)", { size: 11, color: "#8888aa" });
    this.ui.text(130, y, "类型", { size: 11, color: "#8888aa" });
    this.ui.text(360, y, "操作方", { size: 11, color: "#8888aa" });
    this.ui.text(420, y, "数据摘要", { size: 11, color: "#8888aa" });
    this.ui.hr(0, y + 14, W, 0x222244);
    y += 18;

    const ROW_H = 16;
    const visible = this.matchLog.slice(this.scrollOffset, this.scrollOffset + 30);

    for (const evt of visible) {
      const color = this.eventColor(evt.type);
      const sideLabel = evt.side !== undefined ? `P${evt.side + 1}` : "-";
      const dataStr = evt.data ? JSON.stringify(evt.data).slice(0, 60) : "";
      const tsStr = String(evt.ts).slice(-6); // 最后6位 ms，足够区分

      this.ui.text(10, y, String(evt.seq), { size: 10, color: "#666688" });
      this.ui.text(50, y, tsStr, { size: 10, color: "#666688" });
      this.ui.text(130, y, evt.type, { size: 11, color });
      this.ui.text(360, y, sideLabel, { size: 11, color: "#6688aa" });
      this.ui.text(420, y, dataStr, { size: 10, color: "#667788" });
      y += ROW_H;
    }

    // 分页提示
    const total = this.matchLog.length;
    const end = Math.min(this.scrollOffset + 30, total);
    this.ui.text(
      W / 2, y + 4,
      `显示 ${this.scrollOffset + 1}–${end} / 共 ${total} 条  (↑↓ 键滚动)`,
      { size: 11, color: "#666688", centered: true }
    );

    // 滚动按钮
    if (this.scrollOffset > 0) {
      this.ui.button(10, y, 60, 20, "↑ 上", { size: 11, bgColor: "#222233", textColor: "#8888cc" }, () => {
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.rerender();
      });
    }
    if (end < total) {
      this.ui.button(80, y, 60, 20, "↓ 下", { size: 11, bgColor: "#222233", textColor: "#8888cc" }, () => {
        this.scrollOffset = Math.min(total - 15, this.scrollOffset + 10);
        this.rerender();
      });
    }
  }

  private eventColor(type: string): string {
    if (type === "MATCH_START" || type === "MATCH_END") return "#ffcc44";
    if (type === "ASSIGN_ATTACK") return "#ff6666";
    if (type === "PLAY_CARD") return "#88ccff";
    if (type === "BUY_MARKET_CARD" || type === "BUY_FIXED_SUPPLY") return "#88ffcc";
    if (type === "CONCEDE") return "#ff4444";
    return "#8888aa";
  }
}
