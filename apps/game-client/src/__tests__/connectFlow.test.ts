import { describe, it, expect, vi } from "vitest";
import {
  connectWithFallback,
  describeConnectError,
  type ConnectableClient,
} from "../network/connectFlow";

/**
 * 这些测试盯死的是“用户端网络不可达”这一类回归：
 *  - reconnect 失败时必须在 *同一个 URL* 上 fallback 到 joinOrCreate；
 *  - 任意一步失败时，旧的 RoomClient 必须被 leave()；
 *  - URL 卡住时，硬超时必须触发，否则永远不会切换到下一个候选 URL。
 */

type Behavior = "ok" | "fail" | "hang";

class FakeClient implements ConnectableClient {
  reconnectCalls = 0;
  joinCalls = 0;
  leaveCalls = 0;

  constructor(
    public readonly url: string,
    public readonly reconnectBehavior: Behavior,
    public readonly joinBehavior: Behavior
  ) {}

  reconnect(): Promise<void> {
    this.reconnectCalls += 1;
    return run(this.reconnectBehavior, "reconnect failed");
  }

  joinOrCreate(): Promise<void> {
    this.joinCalls += 1;
    return run(this.joinBehavior, "joinOrCreate failed");
  }

  leave(): void {
    this.leaveCalls += 1;
  }
}

function run(b: Behavior, errMsg: string): Promise<void> {
  if (b === "ok") return Promise.resolve();
  if (b === "fail") return Promise.reject(new Error(errMsg));
  return new Promise(() => {
    /* hang forever */
  });
}

function setupTimers() {
  // 用 fake timer 让“硬超时”立刻可触发，而不是真的等 8 秒。
  vi.useFakeTimers();
}

function teardownTimers() {
  vi.useRealTimers();
}

describe("connectWithFallback — 用户端网络不可达回归", () => {
  it("reconnect 失败时，应该在同一 URL 上 fallback 到 joinOrCreate（不要直接跳下一个 URL）", async () => {
    const created: FakeClient[] = [];
    const clearToken = vi.fn();

    const promise = connectWithFallback({
      urls: ["wss://primary", "ws://fallback:2567"],
      hasToken: true,
      clearToken,
      createClient: (url) => {
        // primary：reconnect 必败、但 joinOrCreate 成功
        const fake = new FakeClient(url, "fail", "ok");
        created.push(fake);
        return fake;
      },
    });

    const result = await promise;

    expect(result.url).toBe("wss://primary");
    expect(result.fellBackToJoin).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].reconnectCalls).toBe(1);
    expect(created[0].joinCalls).toBe(1);
    expect(clearToken).toHaveBeenCalledTimes(1);
  });

  it("整个 URL 不可达（reconnect+join 均失败）时，应清理旧 client 并尝试下一个 URL", async () => {
    const created: FakeClient[] = [];

    const result = await connectWithFallback({
      urls: ["wss://primary", "ws://fallback:2567"],
      hasToken: true,
      clearToken: () => {},
      createClient: (url) => {
        const fake =
          url === "wss://primary"
            ? new FakeClient(url, "fail", "fail")
            : new FakeClient(url, "fail", "ok");
        created.push(fake);
        return fake;
      },
    });

    expect(result.url).toBe("ws://fallback:2567");
    expect(created).toHaveLength(2);
    // 关键：primary 失败后必须 leave()，否则 socket / handler 泄漏
    expect(created[0].leaveCalls).toBe(1);
    // fallback 这条线 reconnect 不应被尝试（token 已被 clear）
    expect(created[1].reconnectCalls).toBe(0);
    expect(created[1].joinCalls).toBe(1);
  });

  it("硬超时：reconnect 卡住时不能永远不 fallback", async () => {
    setupTimers();
    try {
      const created: FakeClient[] = [];
      const promise = connectWithFallback({
        urls: ["wss://primary", "ws://fallback:2567"],
        hasToken: true,
        clearToken: () => {},
        perUrlTimeoutMs: 1000,
        createClient: (url) => {
          const fake =
            url === "wss://primary"
              ? new FakeClient(url, "hang", "hang") // 全卡死
              : new FakeClient(url, "fail", "ok");
          created.push(fake);
          return fake;
        },
      });

      // 推进“假”时钟：先触发 reconnect 超时 → 进入 join 兜底，再触发 join 超时 → 切下一个 URL
      await vi.advanceTimersByTimeAsync(1000); // reconnect timeout
      await vi.advanceTimersByTimeAsync(1000); // joinOrCreate timeout
      const result = await promise;

      expect(result.url).toBe("ws://fallback:2567");
      expect(created[0].leaveCalls).toBe(1);
    } finally {
      teardownTimers();
    }
  });

  it("无 token 时：每个 URL 只走 joinOrCreate，不应触发 reconnect", async () => {
    const created: FakeClient[] = [];
    const result = await connectWithFallback({
      urls: ["wss://primary", "ws://fallback:2567"],
      hasToken: false,
      clearToken: () => {},
      createClient: (url) => {
        const fake = new FakeClient(url, "fail", url.startsWith("wss") ? "fail" : "ok");
        created.push(fake);
        return fake;
      },
    });

    expect(result.url).toBe("ws://fallback:2567");
    expect(created.every((c) => c.reconnectCalls === 0)).toBe(true);
  });

  it("全部 URL 都失败时抛错并清理最后一个 client", async () => {
    const created: FakeClient[] = [];
    await expect(
      connectWithFallback({
        urls: ["wss://a", "wss://b"],
        hasToken: false,
        clearToken: () => {},
        createClient: (url) => {
          const fake = new FakeClient(url, "fail", "fail");
          created.push(fake);
          return fake;
        },
      })
    ).rejects.toThrow();

    // 第一个被切换前 leave，第二个在 throw 前 leave
    expect(created[0].leaveCalls).toBe(1);
    expect(created[1].leaveCalls).toBe(1);
  });
});

describe("describeConnectError — 把底层错误翻译成玩家能看懂的提示", () => {
  it("超时", () => {
    expect(describeConnectError(new Error("加入房间 超时（8000ms 无响应）"))).toMatch(
      /服务器无响应/
    );
  });
  it("ECONNREFUSED", () => {
    expect(describeConnectError(new Error("connect ECONNREFUSED 127.0.0.1:2567"))).toMatch(
      /端口拒绝连接/
    );
  });
  it("Failed to fetch", () => {
    expect(describeConnectError(new Error("TypeError: Failed to fetch"))).toMatch(
      /网络不可达/
    );
  });
  it("mixed content", () => {
    expect(
      describeConnectError(new Error("Mixed Content: tried to connect ws://"))
    ).toMatch(/HTTPS 页面无法连接/);
  });
  it("非 Error 对象兜底", () => {
    expect(describeConnectError({ message: "boom" })).toBe("boom");
    expect(describeConnectError("plain string")).toBe("plain string");
    expect(describeConnectError(null)).toBe("连接服务器失败（未知错误）");
  });
});
