/**
 * uiKit.ts — Phaser 文字 / 按钮 / 文本框统一渲染层。
 *
 * 设计目标（"底层重构显示方式"）：
 *  1. 单一真相：所有 scenes 走同一组工厂，再不允许散落的 add.text + 手写 setResolution。
 *     未来调整字体 / 颜色 / 抗锯齿策略只改这一个文件。
 *  2. 高 DPI 清晰：renderResolution() 返回 dpr × cameraZoom，文字纹理在硬件像素层
 *     直接烘焙，不再被 Scale.FIT 的 CSS 拉伸糊掉。
 *  3. 可读字号：默认字体族优先 PingFang / Microsoft YaHei，避免 monospace fallback
 *     在 Windows / Android 上掉到非常细的位图字体（这是上一版"还是糊"的核心元凶）。
 *  4. 边界容错：自动注入 padding，避免高 DPR 烘焙时下沿 / 右沿被裁掉半像素。
 *
 * 使用方式：
 *   const ui = createUI(scene);
 *   const t = ui.text(10, 10, "标题", { size: 14, color: "#fff" });
 *   ui.button(10, 30, 120, 32, "确定", { size: 12 }, () => doIt());
 *
 * 所有工厂返回的 GameObject 都已 push 到 scene 自带的对象池里 —— 调用方只需在
 * rebuildUI 时一次性销毁即可，不再需要手动维护两条引用链。
 */

import Phaser from "phaser";

/** 中文优先字体栈 —— 没有这个 fallback，monospace 在很多桌面 / Android 上是
 *  位图等宽字体，小字号（<= 10px）渲染会出现断笔 / 模糊。*/
export const FONT_STACK =
  '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC","Noto Sans CJK SC",ui-monospace,Menlo,monospace';

export interface TextOpts {
  /** 逻辑字号（CSS px）。会按 cameraZoom 自动放大到画布像素。 */
  size: number;
  color: string;
  /** 是否按 origin 0.5 / 0 居中 X（默认左上角对齐）。 */
  centered?: boolean;
  /** 软换行宽度（逻辑像素）。 */
  wrapWidth?: number;
  /** 多行对齐方式。 */
  align?: "left" | "center" | "right";
  /** 字重，默认 normal。 */
  weight?: "normal" | "bold";
}

export interface ButtonOpts {
  size: number;
  /** 默认 "#222244"。 */
  bgColor?: string;
  /** 默认 "#ffffff"。 */
  textColor?: string;
  /** 默认 "#8888cc"。 */
  borderColor?: string;
}

export interface BoxOpts {
  size: number;
  bgColor: string;
  textColor: string;
  align?: "left" | "center";
}

export interface UIKit {
  /** 文字。 */
  text(x: number, y: number, content: string, opts: TextOpts): Phaser.GameObjects.Text;
  /** 横线 / 分隔器。 */
  hr(x: number, y: number, w: number, color?: number): Phaser.GameObjects.Graphics;
  /** 矩形文本框（无交互），用于展示信息块。 */
  textBox(
    x: number, y: number, w: number, h: number,
    content: string, opts: BoxOpts
  ): Phaser.GameObjects.Container;
  /** 可点击按钮（带 hover 边框反馈）。 */
  button(
    x: number, y: number, w: number, h: number,
    content: string, opts: ButtonOpts,
    onClick: () => void
  ): Phaser.GameObjects.Container;
  /** 半透明遮罩层（弹层用）。 */
  dim(alpha?: number): Phaser.GameObjects.Graphics;
  /** 注入：若调用方维护 uiObjects 数组，传入则自动 push。 */
  track(...objs: Phaser.GameObjects.GameObject[]): void;
}

/**
 * 创建一个 UIKit 实例。
 *
 * @param scene 当前场景
 * @param uiObjects 可选 — 调用方维护的 GameObject 池；本工厂创建的对象会自动
 *                  push 到这里，便于 rebuildUI 时一次性 destroy。
 */
