"use client";

import { useCallback, useMemo, useState } from "react";
import type { Finding } from "@/engine/findings";
import type { Citation } from "@/lib/ai/ask";
import type { Redaction } from "@/lib/ai/redact";
import type { AuditRow } from "@/lib/supabase/types";
import { FindingsPanel } from "./findings-panel";
import { CitationSnippet } from "./citation-snippet";
import { BottomStrip } from "./bottom-strip";
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
        message?: string;
        pending_request?: { id: string; dual_control?: boolean };
        error?: string;
      };
      if (!data.ok) {
        setStatus(data.error ?? "Apply failed");
        return;
      }
      setLocalAudit((prev) => [
        newLocalAudit("fix.apply_requested", {
          finding_id: finding.id,
          request_id: data.pending_request?.id,
          dual_control: data.pending_request?.dual_control ?? false,
        }),
        ...prev,
      ]);
      setStatus(
        data.mode === "local"
          ? data.message ?? "Apply queued locally (awaiting NFC)"
          : `Pending NFC approval · ${data.pending_request?.id}${
              data.pending_request?.dual_control ? " · dual control" : ""
            }`,
      );
    } finally {
      setApplyingId(null);
    }
  }, []);

  const findingCounts = useMemo(() => {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of findings) counts[f.severity]++;
    return counts;
  }, [findings]);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#f4f5f7] text-foreground">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-white px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tracking-tight">
            Keyring
          </span>
          <span className="text-[11px] text-muted-foreground">
            IAM triage
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {fileName ? (
            <span className="font-mono text-foreground/80">{fileName}</span>
          ) : (
            <span>no file loaded</span>
          )}
          {summary ? (
            <span className="tabular-nums">
              {summary.subjects} subjects · {findingCounts.CRITICAL}C/
              {findingCounts.HIGH}H/{findingCounts.MEDIUM}M/{findingCounts.LOW}L
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* Left: upload + Q&A */}
        <section className="flex min-h-0 flex-col border-r border-border bg-white">
          <div className="space-y-2 border-b border-border/80 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "analyze"}
                onClick={() => void loadFixture()}
              >
                Load Acme fixture
              </Button>
              <label className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-border bg-background px-2.5 text-[0.8rem] hover:bg-muted">
                Upload JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
                />
              </label>
              {busy === "analyze" ? (
                <span className="text-[11px] text-muted-foreground">
                  Analyzing…
                </span>
              ) : null}
            </div>
            {parseError ? (
              <div className="border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                {parseError}
              </div>
            ) : null}
            {status ? (
              <div className="text-[11px] text-muted-foreground">{status}</div>
            ) : null}
          </div>

          <div className="space-y-2 border-b border-border/80 p-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Question
            </label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={!loaded}
              rows={2}
              className="min-h-[56px] resize-none text-xs"
              placeholder="Ask about access paths, subjects, or findings…"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
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
                qa.map((item) => (
                  <QaCard key={item.id} item={item} raw={raw} />
                ))
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Right: findings */}
        <section className="flex min-h-0 flex-col bg-white">
          <div className="flex h-9 items-center justify-between border-b border-border/80 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Findings
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
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

      <BottomStrip localAudit={localAudit} />
    </div>
  );
}

function QaCard({ item, raw }: { item: QaItem; raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="space-y-2 border border-border/80 bg-[#fafbfc] p-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        Q · {item.question}
      </div>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs leading-relaxed">{item.answer}</p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-sm text-[10px]",
            item.confidence === "high" && "border-emerald-600 text-emerald-700",
            item.confidence === "medium" && "border-amber-600 text-amber-700",
            item.confidence === "low" && "border-slate-400 text-slate-600",
          )}
        >
          {item.confidence}
        </Badge>
      </div>
      {item.redactions.length > 0 ? (
        <div className="text-[10px] text-amber-800">
          Redacted before model:{" "}
          {item.redactions.map((r) => `${r.kind}→${r.to}`).join(", ")}
        </div>
      ) : null}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              open && "rotate-90",
            )}
          />
          How did we get this
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 space-y-1 border border-border/70 bg-white px-2 py-1.5 font-mono text-[11px]">
          <div>
            <span className="text-muted-foreground">toolCalled</span>{" "}
            <span className="font-semibold">{item.toolCalled}</span>
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
