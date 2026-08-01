"use client";

import { useMemo, useState } from "react";
import type { Finding, FindingSeverity } from "@/engine/findings";
import { CitationSnippet } from "./citation-snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

const ORDER: FindingSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_STYLE: Record<FindingSeverity, string> = {
  CRITICAL: "bg-red-700 text-white border-transparent",
  HIGH: "bg-orange-600 text-white border-transparent",
  MEDIUM: "bg-amber-500 text-black border-transparent",
  LOW: "bg-slate-500 text-white border-transparent",
};

function summarizeFix(fix: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof fix.id === "string") lines.push(`id ${fix.id}`);
  if (Array.isArray(fix.subjects)) {
    lines.push(`subjects ${(fix.subjects as string[]).join(", ")}`);
  }
  if (fix.roles && typeof fix.roles === "object") {
    const roles = fix.roles as { platform?: string[]; service?: string[] };
    const parts = [
      ...(roles.platform ?? []).map((r) => `platform ${r}`),
      ...(roles.service ?? []).map((r) => `service ${r}`),
    ];
    if (parts.length) lines.push(parts.join(", "));
  }
  if (fix.resources && typeof fix.resources === "object") {
    const r = fix.resources as Record<string, unknown>;
    const bits = Object.entries(r)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`);
    if (bits.length) lines.push(bits.join(" · "));
  }
  if (typeof fix.mfa_enabled === "boolean") {
    lines.push(`mfa_enabled ${fix.mfa_enabled}`);
  }
  if (fix.claim_rules) lines.push("add repo/branch claim conditions");
  if (fix.api_key && typeof fix.api_key === "object") {
    const key = fix.api_key as { expires?: string };
    if (key.expires) lines.push(`api key expires ${key.expires}`);
  }
  if (typeof fix.expires === "string") lines.push(`expires ${fix.expires}`);
  if (lines.length === 0) lines.push("Corrected policy prepared by engine");
  return lines;
}

type Props = {
  findings: Finding[];
  raw: string;
  onApply: (finding: Finding) => Promise<void>;
  applyingId: string | null;
};

export function FindingsPanel({ findings, raw, onApply, applyingId }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<FindingSeverity, Finding[]>();
    for (const sev of ORDER) map.set(sev, []);
    for (const f of findings) {
      map.get(f.severity)?.push(f);
    }
    return map;
  }, [findings]);

  const [openSev, setOpenSev] = useState<Record<string, boolean>>({});
  const [openFinding, setOpenFinding] = useState<Record<string, boolean>>({});

  if (findings.length === 0) {
    return (
      <div className="px-3 py-6 text-xs text-muted-foreground">
        No findings yet. Load an account file to run the engine.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {ORDER.map((sev) => {
        const list = grouped.get(sev) ?? [];
        if (list.length === 0) return null;
        const open = openSev[sev] ?? false;
        return (
          <Collapsible
            key={sev}
            open={open}
            onOpenChange={(v) => setOpenSev((s) => ({ ...s, [sev]: v }))}
            className="border border-border/70"
          >
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40">
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              <Badge className={cn("rounded-sm px-1.5 py-0 text-[10px]", SEVERITY_STYLE[sev])}>
                {sev}
              </Badge>
              <span className="text-xs font-medium tabular-nums">{list.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border/60">
              {list.map((finding) => {
                const fOpen = openFinding[finding.id] ?? false;
                return (
                  <Collapsible
                    key={finding.id}
                    open={fOpen}
                    onOpenChange={(v) =>
                      setOpenFinding((s) => ({ ...s, [finding.id]: v }))
                    }
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <CollapsibleTrigger className="flex w-full items-start gap-2 px-2 py-2 text-left hover:bg-muted/30">
                      <ChevronRight
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                          fOpen && "rotate-90",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium leading-snug">
                          {finding.title}
                        </div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          confidence {finding.confidence}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 bg-muted/15 px-2 pb-2 pl-7">
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {finding.explanation}
                      </p>

                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Evidence
                        </div>
                        {finding.evidence.map((ev, i) => (
                          <CitationSnippet
                            key={`${finding.id}-ev-${i}`}
                            raw={raw}
                            citation={{
                              line_start: ev.line_start,
                              line_end: ev.line_end,
                              policyId: ev.policyId,
                            }}
                          />
                        ))}
                      </div>

                      <div className="space-y-1.5 rounded-sm border border-border/70 bg-background p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Suggested fix
                        </div>
                        <ul className="space-y-0.5 text-xs text-foreground/90">
                          {summarizeFix(finding.suggestedFix).map((line) => (
                            <li key={line} className="font-mono text-[11px]">
                              {line}
                            </li>
                          ))}
                        </ul>
                        <Button
                          size="sm"
                          className="mt-1 h-7"
                          disabled={applyingId === finding.id}
                          onClick={() => void onApply(finding)}
                        >
                          {applyingId === finding.id ? "Requesting…" : "Apply"}
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
