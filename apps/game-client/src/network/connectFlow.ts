/**
 * connectFlow — 把 BootScene 里的"多 URL 回退 + 重连降级 + 硬超时"提炼成纯函数，
 * 让回归测试不依赖 Phaser / colyseus.js 真实 socket。
 *
 * 解决的具体网络可达性 bug：
 *  - 旧实现里 reconnect 失败时会跳到下一个 URL，从不在同一 URL 上 fallback 到
 *    joinOrCreate；同 host 反代部署经常因此误判为"网络不可达"。
 *  - 多 URL 试连过程中，旧的 RoomClient 不会被 leave()，泄露 socket / handler。
 *  - joinOrCreate 没有硬超时，URL 不可达时整个连接流程会永远卡住。
 */

export interface ConnectableClient {
  reconnect(): Promise<void>;
  joinOrCreate(roomName: string, options: Record<string, unknown>): Promise<void>;
  /** 主动释放底层连接 / 监听器。重复调用应安全。 */
  leave(): void;
}

export interface ConnectFlowOptions<C extends ConnectableClient> {
  urls: string[];
  hasToken: boolean;
  clearToken: () => void;
  createClient: (url: string) => C;
  /** 单次 reconnect / joinOrCreate 的硬超时。默认 8000ms。 */
  perUrlTimeoutMs?: number;
  onStatus?: (message: string) => void;
  /** 注入定时器（测试用）；默认走 globalThis 的 setTimeout/clearTimeout。 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface ConnectFlowResult<C extends ConnectableClient> {
  client: C;
  url: string;
  /** 在 reconnect 失败后是否走了 joinOrCreate 兜底。 */
  fellBackToJoin: boolean;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function connectWithFallback<C extends ConnectableClient>(
  opts: ConnectFlowOptions<C>
): Promise<ConnectFlowResult<C>> {
  const timeoutMs = opts.perUrlTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const handle = setT(
        () => reject(new Error(`${label} 超时（${timeoutMs}ms 无响应）`)),
        timeoutMs
      );
      p.then(
        (v) => {
          clearT(handle);
          resolve(v);
        },
        (e) => {
          clearT(handle);
          reject(e);
        }
      );
    });

  let hasToken = opts.hasToken;
  let lastErr: unknown = null;
  let current: C | null = null;

  for (let i = 0; i < opts.urls.length; i++) {
    const url = opts.urls[i];
    const prefix = opts.urls.length > 1 ? `(${i + 1}/${opts.urls.length}) ` : "";

    if (current) {
      try {
        current.leave();
      } catch {
        /* ignore */
      }
      current = null;
    }

    current = opts.createClient(url);
    let fellBackToJoin = false;

    if (hasToken) {
      opts.onStatus?.(`检测到断线，尝试重连... ${prefix}${url}`);
      try {
        await withTimeout(current.reconnect(), "重连");
        return { client: current, url, fellBackToJoin: false };
      } catch (err) {
        lastErr = err;
        hasToken = false;
        opts.clearToken();
        fellBackToJoin = true;
        opts.onStatus?.(`重连失败，改为加入新房间... ${prefix}${url}`);
      }
    } else {
      opts.onStatus?.(`正在连接房间... ${prefix}${url}`);
    }

    try {
      await withTimeout(current.joinOrCreate("game_room", {}), "加入房间");
      return { client: current, url, fellBackToJoin };
    } catch (err) {
      lastErr = err;
    }
  }

  if (current) {
    try {
      current.leave();
    } catch {
      /* ignore */
    }
  }
  throw lastErr ?? new Error("连接失败");
}

/**
 * 把底层错误归一化成用户可理解的提示。
 * 浏览器的 WebSocket / fetch 错误信息往往只有 "Failed to fetch" / "Connection failed"，
 * 玩家看到这些根本判断不出是端口问题还是 mixed-content 问题。
 */
export function describeConnectError(err: unknown): string {
  if (err === null || err === undefined) {
    return "连接服务器失败（未知错误）";
  }
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

  const lower = raw.toLowerCase();
  if (lower.includes("超时") || lower.includes("timeout")) {
    return `${raw}（服务器无响应，请确认 server 已启动并放行端口）`;
  }
  if (lower.includes("refused") || lower.includes("econnrefused")) {
    return `${raw}（端口拒绝连接，server 未启动？）`;
  }
  if (
    lower.includes("mixed content") ||
    (lower.includes("insecure") && lower.includes("ws"))
  ) {
    return `${raw}（HTTPS 页面无法连接 ws://，请部署 wss 或同域反代）`;
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return `${raw}（网络不可达：DNS/防火墙/反代未配置？）`;
  }
  return raw || "连接服务器失败（未知错误）";
}
