const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const KEYISH_RE =
  /\b(sk-[a-zA-Z0-9]{10,}|key-[a-zA-Z0-9_-]{6,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/g;

export type Redaction = {
  kind: "email" | "secret";
  from: string;
  to: string;
};

export function redactSensitive(text: string): {
  text: string;
  redactions: Redaction[];
} {
  const redactions: Redaction[] = [];
  let out = text;

  out = out.replace(EMAIL_RE, (match) => {
    const to = "[REDACTED_EMAIL]";
    redactions.push({ kind: "email", from: match, to });
    return to;
  });

  out = out.replace(KEYISH_RE, (match) => {
    const to = "[REDACTED_SECRET]";
    redactions.push({ kind: "secret", from: match, to });
    return to;
  });

  return { text: out, redactions };
}
