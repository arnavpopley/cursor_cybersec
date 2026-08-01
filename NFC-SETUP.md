# NFC setup

Keyring approvals are physical. Each NTAG writes a URL; a phone that taps the
tag opens that URL and either approves the oldest pending request or, for
dual-control CRITICAL fixes, records the first tap and waits for a **second
distinct card** within the 60 second window.

## Base URL

Set `APP_BASE_URL` to the publicly reachable origin of the demo (no trailing
slash), for example:

```bash
APP_BASE_URL=https://keyring.example.com
```

Local stage / tunnel example:

```bash
APP_BASE_URL=https://abc123.ngrok.app
```

## Seed cards

These UUIDs are seeded in `supabase/schema.sql` and in the local demo store:

| Tag | Holder | Card id |
|-----|--------|---------|
| Card A | Priya Raman | `11111111-1111-1111-1111-111111111111` |
| Card B | Alex Rivera | `22222222-2222-2222-2222-222222222222` |

Short aliases also work for stage testing: `a` / `card-a`, `b` / `card-b`.

## URL to write on each tag

Encode an NDEF URI record:

```text
{APP_BASE_URL}/tap?c={CARD_ID}
```

Examples:

```text
https://keyring.example.com/tap?c=11111111-1111-1111-1111-111111111111
https://keyring.example.com/tap?c=22222222-2222-2222-2222-222222222222
```

Use an NFC writer app (e.g. NFC Tools) → **Write** → **URL / URI** → paste the
string above → write to the NTAG.

## What happens on tap

1. Phone opens `/tap?c=…`
2. Server finds the oldest `pending` request that has not expired
3. Records a tap for that card (one card can only tap a request once)
4. Single-control requests approve immediately
5. Dual-control requests wait until two distinct cards have tapped
6. On `grant_admin` approval → create a 15 minute grant
7. On `apply_fix` approval → apply the suggested fix to the loaded account and
   re-run findings (the finding disappears in the main UI via Realtime / 1s poll)

The phone shows a large green **Approved**, blue **Waiting for 2nd card**, or
red failure screen.

## Stage fallback

If a tag fails on stage, focus the Keyring window and press:

```text
Ctrl+Shift+A
```

That approves the oldest pending request directly (demo only) and still writes
to the audit log.
