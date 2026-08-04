"use client";

import { useEffect, useMemo, useState } from "react";
import { useEventStream } from "../hooks/use-event-stream";
import { apiConfig } from "../lib/api-config";

type LiveEvent = {
  sample: {
    checkId: string;
    region: string;
    ok: boolean;
    latencyMs: number;
    statusCode: number | null;
    error: string | null;
  };
  receivedAt: string;
};

const sourceUrl = apiConfig.sse;

type ProbeRow = {
  id: string;
  time: string;
  region: string;
  service: string;
  statusCode: string;
  latency: string;
  ok: boolean;
  errorLabel: string;
};

function normalizeRegion(region: string): string {
  const value = region.toLowerCase();
  if (value === "us-east-1") return "us-east";
  if (value === "eu-west-1") return "eu-west";
  if (value === "ap-south-1") return "ap-south";
  return value;
}

function formatProbeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function mapEventToRow(event: LiveEvent, checkNames: Record<string, string>): ProbeRow {
  return {
    id: `${event.sample.checkId}-${event.receivedAt}-${event.sample.region}`,
    time: formatProbeTime(event.receivedAt),
    region: event.sample.region,
    service: checkNames[event.sample.checkId] ?? event.sample.checkId.slice(0, 8),
    statusCode: String(event.sample.statusCode ?? "ERR"),
    latency: event.sample.ok ? `${Math.round(event.sample.latencyMs)} ms` : "-",
    ok: event.sample.ok,
    errorLabel: event.sample.ok ? "" : "error"
  };
}

export function LiveProbePanel({
  paused,
  regionFilter,
  searchText,
  checkNames = {}
}: {
  paused: boolean;
  regionFilter: string;
  searchText: string;
  checkNames?: Record<string, string>;
}): JSX.Element {
  const { events, connected } = useEventStream<LiveEvent>(sourceUrl, 40);
  const [localFilter, setLocalFilter] = useState("");
  const [visibleRows, setVisibleRows] = useState<ProbeRow[]>([]);

  useEffect(() => {
    if (paused) {
      return;
    }

    if (events.length === 0) {
      setVisibleRows([]);
      return;
    }

    setVisibleRows(events.map((event) => mapEventToRow(event, checkNames)).slice(0, 40));
  }, [checkNames, events, paused]);

  const filteredRows = useMemo(() => {
    const selected = regionFilter === "all" ? null : normalizeRegion(regionFilter);

    return visibleRows.filter((row) => {
      const regionPass = !selected || normalizeRegion(row.region) === selected;
      const q = `${searchText} ${localFilter}`.trim().toLowerCase();
      const searchPass = !q || `${row.service} ${row.region} ${row.statusCode}`.toLowerCase().includes(q);
      return regionPass && searchPass;
    });
  }, [localFilter, regionFilter, searchText, visibleRows]);

  const summary = useMemo(() => {
    const total = filteredRows.length;
    const errorCount = filteredRows.filter((row) => !row.ok).length;
    const failingPct = total ? ((errorCount / total) * 100).toFixed(1) : "0.0";
    const checks = new Set(filteredRows.map((row) => row.service)).size;
    const regionCount = new Set(filteredRows.map((row) => row.region)).size;

    return {
      checks,
      regionCount,
      failingPct
    };
  }, [filteredRows]);

  return (
    <article className="panel-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Live probes</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-primary)]">
            {paused ? "Paused" : "Live"}
          </span>
          <input
            value={localFilter}
            onChange={(event) => setLocalFilter(event.target.value)}
            placeholder="Filter"
            className="w-24 rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
          />
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--text-muted)]">
        Streaming {summary.checks} checks x {summary.regionCount} regions · {summary.failingPct}% failing
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>{connected ? "connected" : "reconnecting"}</span>
        <span>{paused ? "paused" : "live"}</span>
      </div>

      <div className="max-h-[320px] overflow-auto rounded-md border border-[var(--border-color)]">
        {filteredRows.slice(0, 40).map((row) => (
          <div
            key={row.id}
            className={`probe-row-enter grid grid-cols-[66px_78px_minmax(0,1fr)_46px_62px_48px_48px] items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1 text-[11px] leading-5 last:border-b-0 ${
              row.ok ? "" : "border-l-2 border-l-[var(--status-down)] bg-[rgba(220,38,38,0.05)]"
            }`}
          >
            <span className="mono text-[var(--text-muted)]">{row.time}</span>
            <span className="mono text-[var(--text-primary)]">{row.region}</span>
            <span className="mono truncate text-[var(--text-primary)]">{row.service}</span>
            <span className="mono text-right text-[var(--text-primary)]">{row.statusCode}</span>
            <span className="mono text-right text-[var(--text-primary)]">{row.latency}</span>
            <span className="mono text-right text-[var(--text-primary)]">{row.ok ? "OK" : "ERR"}</span>
            <span className="mono text-right text-[var(--text-muted)]">{row.errorLabel}</span>
          </div>
        ))}

        {filteredRows.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--text-muted)]">
            {connected ? "Waiting for probe events…" : "Connecting to live stream…"}
          </p>
        )}
      </div>
    </article>
  );
}
