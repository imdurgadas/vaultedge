"use client";
import { useState, useEffect } from "react";
import Shell from "@/components/layout/Shell";
import { ToastContainer, toast } from "@/components/ui/Toast";
import { getLogs, clearLogs, seedDemoLogs, type RoutingLog } from "@/lib/store";

function StatusBadge({ status }: { status: RoutingLog["status"] }) {
  if (status === "success") return <span className="badge badge-green">✓ Success</span>;
  if (status === "fallback") return <span className="badge badge-yellow">↩ Fallback</span>;
  return <span className="badge badge-red">✗ Error</span>;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<RoutingLog[]>([]);
  const [filter, setFilter] = useState<"all" | "success" | "fallback" | "error">("all");

  useEffect(() => {
    seedDemoLogs();
    setLogs(getLogs());
  }, []);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.status === filter);
  const counts = {
    all: logs.length,
    success: logs.filter((l) => l.status === "success").length,
    fallback: logs.filter((l) => l.status === "fallback").length,
    error: logs.filter((l) => l.status === "error").length,
  };

  const handleClear = () => {
    clearLogs();
    setLogs([]);
    toast("Routing logs cleared", "info");
  };

  return (
    <Shell>
      <div className="topbar">
        <span className="topbar-title">Routing Logs</span>
        <div className="topbar-actions">
          {logs.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleClear}>Clear logs</button>
          )}
        </div>
      </div>

      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Routing Logs</h1>
            <p className="page-header-sub">
              Every request routed through VaultEdge — provider chosen, latency, token usage.
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid-3 mb-6">
          <div className="card stat-card">
            <div className="stat-value">{counts.all}</div>
            <div className="stat-label">Total Requests</div>
          </div>
          <div className="card stat-card">
            <div className="stat-value" style={{ color: "var(--green)" }}>{counts.success}</div>
            <div className="stat-label">Successful</div>
          </div>
          <div className="card stat-card">
            <div className="stat-value" style={{ color: "var(--yellow)" }}>{counts.fallback}</div>
            <div className="stat-label">Fallbacks</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(["all", "success", "fallback", "error"] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              <span
                style={{
                  marginLeft: "0.25rem",
                  background: filter === f ? "rgba(0,0,0,0.2)" : "var(--bg-card)",
                  padding: "0 0.35rem",
                  borderRadius: "99px",
                  fontSize: "0.7rem",
                }}
              >
                {counts[f]}
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No logs</div>
            <div className="empty-state-desc">
              Routing events will appear here when requests flow through the proxy.
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Latency</th>
                  <th style={{ textAlign: "right" }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="text-xs mono">
                      {new Date(log.timestamp * 1000).toLocaleTimeString("en-US", {
                        hour: "2-digit", minute: "2-digit", second: "2-digit",
                      })}
                    </td>
                    <td className="mono" style={{ color: "var(--text-primary)" }}>{log.model}</td>
                    <td style={{ color: "var(--text-primary)", fontWeight: 500 }}>{log.provider}</td>
                    <td><StatusBadge status={log.status} /></td>
                    <td className="text-xs" style={{ textAlign: "right" }}>
                      <span style={{ color: log.latencyMs > 2000 ? "var(--yellow)" : "var(--green)" }}>
                        {log.latencyMs}ms
                      </span>
                    </td>
                    <td className="text-xs" style={{ textAlign: "right" }}>
                      {log.tokens?.toLocaleString() ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ToastContainer />
    </Shell>
  );
}
