"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

interface CardEntry {
  id: string;
  name: string;
  set: string;
  cost: number;
  rarity: "common" | "uncommon" | "rare" | "signature";
  lane: "course" | "activity" | "daily";
  type: "action" | "venue";
  isGuard?: boolean;
  durability?: number;
  activationsPerTurn?: number;
  starter?: boolean;
  fixedSupply?: boolean;
  isPressure?: boolean;
  tags: string[];
  abilities: { trigger: string; effects: { op: string; [k: string]: unknown }[] }[];
  text?: { body: string; reminder?: string };
}

interface CatalogResponse {
  locale: string;
  ruleSets: string[];
  total: number;
  cards: CardEntry[];
}

const RARITY_LABEL: Record<CardEntry["rarity"], string> = {
  common: "普通",
  uncommon: "进阶",
  rare: "稀有",
  signature: "标志",
};

const LANE_LABEL: Record<CardEntry["lane"], string> = {
  course: "课程",
  activity: "活动",
  daily: "日常",
};

const TYPE_LABEL: Record<CardEntry["type"], string> = {
  action: "行动",
  venue: "场馆",
};

const cellHead: React.CSSProperties = {
  padding: "0.5rem",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "1px solid #ddd",
  position: "sticky",
  top: 0,
  background: "#f5f5f5",
};

const cell: React.CSSProperties = {
  padding: "0.5rem",
  verticalAlign: "top",
  borderBottom: "1px solid #f0f0f0",
};

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0 6px",
  marginRight: 4,
  background: "#eef",
  border: "1px solid #ccd",
  borderRadius: 4,
  fontSize: "0.75rem",
};

const breakdownPill: React.CSSProperties = {
  padding: "2px 10px",
  background: "#f0f4ff",
  border: "1px solid #d0d8ee",
  borderRadius: 999,
  fontSize: "0.8rem",
  color: "#334",
};

/**
 * 卡牌管理面板。
 *
 * 当前能力（与服务端 /api/cards 对齐）：
 *  - 列出全部卡牌（来自 data/cards/rules + data/cards/text）
 *  - 按内容包 / lane / 稀有度 / 名称关键字过滤
 *  - 展开任意卡看完整 JSON（abilities 不展开会丢失关键运营信息）
 *
 * 写入能力（编辑 cost / 临时禁用某卡 / 上线新内容）需要 server 暴露写接口
 * 与文件持久化策略，目前保持只读，等内容流水线落地再加入。
 */
