# Keyring — 1:45 video demo kit

Production: https://cursor-cybersec.vercel.app  
Local (this environment): http://localhost:3000/?demo=1

Open `/?demo=1` to auto-load the Acme fixture so you can start recording on findings.

## What you need on camera

| Piece | Notes |
|-------|--------|
| Laptop browser | Full-screen Keyring UI (zoom ~110–125%) |
| Phone (optional) | NFC tap of Card A → `/tap?c=a` |
| Fallback | Focus Keyring → **Ctrl+Shift+A** if the tag fails |
| Voice button | Works in simulated mode without ElevenLabs |

No OpenAI / Supabase / ElevenLabs keys are required for the core path: analyze, findings, ask (engine fallback), NFC approve, and simulated voice all work offline.

---

## Shot list (105 seconds)

| Time | On screen | Action |
|------|-----------|--------|
| 0:00–0:08 | Brand header “Keyring” | Hold on empty / loading demo URL |
| 0:08–0:20 | Findings panel fills | Show CRITICAL / HIGH counts; expand CRITICAL |
| 0:20–0:38 | CRITICAL finding open | Hover evidence + suggested fix (Marco → iam-groups → Platform → Postgres) |
| 0:38–0:58 | Left Q&A | Click **Ask** on the prefilled Marco / Postgres question; expand a citation |
| 0:58–1:12 | Findings → Apply | Click **Apply (1 NFC tap)** on a HIGH finding (not CRITICAL unless you have two tags) |
| 1:12–1:28 | Green NFC banner | Countdown visible; tap phone **or** Ctrl+Shift+A; finding clears; audit updates |
| 1:28–1:40 | Voice + audit strip | Click **Voice: explain pending** (or show prior audit); scroll audit |
| 1:40–1:45 | Brand / close | Hold on Keyring header |

If you want voice *during* a pending request, start the voice call **before** approving (between Apply and tap).

---

## Finished demo video

A recorded cut (screen + TTS voiceover, **1:46**) is produced by:

```bash
# Requires Chrome with CDP on :9222 and the app on :3000
ffmpeg -f x11grab …   # see demo/record-demo.py timing
python3 demo/record-demo.py
```

Artifacts from the cloud recording run:

- `keyring-demo-1m45s.mp4` — final muxed demo
- `keyring-demo-voiceover.mp3` — standalone TTS track

## TTS voiceover

Paste the block in [`demo/voiceover-script.txt`](demo/voiceover-script.txt) into ElevenLabs, OpenAI TTS, or similar.

Target: **~237 words · ~1:45** at a clear product-demo pace (~140 wpm).  
Speaking style tip for the model: *calm, confident security engineer; slight pause between sentences; no hype.*

---

## Environment (Cursor Cloud)

This repo includes `.cursor/environment.json` so cloud agents boot with:

1. Node 22 image (`.cursor/Dockerfile`)
2. `npm ci`
3. A terminal running `npm run dev` on port **3000**

Secrets (optional, improve the demo):

```bash
OPENAI_API_KEY=                 # richer Ask phrasing; fallback works without it
APP_BASE_URL=http://localhost:3000
# Optional hosted persistence:
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# Optional real outbound voice:
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_AGENT_PHONE_NUMBER_ID=
ELEVENLABS_TO_NUMBER=
```

See also: [DEMO-NFC.md](DEMO-NFC.md), [NFC-SETUP.md](NFC-SETUP.md), [VOICE-SETUP.md](VOICE-SETUP.md).
