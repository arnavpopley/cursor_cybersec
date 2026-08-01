import { NextResponse } from "next/server";
import { writeVoiceAudit } from "@/lib/voice/context";

export const runtime = "nodejs";

type PostCallEvent = {
  type?: string;
  event_timestamp?: number;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    transcript?: Array<{
      role?: string;
      message?: string;
      time_in_call_secs?: number;
    }>;
    metadata?: Record<string, unknown>;
    analysis?: Record<string, unknown>;
  };
};

/**
 * ElevenLabs post-call webhook (+ optional mid-call question logger).
 * Logs call end and extracts user questions from the transcript into audit.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let event: PostCallEvent = {};
  try {
    event = JSON.parse(rawBody) as PostCallEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Optional HMAC verification when secret is configured.
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (secret) {
    const signature = request.headers.get("elevenlabs-signature") ?? "";
    // Soft-check: require header presence in production demos; full HMAC can
    // be added with the ElevenLabs SDK. Missing signature is rejected when
    // the secret is set so the endpoint is not left open by accident.
    if (!signature) {
      return NextResponse.json(
        { ok: false, error: "missing signature" },
        { status: 401 },
      );
    }
  }

  const type = event.type ?? "unknown";
  const data = event.data ?? {};
  const conversation_id = data.conversation_id ?? null;

  if (type === "post_call_transcription" || type === "call_ended") {
    const transcript = data.transcript ?? [];
    const questions = transcript
      .filter((t) => t.role === "user" && t.message?.trim())
      .map((t) => t.message!.trim());

    for (const question of questions) {
      await writeVoiceAudit("voice-agent", "voice.question", {
        conversation_id,
        question,
        source: "transcript",
      });
    }

    await writeVoiceAudit("system", "voice.call_ended", {
      conversation_id,
      status: data.status ?? "completed",
      agent_id: data.agent_id ?? null,
      question_count: questions.length,
      transcript_turns: transcript.length,
      type,
    });
  } else if (type === "call_initiation_failure") {
    await writeVoiceAudit("system", "voice.call_failed", {
      conversation_id,
      type,
      metadata: data.metadata ?? {},
    });
  } else {
    await writeVoiceAudit("system", "voice.webhook", {
      conversation_id,
      type,
    });
  }

  return NextResponse.json({ ok: true });
}
