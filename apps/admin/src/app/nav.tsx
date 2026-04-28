import Link from "next/link";
import { HealthBadge } from "./health-badge";

interface NavProps {
  current: "matches" | "cards";
  apiBase: string;
}

const linkBase: React.CSSProperties = {
  textDecoration: "none",
  padding: "0.4rem 0.9rem",
  borderRadius: 6,
  border: "1px solid #ddd",
  color: "#333",
};

const linkActive: React.CSSProperties = {
  ...linkBase,
  background: "#222",
  color: "#fff",
  borderColor: "#222",
};

/**
 * 顶部导航 + 后台访问地址。把 apiBase 印在页面上、健康指示灯每 15s 自动探测，
 * 运维一眼能看出 admin 当前是连到哪台 server、core 与 db 是不是都活着，
 * 避免"配错 NEXT_PUBLIC_API_BASE 但没人发现"的状况。
 */
export function Nav({ current, apiBase }: NavProps) {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: "1.6rem", margin: 0 }}>
          Dev-CamCard · 课表风暴  运营后台
        </h1>
        <HealthBadge />
      </div>
      <nav style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link href="/" style={current === "matches" ? linkActive : linkBase}>
          对局
        </Link>
        <Link href="/cards" style={current === "cards" ? linkActive : linkBase}>
          卡牌管理
        </Link>
      </nav>
      <p style={{ color: "#555", margin: 0, fontSize: "0.9rem" }}>
        Server API：<code>{apiBase}</code>
      </p>
    </header>
  );
}
