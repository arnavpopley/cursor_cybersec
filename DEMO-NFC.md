# One-tag NFC demo

Production: `https://cursor-cybersec.vercel.app`

## Write the tag (once)

NFC Tools → **Write** → **URL / URI**:

```text
https://cursor-cybersec.vercel.app/tap?c=a
```

One Card A tag is enough for every severity, including CRITICAL.

## Live demo script

1. Laptop: open https://cursor-cybersec.vercel.app
2. **Load Acme fixture**
3. Findings → **Apply (1 NFC tap)** on any finding  
   - CRITICAL expires in **30 seconds**  
   - HIGH / MEDIUM / LOW expire in **60 seconds**
4. Green banner: **NFC approval required · Xs left**
5. Tap the phone to the tag before it expires
6. Phone shows **Approved**; laptop audit updates

## Fallback

If the tag fails on stage, focus the Keyring window and press **Ctrl+Shift+A**.
