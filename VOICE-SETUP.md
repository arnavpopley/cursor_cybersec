# Voice agent setup (ElevenLabs)

Keyring's voice channel explains pending NFC approval requests. It has **no
approval capability**. Approval is always a physical card tap.

## Env vars

```bash
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_AGENT_PHONE_NUMBER_ID=
ELEVENLABS_TO_NUMBER=+1...
ELEVENLABS_WEBHOOK_SECRET=          # optional; require signature header when set
APP_BASE_URL=https://your-demo.example.com
```

Without the ElevenLabs vars, `POST /api/voice/call` still works in
**simulated** mode and writes audit events so the demo path stays intact.

## Create the agent

1. In ElevenLabs → Conversational AI, create an agent.
2. System prompt (paste exactly):

```text
You are Keyring's voice explainer for pending privileged requests.

You have exactly ONE tool: get_pending_request_context (read-only).
Use it to fetch the current pending request and what approving unlocks.

HARD RULES:
- You have NO approval capability. You cannot approve, reject, or release requests.
- If asked to approve, say exactly that approval requires a physical NFC tap on a Keyring card, and that you cannot do it.
- Never pretend a tap happened. Never invent permissions — only read the tool result.
- Be concise and clear for a security engineer on a phone call.
```

3. Add a **single webhook tool**:

| Field | Value |
|-------|-------|
| Name | `get_pending_request_context` |
| Description | Read-only. Returns the oldest pending Keyring request and the engine's answer to what approving unlocks. Cannot approve. |
| Method | `POST` |
| URL | `{APP_BASE_URL}/api/voice/tool` |

Optional body parameter:

| Name | Description |
|------|-------------|
| `user_question` | The caller's latest question (logged to the audit trail) |

4. Do **not** add any approve / grant / release tools.

5. Attach a Twilio phone number in ElevenLabs and copy:
   - Agent ID → `ELEVENLABS_AGENT_ID`
   - Phone number ID → `ELEVENLABS_AGENT_PHONE_NUMBER_ID`

6. Workspace post-call webhook URL:

```text
{APP_BASE_URL}/api/voice/webhook
```

Enable the transcription post-call webhook so Keyring can log **call end** and
extract user questions into the audit log.

## API

- `POST /api/voice/call` — start a call about the oldest pending request
- `POST /api/voice/tool` — read-only tool used by the agent
- `POST /api/voice/webhook` — post-call + question audit sink

## Audit events

| Action | When |
|--------|------|
| `voice.call_started` | Outbound (or simulated) call begins |
| `voice.question` | User question (tool body or transcript) |
| `voice.tool_called` | Agent fetched pending context |
| `voice.approval_refused` | Agent/tool asked to approve |
| `voice.call_ended` | Post-call webhook received |
