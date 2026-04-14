import Phaser from "phaser";
import { RoomClient } from "../network/RoomClient";
import type { PublicMatchView } from "@dev-camcard/protocol";

/**
 * BootScene — 启动 + 连接场景
 *
 * 职责：
 *  1. 显示"正在连接..."占位文字
 *  2. 发起 Colyseus 连接
 *  3. 连接成功 + 收到首个状态后，切换到 RoomScene
 *  4. 连接失败则展示错误文本
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create(): void {
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    this.add
      .text(cx, cy - 40, "Dev-CamCard · 课表风暴", {
        fontSize: "20px",
        color: "#888888",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    const statusText = this.add
      .text(cx, cy + 10, "正在连接房间...", {
        fontSize: "18px",
        color: "#aaaaaa",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    // 建立 RoomClient，注册首次状态回调后再连接
    const roomClient = new RoomClient();
    let transitioned = false;

    // 注册状态回调：收到首个快照时切换到 RoomScene
    roomClient.onStateUpdate = (view: PublicMatchView) => {
      if (transitioned) return;
      transitioned = true;
      // 转交 roomClient 给 RoomScene，让其继续接收后续更新
      this.scene.start("RoomScene", { view, roomClient });
    };

    roomClient.joinOrCreate("game_room", {}).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      statusText.setText(`连接失败: ${msg}`);
      statusText.setColor("#ff6666");
    });
  }
}
