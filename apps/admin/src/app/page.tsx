/**
 * 管理后台首页 — 最小占位页面
 *
 * 当前阶段：仅显示"后台骨架已启动"。
 * 后续将实现：卡牌数据管理、房间状态监控、规则集配置等业务页面。
 */
export default function HomePage() {
  return (
    <main
      style={{
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem" }}>Dev-CamCard 管理后台</h1>
      <p style={{ color: "#555" }}>
        后台骨架已启动。业务页面将在后续轮次开发。
      </p>
      <ul style={{ paddingLeft: "1.5rem", color: "#777", fontSize: "0.9rem" }}>
        <li>卡牌数据管理（TODO）</li>
        <li>房间状态监控（TODO）</li>
        <li>规则集配置（TODO）</li>
      </ul>
    </main>
  );
}
