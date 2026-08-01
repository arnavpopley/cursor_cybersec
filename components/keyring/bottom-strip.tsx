"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditRow, GrantRow, PendingRequestRow } from "@/lib/supabase/types";
import type { Finding } from "@/engine/findings";
import { tryCreateBrowserClient } from "@/lib/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function GrantCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = new Date(expiresAt).getTime() - now;
  const urgent = remaining < 60_000;
  return (
    <span
      className={cn(
        "font-mono text-[11px] tabular-nums",
        urgent ? "text-red-400" : "text-primary",
      )}
    >
      {formatCountdown(remaining)}
    </span>
  );
}

export type LiveAccountPayload = {
  raw: string;
  account_id: string;
  findings: Finding[];
  updated_at: string;
  summary?: {
    subjects: number;
    access_groups: number;
    policies: number;
    findings: number;
  };
};

type Props = {
  localAudit: AuditRow[];
  onLiveUpdate?: (live: {
    audit: AuditRow[];
    grants: GrantRow[];
    pending_requests: PendingRequestRow[];
    account: LiveAccountPayload | null;
  }) => void;
};

export function BottomStrip({ localAudit, onLiveUpdate }: Props) {
  const [audit, setAudit] = useState<AuditRow[]>(localAudit);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [pending, setPending] = useState<PendingRequestRow[]>([]);
  const [configured, setConfigured] = useState(false);
  const onLiveUpdateRef = useRef(onLiveUpdate);
  onLiveUpdateRef.current = onLiveUpdate;

  useEffect(() => {
    setAudit((prev) => {
      const ids = new Set(prev.map((a) => a.id));
      const merged = [...localAudit.filter((a) => !ids.has(a.id)), ...prev];
      return merged.slice(0, 50);
    });
  }, [localAudit]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/live");
      const data = (await res.json()) as {
        configured: boolean;
        audit: AuditRow[];
        grants: GrantRow[];
        pending_requests: PendingRequestRow[];
        account: LiveAccountPayload | null;
      };
      if (cancelled) return;
      setConfigured(data.configured);
      setAudit(data.audit ?? []);
      setGrants(data.grants ?? []);
      setPending(data.pending_requests ?? []);
      onLiveUpdateRef.current?.({
        audit: data.audit ?? [],
        grants: data.grants ?? [],
        pending_requests: data.pending_requests ?? [],
        account: data.account ?? null,
      });
    }

    void load();

    const client = tryCreateBrowserClient();
    let channel: ReturnType<NonNullable<typeof client>["channel"]> | null =
      null;

    if (client) {
      channel = client
        .channel("keyring-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "audit" },
          () => {
            void load();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "grants" },
          () => {
            void load();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pending_requests" },
          () => {
            void load();
          },
        )
        .subscribe();
    }

    // Poll quickly while requests are pending so taps show within ~1s even
    // without Realtime (local demo / stage fallback).
    const poll = window.setInterval(() => void load(), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (client && channel) void client.removeChannel(channel);
    };
  }, []);

  const activeGrants = useMemo(
    () =>
      grants.filter(
        (g) => !g.revoked_at && new Date(g.expires_at).getTime() > Date.now(),
      ),
    [grants],
  );

  return (
    <div className="terminal-panel grid h-36 grid-cols-2 border-t">
      <div className="flex min-h-0 flex-col border-r border-primary/20">
        <div className="flex items-center justify-between border-b border-primary/15 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Audit log
          </span>
          <span className="text-[10px] text-primary/70">
            {configured ? "live" : "local"}
            {pending.length > 0 ? ` · ${pending.length} pending` : ""}
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y divide-primary/10">
            {audit.length === 0 ? (
              <li className="px-2 py-3 text-[11px] text-muted-foreground">
                No events yet.
              </li>
            ) : (
              audit.map((row) => (
                <li key={row.id} className="px-2 py-1.5 text-[11px] leading-snug">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-primary/90">{row.action}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {new Date(row.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {row.actor}
                    {row.detail && typeof row.detail === "object" ? (
                      <span>
                        {" · "}
                        {summarizeDetail(row.detail as Record<string, unknown>)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-primary/15 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Active grants
          </span>
          <span className="text-[10px] tabular-nums text-primary/70">
            {activeGrants.length}
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y divide-primary/10">
            {activeGrants.length === 0 ? (
              <li className="px-2 py-3 text-[11px] text-muted-foreground">
                No active elevated grants.
              </li>
            ) : (
              activeGrants.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {g.subject_id} · {g.role}
                    </div>
                    <div className="truncate text-muted-foreground">{g.target}</div>
                  </div>
                  <GrantCountdown expiresAt={g.expires_at} />
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </div>
    </div>
  );
}

function summarizeDetail(detail: Record<string, unknown>): string {
  const bits: string[] = [];
  if (typeof detail.finding_id === "string") bits.push(detail.finding_id);
  if (typeof detail.account_id === "string") bits.push(detail.account_id);
  if (typeof detail.request_id === "string") {
    bits.push(`req ${detail.request_id.slice(0, 8)}`);
  }
  if (typeof detail.question === "string") {
    bits.push(
      detail.question.length > 48
        ? `${detail.question.slice(0, 48)}…`
        : detail.question,
    );
  }
  if (typeof detail.finding_count === "number") {
    bits.push(`${detail.finding_count} findings`);
  }
  return bits.join(" · ") || "event";
}
