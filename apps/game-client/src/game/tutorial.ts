/**
 * tutorial.ts — 新手教程（首进对局引导 + 随时可重看）。
 *
 * 拆成两层，便于测试与复用：
 *  - TutorialController：纯粹的步进状态机（当前步 / 上一步 / 下一步 / 跳转），
 *    不碰 DOM，可在 Node/Vitest 直接单测。
 *  - TutorialOverlay：把 controller 投影到一个模态卡片（标题 / 正文 / 进度点 /
 *    上一步·下一步·跳过），并在关闭时把 settings.tutorialSeen 置 true。
 *
 * 为什么是"模态轮播"而非"高亮指向真实元素"？
 *  - 牌桌元素随对局状态频繁重绘（每次 applyState 全量重建 DOM），用绝对定位去
 *    指向某个会被销毁重建的节点很脆弱。模态轮播的文案稳定、永远可读、对状态零
 *    依赖，作为"完备新手教程"的首版既稳又清晰。后续如需"指哪打哪"高亮可在此之上叠加。
 */

import { updateSettings } from "../settings/clientSettings";

export interface TutorialStep {
  title: string;
  body: string;
}

/**
 * 教程步骤 —— 覆盖一局对战需要理解的全部基础概念。
 * 顺序与玩家实际操作流程对齐：目标 → 资源面板 → 商店/价格 → 预约 → 手牌/打出 →
 * 日程 → 场馆/值守 → 攻击 → 回合流转/回放。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "👋 欢迎来到《课表风暴》",
    body: "这是一局 1v1 卡牌对战。你的目标只有一个：把对手的 HP 打到 0。\n\n每回合你会摸牌、用资源购买更强的牌、打出手牌触发效果，再用攻击点数打击对手。下面用几步带你看懂整个牌桌。",
  },
  {
    title: "🧭 顶部信息栏",
    body: "最上方显示房间号（可复制邀请好友）与当前回合状态：轮到你时会显示「● 我的回合」，否则是「○ 等待对方」。只有在自己的回合才能行动。",
  },
  {
    title: "💠 你的资源面板",
    body: "我方面板上有几个关键数值：\n· HP —— 生命值，归零即落败。\n· 防备 —— 抵挡攻击的护盾，会跨回合保留。\n· 资源 —— 用来购买商店牌，每回合刷新。\n· 攻击 —— 用来打击对手，每回合刷新。\n· 牌堆 / 弃 —— 抽牌来源与已用过的牌。",
  },
  {
    title: "🛒 商店三栏与价格",
    body: "商店分 COURSE / ACTIVITY / DAILY 三栏。每张牌右上角的圆形价签就是它的「资源消耗」。\n\n资源够才能买，买不起时整张牌会变灰、购买按钮禁用。购买的牌会进入你的弃牌堆，洗牌后就能摸到。价签颜色还区分稀有度（普通 / 优良 / 稀有）。",
  },
  {
    title: "📌 预约位",
    body: "在商店牌上点「预约」会花 1 资源把它放进你的预约位，并立即从牌堆补一张新牌到商店。\n\n预约的牌「下一回合」可以用「折扣 1」的价格买下（价签会显示折后价）。适合先占住一张关键牌，等资源够了再拿。",
  },
  {
    title: "🃏 手牌与打出",
    body: "手牌区在下方。轮到你时，点「点击打出」即可结算这张牌的效果（获得资源 / 攻击 / 抽牌 / 防备等）。\n\n灰色的状态牌（如「压力」）不能主动打出，需要用特定效果清理。把鼠标悬停在牌上可以看到完整规则文字。",
  },
  {
    title: "🗓️ 安排到日程槽",
    body: "很多牌除了「打出」还能「安排→槽」。安排到日程槽的牌不会立刻结算，而是在你「下一回合开始时」触发额外效果（例如多摸牌、多获得攻击）。\n\n手牌上方的状态条会实时显示「已安排 / 已预约 / 有场馆」，方便判断带条件的牌能否触发。",
  },
  {
    title: "🏛️ 场馆与值守",
    body: "「场馆」是留在场上的持续牌，每回合可「启动」一次获得增益。它有耐久，被攻击到 0 会被摧毁。\n\n带「值守」的场馆是你的盾墙：对手必须先摧毁你所有值守场馆，才能攻击你的玩家或其它场馆。",
  },
  {
    title: "⚔️ 发起攻击",
    body: "有攻击点数时，可以「全力攻击对手玩家」，或点对方某个场馆上的「攻击」按钮定点拆除。\n\n如果对手有值守场馆，会提示「需先处理值守」——先把值守打掉，才能继续打脸。",
  },
  {
    title: "⏎ 结束回合与回放",
    body: "行动完毕点「结束回合」把行动权交给对手。随时可以「投降」认输。\n\n对局结束后（或过程中）点「查看回放」可以逐事件复盘整局走势。\n\n准备好了吗？随时点右上角「❔ 教程」可以再看一遍。祝你好运！",
  },
];

/**
 * TutorialController — 教程步进状态机（纯逻辑，无 DOM）。
 */
