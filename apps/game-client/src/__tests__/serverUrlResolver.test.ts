/**
 * serverUrlResolver.test.ts
 *
 * 紧盯本次生产事故根因：浏览器在公网域名打开页面，却尝试连接 ws://localhost:2567。
 *
 * 复现条件（任何一个命中都会出事）：
 *  1. 镜像 build 时 VITE_SERVER_URL 被错误烧成了 ws://localhost:2567
 *  2. 旧产物残留：以前曾烧入过 localhost，后续构建没清缓存
 *  3. 多人协作时把开发期 .env 不小心带到生产
 *
 * 修复后行为：
 *  - 浏览器在 loopback host 打开 → 仍然信任 explicit URL（开发期合理用法）
 *  - 浏览器在非 loopback host 打开 → 忽略 explicit=loopback 这种"显式坏配置"，
 *    回退到按 window.location 推导的 sameHost + sameHost:2567
 *  - 没有 explicit 时：返回 sameHost + sameHost:2567，覆盖"反代/直连"两套部署
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveDefaultServerUrls,
  __resetServerUrlsCacheForTests,
} from "../network/RoomClient";

function setLocation(url: string): void {
  // jsdom 默认提供 window.location；vitest 使用 happy-dom 时也兼容 .stubGlobal。
  // 直接重写 location 在两种环境下都有限制，所以采用 stubGlobal 整对象。
  const u = new URL(url);
  vi.stubGlobal("window", {
    location: {
      href: u.href,
      origin: u.origin,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
    },
  });
}

function setExplicit(value: string | undefined): void {
  // import.meta.env.VITE_SERVER_URL 是 Vite 在 build 时替换的字面量。
  // 模块代码里通过可选链读取，这里用 stubGlobal 的方式没法直接覆盖 import.meta，
  // 因此通过 vi.stubEnv("VITE_SERVER_URL", ...) 走 vitest 内置的 env 桥。
  if (value === undefined) {
    vi.stubEnv("VITE_SERVER_URL", "");
  } else {
    vi.stubEnv("VITE_SERVER_URL", value);
  }
}

describe("resolveDefaultServerUrls — 公网域名拒绝去连 localhost", () => {
  beforeEach(() => {
    __resetServerUrlsCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    __resetServerUrlsCacheForTests();
  });

  it("HTTPS 公网域名 + explicit=ws://localhost:2567 → 必须忽略 explicit，走同 host wss", () => {
    setLocation("https://card1.example.top/");
    setExplicit("ws://localhost:2567");
    const urls = resolveDefaultServerUrls();
    expect(urls).not.toContain("ws://localhost:2567");
    expect(urls[0]).toBe("wss://card1.example.top");
    expect(urls).toContain("wss://card1.example.top:2567");
  });

  it("HTTPS 公网域名 + explicit=ws://127.0.0.1:2567 → 同样忽略 loopback", () => {
    setLocation("https://play.example.com/");
    setExplicit("ws://127.0.0.1:2567");
    const urls = resolveDefaultServerUrls();
    expect(urls.some((u) => u.includes("127.0.0.1"))).toBe(false);
    expect(urls[0]).toBe("wss://play.example.com");
  });

  it("HTTPS 公网域名 + 无 explicit → 同 host wss + :2567 兜底", () => {
    setLocation("https://card1.example.top/");
    setExplicit(undefined);
    const urls = resolveDefaultServerUrls();
    expect(urls[0]).toBe("wss://card1.example.top");
    expect(urls).toContain("wss://card1.example.top:2567");
  });

  it("本地开发：localhost + explicit=ws://localhost:2567 → 信任 explicit（不视为坏配置）", () => {
    setLocation("http://localhost:3000/");
    setExplicit("ws://localhost:2567");
    const urls = resolveDefaultServerUrls();
    expect(urls).toContain("ws://localhost:2567");
  });

  it("公网域名 + explicit 指向另一个公网域名 → 正常使用 explicit + 当前 host 兜底", () => {
    setLocation("https://card1.example.top/");
    setExplicit("wss://play.other.com");
    const urls = resolveDefaultServerUrls();
    expect(urls[0]).toBe("wss://play.other.com");
    expect(urls).toContain("wss://card1.example.top");
    expect(urls).toContain("wss://card1.example.top:2567");
  });

  it("HTTP/HTTPS scheme 自动归一为 ws/wss", () => {
    setLocation("http://192.168.1.5:3000/");
    setExplicit("http://192.168.1.5:2567");
    const urls = resolveDefaultServerUrls();
    expect(urls).toContain("ws://192.168.1.5:2567");
  });
});