export function createUI(
  scene: Phaser.Scene,
  uiObjects?: Phaser.GameObjects.GameObject[]
): UIKit {
  const track = (...objs: Phaser.GameObjects.GameObject[]) => {
    if (!uiObjects) return;
    for (const o of objs) uiObjects.push(o);
  };

  const renderRes = (): number => {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // cameras.main.zoom 已经放大了画布像素 → 文字烘焙需匹配最终物理像素密度。
    const zoom = scene.cameras.main.zoom || 1;
    return Math.max(1, dpr * zoom);
  };

  const text = (x: number, y: number, content: string, opts: TextOpts): Phaser.GameObjects.Text => {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: `${opts.size}px`,
      fontFamily: FONT_STACK,
      fontStyle: opts.weight === "bold" ? "bold" : "normal",
      color: opts.color,
      // padding 防止高 DPR 下沿 / 右沿被裁切半像素（Phaser 已知问题）。
      padding: { left: 1, right: 1, top: 1, bottom: 2 },
    };
    if (opts.wrapWidth !== undefined) {
      style.wordWrap = { width: opts.wrapWidth };
    }
    if (opts.align) {
      style.align = opts.align;
    }
    const t = scene.add
      .text(x, y, content, style)
      .setOrigin(opts.centered ? 0.5 : 0, 0)
      .setResolution(renderRes());
    track(t);
    return t;
  };

  const hr = (x: number, y: number, w: number, color = 0x333355): Phaser.GameObjects.Graphics => {
    const g = scene.add.graphics();
    g.lineStyle(1, color, 1);
    g.strokeLineShape(new Phaser.Geom.Line(x, y, x + w, y));
    track(g);
    return g;
  };

  const textBox = (
    x: number, y: number, w: number, h: number,
    content: string, opts: BoxOpts
  ): Phaser.GameObjects.Container => {
    const g = scene.add.graphics();
    g.fillStyle(Phaser.Display.Color.HexStringToColor(opts.bgColor).color, 1);
    g.fillRect(0, 0, w, h);

    const align = opts.align ?? "left";
    const tx = align === "center" ? Math.floor(w / 2) : 4;
    const tOriginX = align === "center" ? 0.5 : 0;

    const t = scene.add
      .text(tx, Math.floor(h / 2), content, {
        fontSize: `${opts.size}px`,
        fontFamily: FONT_STACK,
        color: opts.textColor,
        align,
        wordWrap: { width: w - 8 },
        padding: { left: 1, right: 1, top: 1, bottom: 2 },
      })
      .setOrigin(tOriginX, 0.5)
      .setResolution(renderRes());

    const container = scene.add.container(x, y, [g, t]);
    track(container);
    return container;
  };

  const button = (
    x: number, y: number, w: number, h: number,
    content: string, opts: ButtonOpts,
    onClick: () => void
  ): Phaser.GameObjects.Container => {
    const bg = Phaser.Display.Color.HexStringToColor(opts.bgColor ?? "#222244").color;
    const fg = opts.textColor ?? "#ffffff";
    const borderIdle = opts.borderColor
      ? Phaser.Display.Color.HexStringToColor(opts.borderColor).color
      : 0x8888cc;
    const borderHover = 0xaaaaff;

    const g = scene.add.graphics();
    const paint = (borderColor: number, lineWidth: number) => {
      g.clear();
      g.fillStyle(bg, 1);
      g.fillRect(0, 0, w, h);
      g.lineStyle(lineWidth, borderColor, lineWidth === 1 ? 0.6 : 1);
      g.strokeRect(0, 0, w, h);
    };
    paint(borderIdle, 1);

    const t = scene.add
      .text(Math.floor(w / 2), Math.floor(h / 2), content, {
        fontSize: `${opts.size}px`,
        fontFamily: FONT_STACK,
        color: fg,
        align: "center",
        wordWrap: { width: w - 6 },
        padding: { left: 1, right: 1, top: 1, bottom: 2 },
      })
      .setOrigin(0.5, 0.5)
      .setResolution(renderRes());

    const zone = scene.add
      .zone(0, 0, w, h)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    zone.on("pointerdown", onClick);
    zone.on("pointerover", () => paint(borderHover, 2));
    zone.on("pointerout", () => paint(borderIdle, 1));

    const container = scene.add.container(x, y, [g, t, zone]);
    track(container);
    return container;
  };

  const dim = (alpha = 0.55): Phaser.GameObjects.Graphics => {
    const g = scene.add.graphics();
    g.fillStyle(0x000000, alpha);
    // 用世界坐标范围覆盖：当 camera.zoom = dpr 时，cameras.main.width 是画布像素，
    // 不是世界宽度；改用 cam.worldView 给的实际世界视口。
    const view = scene.cameras.main.worldView;
    g.fillRect(view.x, view.y, view.width, view.height);
    track(g);
    return g;
  };

  return { text, hr, textBox, button, dim, track };
}
