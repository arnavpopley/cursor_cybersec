const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE =
  /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;
const KEYISH_RE =
  /\b(sk-[a-zA-Z0-9]{10,}|key-[a-zA-Z0-9_-]{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|AKIA[0-9A-Z]{16})\b/g;

export type Redaction = {
  kind: "email" | "token" | "key";
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

  out = out.replace(TOKEN_RE, (match) => {
    const to = "[REDACTED_TOKEN]";
    redactions.push({ kind: "token", from: match, to });
    return to;
  });

  out = out.replace(KEYISH_RE, (match) => {
    const to = "[REDACTED_KEY]";
    redactions.push({ kind: "key", from: match, to });
    return to;
  });

  return { text: out, redactions };
}
