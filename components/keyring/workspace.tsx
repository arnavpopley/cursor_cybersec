"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/engine/findings";
import type { Citation } from "@/lib/ai/ask";
import type { Redaction } from "@/lib/ai/redact";
import type { AuditRow, PendingRequestRow } from "@/lib/supabase/types";
import { FindingsPanel } from "./findings-panel";
import { CitationSnippet } from "./citation-snippet";
import { BottomStrip, type LiveAccountPayload } from "./bottom-strip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

type AnalyzeOk = {
  ok: true;
  account_id: string;
  summary: {
    subjects: number;
    access_groups: number;
    policies: number;
    findings: number;
  };
  findings: Finding[];
};

type AskOk = {
  ok: true;
  answer: string;
  citations: Citation[];
  toolCalled: string;
  args: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  redactions: Redaction[];
  usedFallback?: boolean;
};

type QaItem = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  toolCalled: string;
  args: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  redactions: Redaction[];
};

function newLocalAudit(action: string, detail: Record<string, unknown>): AuditRow {
  return {
    id: `local-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    actor: "analyst",
    action,
    detail,
  };
}

export function KeyringWorkspace() {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalyzeOk["summary"] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "ask" | null>(null);
  const [question, setQuestion] = useState(
    "How can u-dev-marco reach databases-for-postgresql/production?",
  );
  const [qa, setQa] = useState<QaItem[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [localAudit, setLocalAudit] = useState<AuditRow[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequestRow[]>(
    [],
  );
  const lastAccountUpdate = useRef<string | null>(null);

  const loaded = Boolean(raw && accountId);

  const analyzeRaw = useCallback(async (text: string, name: string) => {
    setBusy("analyze");
    setParseError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: text }),
      });
      const data = (await res.json()) as
        | AnalyzeOk
        | { ok: false; errors: Array<{ message: string; line_start?: number }> };

      if (!data.ok) {
        const msg = data.errors
          .map((e) =>
            e.line_start ? `L${e.line_start}: ${e.message}` : e.message,
          )
          .join("; ");
        setParseError(msg || "Invalid account JSON");
        setFindings([]);
        setAccountId(null);
        setSummary(null);
        return;
      }

      setRaw(text);
      setFileName(name);
      setAccountId(data.account_id);
      setSummary(data.summary);
      setFindings(data.findings);
      setQa([]);
      setLocalAudit((prev) => [
        newLocalAudit("account.analyzed", {
          account_id: data.account_id,
          finding_count: data.findings.length,
        }),
        ...prev,
      ]);
      setStatus(
        `${data.account_id} · ${data.summary.findings} findings · ${data.summary.policies} policies`,
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const loadFixture = useCallback(async () => {
    const res = await fetch("/fixtures/acme-account.json");
    const text = await res.text();
    await analyzeRaw(text, "acme-account.json");
  }, [analyzeRaw]);

  const onUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const text = await file.text();
      await analyzeRaw(text, file.name);
    },
    [analyzeRaw],
  );

  const ask = useCallback(async () => {
    if (!raw || !question.trim()) return;
    setBusy("ask");
    setStatus(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw, question: question.trim() }),
      });
      const data = (await res.json()) as AskOk | { ok: false; error?: string };
      if (!data.ok) {
        setStatus(data.error ?? "Ask failed");
        return;
      }
      setQa((prev) => [
        {
          id: `qa-${Date.now()}`,
          question: question.trim(),
          answer: data.answer,
          citations: data.citations,
          toolCalled: data.toolCalled,
          args: data.args,
          confidence: data.confidence,
          redactions: data.redactions ?? [],
        },
        ...prev,
      ]);
      setLocalAudit((prev) => [
        newLocalAudit("question.asked", {
          question: question.trim(),
          confidence: data.confidence,
          toolCalled: data.toolCalled,
        }),
        ...prev,
      ]);
      if (data.redactions?.length) {
        setStatus(
          `Redacted ${data.redactions.length} value(s) before model call: ${data.redactions
            .map((r) => r.to)
            .join(", ")}`,
        );
      }
    } finally {
      setBusy(null);
    }
  }, [question, raw]);

  const onApply = useCallback(async (finding: Finding) => {
    setApplyingId(finding.id);
    setStatus(null);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finding, requested_by: "analyst" }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        mode?: string;
        pending_request?: {
          id: string;
          dual_control?: boolean;
          expires_at?: string;
        };
        error?: string;
      };
      if (!data.ok) {
        setStatus(data.error ?? "Apply failed");
        return;
      }
      setLocalAudit((prev) => [
        newLocalAudit("request.created", {
          finding_id: finding.id,
          request_id: data.pending_request?.id,
          dual_control: data.pending_request?.dual_control ?? false,
          kind: "apply_fix",
        }),
        ...prev,
      ]);
      setStatus(
        `Pending NFC tap (60s)${
          data.pending_request?.dual_control ? " · dual control" : ""
        } · ${data.pending_request?.id?.slice(0, 8) ?? ""}`,
      );
    } finally {
      setApplyingId(null);
    }
  }, []);

  const startVoiceCall = useCallback(async () => {
    setVoiceBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/voice/call", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        mode?: string;
        message?: string;
        conversation_id?: string;
        pending_request?: { id: string; reason: string };
      };
      if (!data.ok) {
        setStatus(data.error ?? "Voice call failed");
        return;
      }
      setLocalAudit((prev) => [
        newLocalAudit("voice.call_started", {
          conversation_id: data.conversation_id,
          mode: data.mode,
          request_id: data.pending_request?.id,
        }),
        ...prev,
      ]);
      setStatus(
        `Voice ${data.mode}: ${data.message ?? "call started"} · agent cannot approve`,
      );
    } finally {
      setVoiceBusy(false);
    }
  }, []);

  const refreshFromAccount = useCallback((account: LiveAccountPayload) => {
    if (lastAccountUpdate.current === account.updated_at) return;
    lastAccountUpdate.current = account.updated_at;
    setRaw(account.raw);
    setAccountId(account.account_id);
    setFindings(account.findings);
    if (account.summary) setSummary(account.summary);
    else {
      setSummary({
        subjects: 0,
        access_groups: 0,
        policies: 0,
        findings: account.findings.length,
      });
    }
    setStatus(
      `Fix applied · ${account.findings.length} findings remain · ${new Date(
        account.updated_at,
      ).toLocaleTimeString()}`,
    );
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a")) return;
      e.preventDefault();
      void (async () => {
        setStatus("Demo approve (Ctrl+Shift+A)…");
        const res = await fetch("/api/tap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demo: true }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          status?: string;
          message?: string;
          account?: LiveAccountPayload;
        };
        if (!data.ok) {
          setStatus(data.message ?? "Demo approve failed");
          return;
        }
        setLocalAudit((prev) => [
          newLocalAudit("request.approved", {
            demo: true,
            status: data.status,
          }),
          ...prev,
        ]);
        if (data.account) {
          refreshFromAccount({
            ...data.account,
            findings: data.account.findings ?? [],
            updated_at: new Date().toISOString(),
          });
        } else {
          setStatus(data.message ?? "Approved");
          // Pull latest account/findings from live endpoint.
          const live = await fetch("/api/account");
          if (live.ok) {
            const acc = (await live.json()) as LiveAccountPayload & {
              ok: boolean;
            };
            if (acc.ok) refreshFromAccount(acc);
          }
        }
      })();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshFromAccount]);

  const findingCounts = useMemo(() => {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of findings) counts[f.severity]++;
    return counts;
  }, [findings]);

  const oldestPending = useMemo(() => {
    if (pendingRequests.length === 0) return null;
    return [...pendingRequests].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[0];
  }, [pendingRequests]);

  return (
    <div className="terminal-scan flex h-dvh min-h-0 flex-col text-foreground">
      <header className="terminal-panel flex h-11 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-3">
          <span
            className="terminal-brand terminal-cursor text-lg font-normal uppercase"
            style={{ fontFamily: "var(--font-brand), var(--font-terminal), monospace" }}
          >
            Keyring
          </span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            IAM triage // physical approval
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {fileName ? (
            <span className="text-primary/90">{fileName}</span>
          ) : (
            <span className="opacity-70">no file loaded</span>
          )}
          {summary ? (
            <span className="tabular-nums text-foreground/80">
              {summary.subjects} subjects · {findingCounts.CRITICAL}C/
              {findingCounts.HIGH}H/{findingCounts.MEDIUM}M/{findingCounts.LOW}L
            </span>
          ) : null}
        </div>
      </header>

      {oldestPending ? (
        <PendingNfcBanner request={oldestPending} />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* Left: upload + Q&A */}
        <section className="terminal-panel flex min-h-0 flex-col border-r">
          <div className="space-y-2 border-b border-border/80 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-primary/40 bg-transparent text-primary hover:bg-primary/10 hover:text-primary"
                disabled={busy === "analyze"}
                onClick={() => void loadFixture()}
              >
                Load Acme fixture
              </Button>
              <label className="inline-flex h-7 cursor-pointer items-center rounded-sm border border-primary/40 bg-transparent px-2.5 text-[0.8rem] text-primary hover:bg-primary/10">
                Upload JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                className="border-primary/40 bg-transparent text-primary hover:bg-primary/10 hover:text-primary"
                disabled={voiceBusy}
                onClick={() => void startVoiceCall()}
                title="ElevenLabs agent explains the pending request — cannot approve"
              >
                {voiceBusy ? "Calling…" : "Voice: explain pending"}
              </Button>
              {busy === "analyze" ? (
                <span className="text-[11px] text-primary/80">
                  Analyzing…
                </span>
              ) : null}
            </div>
            {parseError ? (
              <div className="border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {parseError}
              </div>
            ) : null}
            {status ? (
              <div className="text-[11px] text-primary/70">{status}</div>
            ) : null}
          </div>

          <div className="space-y-2 border-b border-border/80 p-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Question
            </label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={!loaded}
              rows={2}
              className="min-h-[56px] resize-none border-primary/25 bg-black/40 text-xs text-foreground placeholder:text-muted-foreground/70"
              placeholder="Ask about access paths, subjects, or findings…"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!loaded || busy === "ask" || !question.trim()}
                onClick={() => void ask()}
              >
                {busy === "ask" ? "Running engine…" : "Ask"}
              </Button>
              <span className="text-[10px] text-muted-foreground">
                Engine answers only — LLM never decides permissions
              </span>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-2">
              {qa.length === 0 ? (
                <p className="px-1 py-4 text-xs text-muted-foreground">
                  Answers appear here with expandable file citations.
                </p>
              ) : (
                qa.map((item, i) => (
                  <div
                    key={item.id}
                    className="terminal-fade-in"
                    style={{ animationDelay: `${Math.min(i, 4) * 60}ms` }}
                  >
                    <QaCard item={item} raw={raw} />
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Right: findings */}
        <section className="terminal-panel flex min-h-0 flex-col">
          <div className="flex h-9 items-center justify-between border-b border-border/80 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Findings
            </span>
            <span className="text-[11px] tabular-nums text-primary/80">
              {findings.length}
            </span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <FindingsPanel
              findings={findings}
              raw={raw}
              onApply={onApply}
              applyingId={applyingId}
            />
          </ScrollArea>
        </section>
      </div>

      <BottomStrip
        localAudit={localAudit}
        onLiveUpdate={(live) => {
          setPendingRequests(
            (live.pending_requests ?? []).filter((r) => r.status === "pending"),
          );
          if (live.account?.updated_at) {
            refreshFromAccount(live.account);
          }
        }}
      />
    </div>
  );
}

function PendingNfcBanner({ request }: { request: PendingRequestRow }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, new Date(request.expires_at).getTime() - now);
  const secs = Math.ceil(remainingMs / 1000);
  const dual = request.dual_control;

  return (
    <div className="terminal-fade-in shrink-0 border-b border-primary/40 bg-primary/10 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            NFC approval required · {secs}s left
          </div>
          <div className="truncate text-xs text-foreground/90">
            {request.reason || request.kind}
            {dual ? " · needs Card A then Card B" : " · tap Card A"}
          </div>
        </div>
        <div className="font-mono text-[11px] text-primary/90">
          {dual
            ? "Write tags: /tap?c=a  and  /tap?c=b"
            : "Tag URL: /tap?c=a"}
        </div>
      </div>
    </div>
  );
}

function QaCard({ item, raw }: { item: QaItem; raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="space-y-2 border border-primary/25 bg-black/35 p-2">
      <div className="text-[11px] font-medium text-primary/70">
        Q · {item.question}
      </div>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs leading-relaxed text-foreground/95">
          {item.answer}
        </p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-sm text-[10px]",
            item.confidence === "high" && "border-primary text-primary",
            item.confidence === "medium" && "border-amber-400/80 text-amber-300",
            item.confidence === "low" && "border-muted-foreground text-muted-foreground",
          )}
        >
          {item.confidence}
        </Badge>
      </div>
      {item.redactions.length > 0 ? (
        <div className="text-[10px] text-amber-300/90">
          Redacted before model:{" "}
          {item.redactions.map((r) => `${r.kind}→${r.to}`).join(", ")}
        </div>
      ) : null}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:text-primary">
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              open && "rotate-90",
            )}
          />
          How did we get this
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 space-y-1 border border-primary/20 bg-black/50 px-2 py-1.5 font-mono text-[11px]">
          <div>
            <span className="text-muted-foreground">toolCalled</span>{" "}
            <span className="font-semibold text-primary">{item.toolCalled}</span>
          </div>
          <div>
            <span className="text-muted-foreground">args</span>{" "}
            <span>
              {Object.entries(item.args)
                .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
                .join(" · ") || "(none)"}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Model never saw the policy file — only the question and this
            engine result.
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-1">
        {item.citations.length === 0 ? (
          <div className="text-[10px] text-muted-foreground">
            No line citations for this answer.
          </div>
        ) : (
          item.citations.map((c, i) => (
            <CitationSnippet
              key={`${item.id}-c-${i}`}
              raw={raw}
              citation={{
                line_start: c.line_start,
                line_end: c.line_end,
                policyId: c.policyId,
                label: c.label,
              }}
              defaultOpen={i === 0}
            />
          ))
        )}
      </div>
    </article>
  );
}
