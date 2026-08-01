import { NextResponse } from "next/server";
import {
  buildCallFirstMessage,
  startOutboundCall,
} from "@/lib/voice/elevenlabs";
import {
  getOldestPendingRequest,
  writeVoiceAudit,
} from "@/lib/voice/context";

export const runtime = "nodejs";

/**
 * Trigger an ElevenLabs conversational agent call about the current
 * pending request. The agent can explain and answer questions only —
 * it has no approval capability.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    to_number?: string;
  };

  const pending = await getOldestPendingRequest();
  if (!pending) {
    return NextResponse.json(
      { ok: false, error: "No pending request to describe" },
      { status: 404 },
    );
  }

  const seconds_remaining = Math.max(
    0,
    Math.floor(
      (new Date(pending.expires_at).getTime() - Date.now()) / 1000,
    ),
  );

  const first_message = buildCallFirstMessage({
    kind: pending.kind,
    reason: pending.reason,
    dual_control: pending.dual_control,
    seconds_remaining,
  });

  const call = await startOutboundCall({
    to_number: body.to_number,
    first_message,
    dynamic_variables: {
      request_id: pending.id,
      request_kind: pending.kind,
      dual_control: pending.dual_control,
      seconds_remaining,
    },
  });

  await writeVoiceAudit("system", "voice.call_started", {
    conversation_id: call.conversation_id,
    callSid: call.callSid ?? null,
    mode: call.mode,
    request_id: pending.id,
    kind: pending.kind,
    reason: pending.reason,
    to_number: body.to_number ?? process.env.ELEVENLABS_TO_NUMBER ?? null,
    first_message: call.first_message,
  });

  return NextResponse.json({
    ok: true,
    conversation_id: call.conversation_id,
    mode: call.mode,
    message: call.message,
    first_message: call.first_message,
    pending_request: {
      id: pending.id,
      kind: pending.kind,
      reason: pending.reason,
      dual_control: pending.dual_control,
      expires_at: pending.expires_at,
      seconds_remaining,
    },
    // Hard-coded reminder for clients
    can_approve: false,
    approval_message:
      "The voice agent cannot approve. Approval requires a physical NFC tap.",
  });
}
