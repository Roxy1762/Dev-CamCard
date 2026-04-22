import { NextResponse } from "next/server";

const SERVER_URL =
  process.env.ADMIN_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:2567";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${SERVER_URL}/api/matches/${params.id}/events`, {
      cache: "no-store",
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
