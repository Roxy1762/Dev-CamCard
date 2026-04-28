import MatchesDashboard from "./matches-dashboard";
import { Nav } from "./nav";

export default function HomePage() {
  const apiBase =
    process.env.ADMIN_API_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "http://localhost:2567";

  return (
    <main
      style={{
        padding: "clamp(1rem, 4vw, 2rem)",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <Nav current="matches" apiBase={apiBase} />
      <MatchesDashboard apiBase={apiBase} />
    </main>
  );
}
