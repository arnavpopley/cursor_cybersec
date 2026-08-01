import { NextResponse } from "next/server";
import {
  getPendingRequestContext,
  VOICE_NO_APPROVAL,
  writeVoiceAudit,
} from "@/lib/voice/context";

export const runtime = "nodejs";

/**
 * Single read-only webhook tool for the ElevenLabs agent.
 *
 * Name (configure in ElevenLabs): get_pending_request_context
 * Method: POST
 * URL: {APP_BASE_URL}/api/voice/tool
 *
 * HARD-CODED: this tool never approves. can_approve is always false.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      user_question?: string;
      question?: string;
      action?: string;
    };

    // Refuse any approval-shaped invocation explicitly.
    const action = (body.action ?? "").toLowerCase();
    if (
      action === "approve" ||
      action === "grant" ||
      action === "release" ||
      action === "confirm"
    ) {
      await writeVoiceAudit("voice-agent", "voice.approval_refused", {
        action,
        message: VOICE_NO_APPROVAL,
      });
      return NextResponse.json({
        ok: false,
        can_approve: false,
        approval_capability: "none",
        message: VOICE_NO_APPROVAL,
      });
    }

    const user_question = body.user_question ?? body.question;
    if (user_question?.trim()) {
      await writeVoiceAudit("voice-agent", "voice.question", {
        question: user_question.trim(),
      });
    }

    const context = await getPendingRequestContext({ user_question });

    // Belt-and-suspenders: never allow approval flags to flip true.
    const response = {
      ...context,
      can_approve: false as const,
      approval_capability: "none" as const,
      approval_message: VOICE_NO_APPROVAL,
    };

    await writeVoiceAudit("voice-agent", "voice.tool_called", {
      tool: "get_pending_request_context",
      pending_request_id:
        (context.pending_request as { id?: string } | null)?.id ?? null,
      user_question: user_question ?? null,
    });

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "voice tool failed";
    console.error("/api/voice/tool POST failed:", message);
    return NextResponse.json(
      {
        ok: false,
        can_approve: false,
        approval_capability: "none",
        approval_message: VOICE_NO_APPROVAL,
        error: message,
      },
      { status: 200 },
    );
  }
}

/** Optional GET for easy dashboard testing of the tool URL. */
export async function GET() {
  try {
    const context = await getPendingRequestContext();
    return NextResponse.json({
      ...context,
      can_approve: false,
      approval_capability: "none",
      approval_message: VOICE_NO_APPROVAL,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "voice tool failed";
    console.error("/api/voice/tool GET failed:", message);
    return NextResponse.json({
      ok: false,
      can_approve: false,
      approval_capability: "none",
      approval_message: VOICE_NO_APPROVAL,
      error: message,
      pending_request: null,
    });
  }
}