export class TutorialController {
  private index = 0;

  constructor(private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS) {
    if (steps.length === 0) {
      throw new Error("[tutorial] 步骤列表不能为空");
    }
  }

  get total(): number {
    return this.steps.length;
  }

  get currentIndex(): number {
    return this.index;
  }

  get current(): TutorialStep {
    return this.steps[this.index]!;
  }

  get isFirst(): boolean {
    return this.index === 0;
  }

  get isLast(): boolean {
    return this.index === this.steps.length - 1;
  }

  /** 前进一步；已在末步返回 false（不越界）。 */
  next(): boolean {
    if (this.isLast) return false;
    this.index += 1;
    return true;
  }

  /** 后退一步；已在首步返回 false（不越界）。 */
  prev(): boolean {
    if (this.isFirst) return false;
    this.index -= 1;
    return true;
  }

  /** 跳转到指定步（越界自动夹紧到合法范围）。 */
  goTo(i: number): void {
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
  }

  /** 回到第一步。 */
  reset(): void {
    this.index = 0;
  }
}

/** TutorialOverlay 所需的 DOM 节点集合。 */
export interface TutorialDom {
  modal: HTMLElement;
  dots: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  progress: HTMLElement;
  skipBtn: HTMLButtonElement;
}

/**
 * TutorialOverlay — 把 TutorialController 渲染成模态卡片。
 *
 * 关闭策略：任何方式关闭（看完 / 跳过 / 点遮罩）都会把 tutorialSeen 置 true，
 * 这样首进自动弹出只发生一次；之后只能通过右上角「❔ 教程」按钮主动重看。
 */
export class TutorialOverlay {
  private readonly controller = new TutorialController();
  private readonly dom: TutorialDom;
  private bound = false;

  constructor(dom: TutorialDom) {
    this.dom = dom;
    this.bind();
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.dom.prevBtn.addEventListener("click", () => {
      this.controller.prev();
      this.render();
    });
    this.dom.nextBtn.addEventListener("click", () => {
      if (this.controller.isLast) {
        this.close();
      } else {
        this.controller.next();
        this.render();
      }
    });
    this.dom.skipBtn.addEventListener("click", () => this.close());
    this.dom.modal.addEventListener("click", (e) => {
      if (e.target === this.dom.modal) this.close();
    });
  }

  /** 打开教程（从第一步开始）。 */
  open(): void {
    this.controller.reset();
    this.render();
    this.dom.modal.classList.remove("hidden");
  }

  /** 关闭教程并标记 tutorialSeen。 */
  close(): void {
    this.dom.modal.classList.add("hidden");
    updateSettings({ tutorialSeen: true });
  }

  private render(): void {
    const step = this.controller.current;
    this.dom.title.textContent = step.title;

    // 多段正文：按换行拆成段落，保证长文案可读。
    this.dom.body.innerHTML = "";
    for (const para of step.body.split("\n")) {
      const p = document.createElement("p");
      p.textContent = para;
      if (para.trim() === "") p.className = "spacer";
      this.dom.body.appendChild(p);
    }

    // 进度点
    this.dom.dots.innerHTML = "";
    for (let i = 0; i < this.controller.total; i++) {
      const dot = document.createElement("span");
      dot.className = "dot" + (i === this.controller.currentIndex ? " active" : "");
      this.dom.dots.appendChild(dot);
    }

    this.dom.progress.textContent = `${this.controller.currentIndex + 1} / ${this.controller.total}`;
    this.dom.prevBtn.disabled = this.controller.isFirst;
    this.dom.nextBtn.textContent = this.controller.isLast ? "完成 ✓" : "下一步 ▶";
  }
}

/**
 * readTutorialDom — 从根元素查出教程所需的全部节点。
 * 缺失任一节点直接抛错，便于在开发期发现 index.html 与代码不同步。
 */
export function readTutorialDom(root: ParentNode = document): TutorialDom {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`[tutorial] 缺少 DOM 元素 #${id}`);
    return el;
  };
  return {
    modal: $("g-tutorial-modal"),
    dots: $("g-tutorial-dots"),
    title: $("g-tutorial-title"),
    body: $("g-tutorial-body"),
    prevBtn: $<HTMLButtonElement>("g-tutorial-prev"),
    nextBtn: $<HTMLButtonElement>("g-tutorial-next"),
    progress: $("g-tutorial-progress"),
    skipBtn: $<HTMLButtonElement>("g-tutorial-skip"),
  };
}
