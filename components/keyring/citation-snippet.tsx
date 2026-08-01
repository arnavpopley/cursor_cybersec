"use client";

import { useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export type LineCitation = {
  line_start: number;
  line_end: number;
  label?: string;
  policyId?: string | null;
};

type Props = {
  raw: string;
  citation: LineCitation;
  defaultOpen?: boolean;
};

export function CitationSnippet({ raw, citation, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const lines = useMemo(() => raw.split("\n"), [raw]);

  const start = Math.max(1, citation.line_start);
  const end = Math.min(lines.length, citation.line_end);
  const pad = 1;
  const viewStart = Math.max(1, start - pad);
  const viewEnd = Math.min(lines.length, end + pad);

  const title = citation.policyId
    ? `${citation.policyId} · L${start}–${end}`
    : `L${start}–${end}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border/80 bg-muted/20">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted/40">
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="font-mono text-[11px] font-medium tracking-tight">
          {title}
        </span>
        {citation.label ? (
          <span className="truncate text-[11px] text-muted-foreground">
            — {citation.label}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="overflow-x-auto border-t border-border/60 bg-[#0f1419] px-0 py-1 font-mono text-[11px] leading-[1.45] text-[#d6deeb]">
          {Array.from({ length: viewEnd - viewStart + 1 }, (_, i) => {
            const lineNo = viewStart + i;
            const text = lines[lineNo - 1] ?? "";
            const hot = lineNo >= start && lineNo <= end;
            return (
              <div
                key={lineNo}
                className={cn(
                  "flex gap-3 px-2",
                  hot ? "bg-[#1d3a2f] text-[#e8fff4]" : "opacity-55",
                )}
              >
                <span className="w-8 shrink-0 select-none text-right text-[#7f8aa3]">
                  {lineNo}
                </span>
                <code className="whitespace-pre-wrap break-all">{text || " "}</code>
              </div>
            );
          })}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
