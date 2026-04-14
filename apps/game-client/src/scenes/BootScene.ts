import Phaser from "phaser";

/**
 * BootScene — 最小启动场景
 *
 * 当前阶段：仅显示"客户端已启动"占位文字。
 * 后续将拆分为 PreloadScene → MenuScene → GameScene，
 * 并通过 packages/protocol 命令与 server 通信。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create(): void {
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    this.add
      .text(cx, cy - 24, "客户端已启动", {
        fontSize: "32px",
        color: "#ffffff",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 24, "Dev-CamCard · 课表风暴", {
        fontSize: "16px",
        color: "#888888",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);
  }
}
