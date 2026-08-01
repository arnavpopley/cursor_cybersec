# One-tag NFC demo

Production: `https://cursor-cybersec.vercel.app`

## Write the tag (once)

NFC Tools → **Write** → **URL / URI**:

```text
https://cursor-cybersec.vercel.app/tap?c=a
```

Optional second tag (CRITICAL dual-control only):

```text
https://cursor-cybersec.vercel.app/tap?c=b
```

## Live demo script

1. Laptop: open https://cursor-cybersec.vercel.app
2. **Load Acme fixture**
3. Findings panel → expand a **HIGH / MEDIUM / LOW** finding → **Apply (1 NFC tap)**  
   (Skip CRITICAL unless you have two tags.)
4. Green banner appears: **NFC approval required · Xs left**
5. Within **60 seconds**, tap the phone to the tag
6. Phone shows **Approved**; laptop audit updates and the fix applies

## Fallback

If the tag fails on stage, focus the Keyring window and press **Ctrl+Shift+A**.