export default function CardsManager() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [setFilter, setSetFilter] = useState<string>("all");
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setErr(null);
    try {
      const res = await fetch("/api/cards?locale=zh-CN", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as CatalogResponse;
      setData(json);
      setStatus("ok");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [] as CardEntry[];
    const kw = keyword.trim().toLowerCase();
    return data.cards.filter((c) => {
      if (setFilter !== "all" && c.set !== setFilter) return false;
      if (laneFilter !== "all" && c.lane !== laneFilter) return false;
      if (rarityFilter !== "all" && c.rarity !== rarityFilter) return false;
      if (kw) {
        const hay = `${c.id} ${c.name} ${c.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [data, keyword, setFilter, laneFilter, rarityFilter]);

  // 当前筛选下按 lane / rarity 的张数分布，便于运营在调整供给前先看大盘。
  const breakdown = useMemo(() => {
    const byLane: Record<string, number> = { course: 0, activity: 0, daily: 0 };
    const byRarity: Record<string, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      signature: 0,
    };
    for (const c of filtered) {
      byLane[c.lane] = (byLane[c.lane] ?? 0) + 1;
      byRarity[c.rarity] = (byRarity[c.rarity] ?? 0) + 1;
    }
    return { byLane, byRarity };
  }, [filtered]);

  const exportJson = useCallback(() => {
    if (filtered.length === 0) return;
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cards-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const ruleSets = data?.ruleSets ?? [];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <h2 style={{ fontSize: "1.2rem", margin: 0, marginRight: "0.5rem" }}>卡牌管理</h2>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: "0.25rem 0.75rem",
            background: "#222",
            color: "#eee",
            border: "1px solid #444",
            cursor: "pointer",
            borderRadius: 4,
          }}
        >
          刷新
        </button>
        <button
          type="button"
          onClick={exportJson}
          disabled={filtered.length === 0}
          style={{
            padding: "0.25rem 0.75rem",
            background: filtered.length === 0 ? "#bbb" : "#1e88e5",
            color: "#fff",
            border: "1px solid transparent",
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            borderRadius: 4,
          }}
        >
          导出当前筛选 JSON
        </button>
        {status === "loading" && <span style={{ color: "#888" }}>加载中...</span>}
        {status === "ok" && data && (
          <span style={{ color: "#666", marginLeft: "auto" }}>
            共 {data.total} 张 / 当前筛选 {filtered.length} 张
          </span>
        )}
        {status === "error" && (
          <span style={{ color: "#c00" }}>
            拉取失败：{err}（请确认 server 已启动且 ADMIN_API_BASE 可达）
          </span>
        )}
      </header>

      {status === "ok" && filtered.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            color: "#555",
            fontSize: "0.85rem",
          }}
        >
          <span style={breakdownPill}>
            课程 {breakdown.byLane.course}
          </span>
          <span style={breakdownPill}>
            活动 {breakdown.byLane.activity}
          </span>
          <span style={breakdownPill}>
            日常 {breakdown.byLane.daily}
          </span>
          <span style={{ ...breakdownPill, background: "#fff" }}>
            普通 {breakdown.byRarity.common}
          </span>
          <span style={{ ...breakdownPill, background: "#fff" }}>
            进阶 {breakdown.byRarity.uncommon}
          </span>
          <span style={{ ...breakdownPill, background: "#fff" }}>
            稀有 {breakdown.byRarity.rare}
          </span>
          <span style={{ ...breakdownPill, background: "#fff" }}>
            标志 {breakdown.byRarity.signature}
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="搜索 ID / 名称 / 标签..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{
            flex: "1 1 220px",
            padding: "0.4rem 0.6rem",
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
        />
        <Selector label="内容包" value={setFilter} onChange={setSetFilter}>
          <option value="all">全部</option>
          {ruleSets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Selector>
        <Selector label="lane" value={laneFilter} onChange={setLaneFilter}>
          <option value="all">全部</option>
          <option value="course">课程</option>
          <option value="activity">活动</option>
          <option value="daily">日常</option>
        </Selector>
        <Selector label="稀有度" value={rarityFilter} onChange={setRarityFilter}>
          <option value="all">全部</option>
          <option value="common">普通</option>
          <option value="uncommon">进阶</option>
          <option value="rare">稀有</option>
          <option value="signature">标志</option>
        </Selector>
      </div>

      {status === "ok" && filtered.length === 0 && (
        <p style={{ color: "#777" }}>当前筛选下没有卡牌。</p>
      )}

      {filtered.length > 0 && (
        <div style={{ maxHeight: 600, overflow: "auto", border: "1px solid #eee" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={cellHead}>ID / 名称</th>
                <th style={cellHead}>内容包</th>
                <th style={cellHead}>类型</th>
                <th style={cellHead}>lane</th>
                <th style={cellHead}>稀有度</th>
                <th style={cellHead}>cost</th>
                <th style={cellHead}>标记</th>
                <th style={cellHead}>详情</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const isOpen = expanded === c.id;
                return (
                  <tr key={c.id}>
                    <td style={cell}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <code style={{ fontSize: "0.75rem", color: "#888" }}>{c.id}</code>
                    </td>
                    <td style={cell}>{c.set}</td>
                    <td style={cell}>{TYPE_LABEL[c.type]}</td>
                    <td style={cell}>{LANE_LABEL[c.lane]}</td>
                    <td style={cell}>{RARITY_LABEL[c.rarity]}</td>
                    <td style={cell}>{c.cost}</td>
                    <td style={cell}>
                      {c.starter && <span style={tagStyle}>starter</span>}
                      {c.fixedSupply && <span style={tagStyle}>固定供给</span>}
                      {c.isPressure && <span style={tagStyle}>压力</span>}
                      {c.isGuard && <span style={tagStyle}>guard</span>}
                      {c.durability != null && (
                        <span style={tagStyle}>耐久 {c.durability}</span>
                      )}
                      {c.activationsPerTurn != null && (
                        <span style={tagStyle}>×{c.activationsPerTurn}/回合</span>
                      )}
                      {c.tags.map((t) => (
                        <span key={t} style={tagStyle}>
                          {t}
                        </span>
                      ))}
                    </td>
                    <td style={cell}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : c.id)}
                        style={{
                          padding: "0.2rem 0.6rem",
                          cursor: "pointer",
                          border: "1px solid #ccc",
                          background: isOpen ? "#eee" : "#fff",
                        }}
                      >
                        {isOpen ? "收起" : "展开"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <CardDetail card={filtered.find((c) => c.id === expanded) ?? null} />
      )}
    </section>
  );
}

function Selector({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "0.85rem",
        color: "#555",
      }}
    >
      {label}：
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "0.3rem 0.4rem",
          border: "1px solid #ccc",
          borderRadius: 4,
        }}
      >
        {children}
      </select>
    </label>
  );
}

function CardDetail({ card }: { card: CardEntry | null }) {
  if (!card) return null;
  return (
    <section
      style={{
        border: "1px solid #ddd",
        background: "#fafafa",
        padding: "1rem",
        borderRadius: 6,
      }}
    >
      <h3 style={{ marginTop: 0 }}>
        {card.name} <code style={{ fontSize: "0.85rem", color: "#666" }}>({card.id})</code>
      </h3>
      {card.text?.body && (
        <p style={{ color: "#333", lineHeight: 1.6 }}>{card.text.body}</p>
      )}
      {card.text?.reminder && (
        <p style={{ color: "#888", fontStyle: "italic" }}>{card.text.reminder}</p>
      )}
      <h4 style={{ marginTop: "0.75rem", marginBottom: "0.25rem" }}>能力 (abilities)</h4>
      <pre
        style={{
          background: "#fff",
          padding: "0.5rem",
          fontSize: "0.8rem",
          overflow: "auto",
          maxHeight: 300,
          border: "1px solid #eee",
        }}
      >
        {JSON.stringify(card.abilities, null, 2)}
      </pre>
    </section>
  );
}
