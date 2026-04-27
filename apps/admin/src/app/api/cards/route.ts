import { NextResponse } from "next/server";

const SERVER_URL =
  process.env.ADMIN_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:2567";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") ?? "zh-CN";
  try {
    const upstream = await fetch(`${SERVER_URL}/api/cards?locale=${encodeURIComponent(locale)}`, {
      cache: "no-store",
    });
    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
