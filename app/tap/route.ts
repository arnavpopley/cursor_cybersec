import { processCardTap } from "@/lib/approval/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(opts: {
  ok: boolean;
  title: string;
  detail: string;
  tone: "success" | "wait" | "fail";
}) {
  const bg =
    opts.tone === "success"
      ? "#0f3d2e"
      : opts.tone === "wait"
        ? "#1e293b"
        : "#3f1d1d";
  const accent =
    opts.tone === "success"
      ? "#4ade80"
      : opts.tone === "wait"
        ? "#38bdf8"
        : "#f87171";

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.title} · Keyring</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: ${bg}; color: #f8fafc; padding: 24px;
    }
    .card {
      width: min(520px, 100%);
      border: 1px solid color-mix(in oklab, ${accent} 45%, transparent);
      background: color-mix(in oklab, #000 25%, ${bg});
      border-radius: 16px; padding: 28px 24px; text-align: center;
    }
    .mark {
      width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 999px;
      display: grid; place-items: center; font-size: 36px; font-weight: 700;
      background: color-mix(in oklab, ${accent} 20%, transparent);
      color: ${accent}; border: 2px solid ${accent};
    }
    h1 { margin: 0 0 10px; font-size: clamp(1.6rem, 6vw, 2.2rem); line-height: 1.15; }
    p { margin: 0; font-size: 1.05rem; line-height: 1.45; color: #e2e8f0; opacity: 0.92; }
    .meta { margin-top: 18px; font-size: 0.8rem; opacity: 0.65; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <div class="card">
    <div class="mark">${opts.ok ? (opts.tone === "wait" ? "…" : "✓") : "!"}</div>
    <h1>${escapeHtml(opts.title)}</h1>
    <p>${escapeHtml(opts.detail)}</p>
    <div class="meta">Keyring NFC · ${opts.ok ? "ok" : "failed"}</div>
  </div>
</body>
</html>`,
    {
      status: opts.ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * NFC tag target: /tap?c=CARD_ID
 * Finds the oldest pending request, records the tap, approves or waits for
 * dual control, and renders a large phone-friendly result.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const card = url.searchParams.get("c") ?? "";

  if (!card) {
    return page({
      ok: false,
      tone: "fail",
      title: "Missing card",
      detail: "This tag has no card id. Re-write the tag using NFC-SETUP.md.",
    });
  }

  const outcome = await processCardTap(card);

  if (!outcome.ok) {
    return page({
      ok: false,
      tone: "fail",
      title:
        outcome.status === "expired"
          ? "Request expired"
          : outcome.status === "rejected"
            ? "Card rejected"
            : "Tap failed",
      detail: outcome.message,
    });
  }

  if (outcome.status === "waiting") {
    return page({
      ok: true,
      tone: "wait",
      title: "Waiting for 2nd card",
      detail: outcome.message,
    });
  }

  return page({
    ok: true,
    tone: "success",
    title: "Approved",
    detail: outcome.message,
  });
}
