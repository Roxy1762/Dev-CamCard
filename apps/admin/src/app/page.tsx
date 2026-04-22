import MatchesDashboard from "./matches-dashboard";

export default function HomePage() {
  const apiBase =
    process.env.ADMIN_API_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "http://localhost:2567";

  return (
    <main
      style={{
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <header>
        <h1 style={{ fontSize: "1.6rem", marginBottom: "0.25rem" }}>
          Dev-CamCard · 课表风暴  运营后台
        </h1>
        <p style={{ color: "#555" }}>
          连接 server：<code>{apiBase}</code>
        </p>
      </header>
      <MatchesDashboard apiBase={apiBase} />
    </main>
  );
}
