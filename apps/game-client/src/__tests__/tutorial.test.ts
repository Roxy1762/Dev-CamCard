/**
 * tutorial.test.ts — 新手教程步进状态机测试。
 *
 * 只测纯逻辑层 TutorialController（DOM 层 TutorialOverlay 依赖浏览器环境，
 * 由集成/手测覆盖）。
 *
 * 覆盖：
 *  1. 初始在第 0 步、isFirst
 *  2. next / prev 边界不越界，返回值正确
 *  3. goTo 越界自动夹紧
 *  4. reset 回到首步
 *  5. 默认步骤集非空且每步都有标题与正文
 */
import { describe, it, expect } from "vitest";
import { TutorialController, TUTORIAL_STEPS } from "../game/tutorial";

describe("TutorialController", () => {
  it("初始处于第 0 步且 isFirst", () => {
    const c = new TutorialController();
    expect(c.currentIndex).toBe(0);
    expect(c.isFirst).toBe(true);
    expect(c.isLast).toBe(false);
    expect(c.total).toBe(TUTORIAL_STEPS.length);
  });

  it("next 推进并在末步返回 false（不越界）", () => {
    const steps = [
      { title: "a", body: "1" },
      { title: "b", body: "2" },
    ];
    const c = new TutorialController(steps);
    expect(c.next()).toBe(true);
    expect(c.currentIndex).toBe(1);
    expect(c.isLast).toBe(true);
    // 已在末步：next 不推进
    expect(c.next()).toBe(false);
    expect(c.currentIndex).toBe(1);
  });

  it("prev 后退并在首步返回 false（不越界）", () => {
    const steps = [
      { title: "a", body: "1" },
      { title: "b", body: "2" },
    ];
    const c = new TutorialController(steps);
    c.next();
    expect(c.prev()).toBe(true);
    expect(c.currentIndex).toBe(0);
    expect(c.prev()).toBe(false);
    expect(c.currentIndex).toBe(0);
  });

  it("goTo 越界自动夹紧到合法范围", () => {
    const c = new TutorialController();
    c.goTo(999);
    expect(c.currentIndex).toBe(c.total - 1);
    c.goTo(-5);
    expect(c.currentIndex).toBe(0);
  });

  it("reset 回到首步", () => {
    const c = new TutorialController();
    c.goTo(c.total - 1);
    c.reset();
    expect(c.currentIndex).toBe(0);
  });

  it("空步骤集抛错（开发期防呆）", () => {
    expect(() => new TutorialController([])).toThrow();
  });
});

describe("TUTORIAL_STEPS 默认内容", () => {
  it("非空，且每步都有标题与正文", () => {
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(5);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
    }
  });
});
