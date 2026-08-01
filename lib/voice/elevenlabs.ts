/**
 * ElevenLabs Conversational Agent client.
 * Falls back to a simulated call when credentials are missing so demos still work.
 */

export type OutboundCallResult = {
  ok: boolean;
  mode: "elevenlabs" | "simulated";
  conversation_id: string;
  callSid?: string;
  message: string;
  first_message: string;
};

function requireEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(
    requireEnv("ELEVENLABS_API_KEY") &&
      requireEnv("ELEVENLABS_AGENT_ID") &&
      requireEnv("ELEVENLABS_AGENT_PHONE_NUMBER_ID"),
  );
}

export function buildCallFirstMessage(input: {
  kind: string;
  reason: string;
  dual_control: boolean;
  seconds_remaining: number;
}): string {
  const dual = input.dual_control
    ? " This one needs taps from two distinct cards."
    : "";
  return `Hi — this is Keyring. There is a pending ${input.kind.replace("_", " ")} request: ${input.reason}. It expires in about ${input.seconds_remaining} seconds.${dual} I can explain what approving unlocks, but I cannot approve it. Approval requires a physical NFC tap.`;
}

/**
 * Hard-coded agent system prompt fragment for ElevenLabs configuration.
 * Documented in VOICE-SETUP.md — never grant approval tools.
 */
export const VOICE_AGENT_SYSTEM_PROMPT = `You are Keyring's voice explainer for pending privileged requests.

You have exactly ONE tool: get_pending_request_context (read-only).
Use it to fetch the current pending request and what approving unlocks.

HARD RULES:
- You have NO approval capability. You cannot approve, reject, or release requests.
- If asked to approve, say exactly that approval requires a physical NFC tap on a Keyring card, and that you cannot do it.
- Never pretend a tap happened. Never invent permissions — only read the tool result.
- Be concise and clear for a security engineer on a phone call.
`;

export async function startOutboundCall(options: {
  to_number?: string;
  first_message: string;
  dynamic_variables?: Record<string, string | number | boolean>;
}): Promise<OutboundCallResult> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const agentId = requireEnv("ELEVENLABS_AGENT_ID");
  const phoneNumberId = requireEnv("ELEVENLABS_AGENT_PHONE_NUMBER_ID");
  const toNumber = options.to_number ?? requireEnv("ELEVENLABS_TO_NUMBER");

  if (!apiKey || !agentId || !phoneNumberId || !toNumber) {
    const conversation_id = `sim-${Date.now()}`;
    return {
      ok: true,
      mode: "simulated",
      conversation_id,
      message:
        "ElevenLabs is not fully configured — simulated call started for the demo. Configure ELEVENLABS_* env vars for a real outbound call.",
      first_message: options.first_message,
    };
  }

  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: phoneNumberId,
          to_number: toNumber,
          conversation_initiation_client_data: {
            conversation_config_override: {
              agent: {
                first_message: options.first_message,
              },
            },
            dynamic_variables: options.dynamic_variables ?? {},
          },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      const conversation_id = `sim-fallback-${Date.now()}`;
      return {
        ok: true,
        mode: "simulated",
        conversation_id,
        message: `ElevenLabs outbound call failed (${res.status}); using simulated call. ${text.slice(0, 200)}`,
        first_message: options.first_message,
      };
    }

    const data = (await res.json()) as {
      conversation_id?: string;
      callSid?: string;
      success?: boolean;
    };

    return {
      ok: true,
      mode: "elevenlabs",
      conversation_id: data.conversation_id ?? `el-${Date.now()}`,
      callSid: data.callSid,
      message: "Outbound call started via ElevenLabs.",
      first_message: options.first_message,
    };
  } catch (error) {
    const conversation_id = `sim-error-${Date.now()}`;
    return {
      ok: true,
      mode: "simulated",
      conversation_id,
      message: `ElevenLabs unreachable; simulated call started. ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      first_message: options.first_message,
    };
  }
}
