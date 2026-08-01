import { NextResponse } from "next/server";
import { demoApproveOldest, processCardTap } from "@/lib/approval/service";

export const runtime = "nodejs";

/** Demo / programmatic tap. Body: { card?: string, demo?: true } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    card?: string;
    demo?: boolean;
  };

  const outcome = body.demo
    ? await demoApproveOldest()
    : await processCardTap(body.card ?? "");

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
}
