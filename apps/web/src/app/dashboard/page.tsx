"use client";
import { useState, useEffect } from "react";
import Shell from "@/components/layout/Shell";
import { ToastContainer } from "@/components/ui/Toast";
import type { RoutingLog } from "@/lib/store";

// Model Cost Calculator
function getModelPricing(modelName: string) {
  const model = modelName.toLowerCase();
  if (model.includes("gpt-4o-mini")) {
    return { input: 0.00015, output: 0.0006 };
  } else if (model.includes("gpt-4o") || model.includes("gpt-4")) {
    return { input: 0.0025, output: 0.010 };
  } else if (model.includes("claude-3-5-sonnet")) {
    return { input: 0.003, output: 0.015 };
  } else if (model.includes("claude-3-5-haiku")) {
    return { input: 0.0008, output: 0.004 };
  } else if (
    model.includes("gemini-3.5-flash") ||
    model.includes("gemini-2.5-flash") ||
    model.includes("gemini-2.0-flash") ||
    model.includes("gemini-1.5-flash")
  ) {
    return { input: 0.000075, output: 0.0003 };
  } else if (
    model.includes("gemini-3.5-pro") ||
    model.includes("gemini-2.5-pro") ||
    model.includes("gemini-2.0-pro") ||
    model.includes("gemini-1.5-pro")
  ) {
    return { input: 0.00125, output: 0.005 };
  } else if (
    model.includes("llama") ||
    model.includes("groq") ||
    model.includes("mixtral") ||
    model.includes("gemma")
  ) {
    return { input: 0.0001, output: 0.0004 };
  }
  return { input: 0.0002, output: 0.0008 };
}

function estimateLogCost(model: string, totalTokens?: number): number {
  if (!totalTokens || totalTokens <= 0) return 0;
  const pricing = getModelPricing(model);
  // Assume a 70/30 split for prompt/completion tokens
  const promptEstimate = totalTokens * 0.7;
  const completionEstimate = totalTokens * 0.3;
  return (promptEstimate * pricing.input + completionEstimate * pricing.output) / 1000;
}

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#10a37f",
  Anthropic: "#c96442",
  Groq: "#f55036",
  Gemini: "#4285f4",
  Mistral: "#ff7000",
  xAI: "#ffffff",
  DeepSeek: "#4d6bfe",
  OpenRouter: "#6366f1",
  Cohere: "#39d3c3",
  Cerebras: "#9b59b6",
  Sambanova: "#e74c3c",
  Cloudflare: "#f48120",
  Github: "#6e7681",
  Nvidia: "#76b900",
  Together: "#2563eb",
  Perplexity: "#20b2aa",
};

export default function DashboardPage() {
  const [logs, setLogs] = useState<RoutingLog[]>([]);

  const loadLogs = async () => {
    try {
      const host = localStorage.getItem("ve_proxy_host") || "http://localhost:8787";
      const sysKey = localStorage.getItem("ve_proxy_key") || "";

      const res = await fetch(`${host}/v1/logs`, {
        headers: {
          Authorization: `Bearer ${sysKey}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Failed to fetch proxy logs:", err);
    }
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  // Filter logs for stats
  const successfulLogs = logs.filter((l) => l.status === "success" || l.status === "fallback");
  const failedCount = logs.filter((l) => l.status === "error").length;
  const fallbackCount = logs.filter((l) => l.status === "fallback").length;

  // Basic Metrics
  const totalRequests = logs.length;
  const totalTokens = successfulLogs.reduce((acc, curr) => acc + (curr.tokens ?? 0), 0);
  const avgLatency = successfulLogs.length
    ? Math.round(successfulLogs.reduce((acc, curr) => acc + curr.latencyMs, 0) / successfulLogs.length)
    : 0;

  const totalCost = successfulLogs.reduce(
    (acc, curr) => acc + estimateLogCost(curr.model, curr.tokens),
    0
  );

  // Group by Provider
  const providerStats: Record<string, { requests: number; tokens: number; cost: number }> = {};
  successfulLogs.forEach((log) => {
    if (!providerStats[log.provider]) {
      providerStats[log.provider] = { requests: 0, tokens: 0, cost: 0 };
    }
    providerStats[log.provider].requests += 1;
    providerStats[log.provider].tokens += log.tokens ?? 0;
    providerStats[log.provider].cost += estimateLogCost(log.model, log.tokens);
  });

  // Group by Model
  const modelStats: Record<string, { requests: number; tokens: number; cost: number; provider: string }> = {};
  successfulLogs.forEach((log) => {
    if (!modelStats[log.model]) {
      modelStats[log.model] = { requests: 0, tokens: 0, cost: 0, provider: log.provider };
    }
    modelStats[log.model].requests += 1;
    modelStats[log.model].tokens += log.tokens ?? 0;
    modelStats[log.model].cost += estimateLogCost(log.model, log.tokens);
  });

  const sortedModels = Object.entries(modelStats)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 5);

  const sortedProviders = Object.entries(providerStats)
    .sort((a, b) => b[1].requests - a[1].requests);

  // Sparkline Points Creator
  const getSparklinePath = (data: number[], width: number, height: number) => {
    if (data.length < 2) {
      return { linePath: "", areaPath: "", points: [] };
    }
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;

    const points = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * (width - 10) + 5;
      const y = height - ((val - minVal) / range) * (height - 20) - 10;
      return { x, y };
    });

    const linePath = `M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    return { linePath, areaPath, points };
  };

  // Sparklines datasets
  const last15Logs = [...logs].reverse().slice(0, 15).reverse();
  const sparklineLatencyData = last15Logs.map((l) => l.latencyMs);
  const sparklineTokensData = last15Logs.map((l) => l.tokens ?? 0);

  const latencySpark = getSparklinePath(sparklineLatencyData, 500, 150);
  const tokensSpark = getSparklinePath(sparklineTokensData, 500, 150);

  return (
    <Shell>
      <div className="topbar">
        <span className="topbar-title">Dashboard Overview</span>
      </div>

      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Analytics Dashboard</h1>
            <p className="page-header-sub">
              Live statistics, cost aggregation, and performance graphs from your proxy server.
            </p>
          </div>
        </div>

        {/* ─── Metric Cards Grid ─────────────────────────────────────────── */}
        <div className="grid-4 mb-6">
          <div className="card stat-card" style={{ borderLeft: "4px solid var(--accent)" }}>
            <div className="stat-value text-accent">{totalRequests}</div>
            <div className="stat-label">Total Requests</div>
            <div className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
              {fallbackCount} fallback routes · {failedCount} failed
            </div>
          </div>
          <div className="card stat-card" style={{ borderLeft: "4px solid var(--green)" }}>
            <div className="stat-value" style={{ color: "var(--green)" }}>
              {totalTokens.toLocaleString()}
            </div>
            <div className="stat-label">Tokens Used</div>
            <div className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
              Across all successful responses
            </div>
          </div>
          <div className="card stat-card" style={{ borderLeft: "4px solid #3b82f6" }}>
            <div className="stat-value" style={{ color: "#3b82f6" }}>
              {avgLatency}ms
            </div>
            <div className="stat-label">Average Latency</div>
            <div className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
              Proxy and API response time combined
            </div>
          </div>
          <div className="card stat-card" style={{ borderLeft: "4px solid var(--yellow)" }}>
            <div className="stat-value" style={{ color: "var(--yellow)" }}>
              ${totalCost.toFixed(5)}
            </div>
            <div className="stat-label">Estimated Cost</div>
            <div className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
              Calculated based on model token rates
            </div>
          </div>
        </div>

        {/* ─── Sparklines / Time Trends ──────────────────────────────────── */}
        <div className="grid-2 mb-6">
          <div className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-primary)" }}>
              Latency Trend (Last 15 Requests)
            </h3>
            {sparklineLatencyData.length > 1 ? (
              <svg viewBox="0 0 500 150" style={{ width: "100%", height: "120px", display: "block" }}>
                <defs>
                  <linearGradient id="latencyGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Horizontal reference grid lines */}
                <line x1="0" y1="30" x2="500" y2="30" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <line x1="0" y1="75" x2="500" y2="75" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <line x1="0" y1="120" x2="500" y2="120" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />

                <path d={latencySpark.areaPath} fill="url(#latencyGlow)" />
                <path d={latencySpark.linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />

                {latencySpark.points.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r="4"
                    fill="var(--bg-card)"
                    stroke="#3b82f6"
                    strokeWidth="2.5"
                    style={{ transition: "all 0.15s ease" }}
                  />
                ))}
              </svg>
            ) : (
              <div style={{ height: "120px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Waiting for more requests...
              </div>
            )}
          </div>

          <div className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-primary)" }}>
              Token Usage Trend (Last 15 Requests)
            </h3>
            {sparklineTokensData.length > 1 ? (
              <svg viewBox="0 0 500 150" style={{ width: "100%", height: "120px", display: "block" }}>
                <defs>
                  <linearGradient id="tokenGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--green)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Horizontal reference grid lines */}
                <line x1="0" y1="30" x2="500" y2="30" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <line x1="0" y1="75" x2="500" y2="75" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <line x1="0" y1="120" x2="500" y2="120" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />

                <path d={tokensSpark.areaPath} fill="url(#tokenGlow)" />
                <path d={tokensSpark.linePath} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" />

                {tokensSpark.points.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r="4"
                    fill="var(--bg-card)"
                    stroke="var(--green)"
                    strokeWidth="2.5"
                    style={{ transition: "all 0.15s ease" }}
                  />
                ))}
              </svg>
            ) : (
              <div style={{ height: "120px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Waiting for more requests...
              </div>
            )}
          </div>
        </div>

        {/* ─── Breakdown Columns ─────────────────────────────────────────── */}
        <div className="grid-2 mb-6">
          {/* Models usage breakdown */}
          <div className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "1.25rem", color: "var(--text-primary)" }}>
              Top Models Used
            </h3>
            {sortedModels.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {sortedModels.map(([modelName, stats]) => {
                  const maxRequests = Math.max(...Object.values(modelStats).map((s) => s.requests));
                  const percentage = Math.round((stats.requests / maxRequests) * 100);
                  const providerColor = PROVIDER_COLORS[stats.provider] ?? "var(--accent)";

                  return (
                    <div key={modelName}>
                      <div className="flex justify-between text-sm" style={{ marginBottom: "0.35rem" }}>
                        <span className="mono" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                          {modelName}
                        </span>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                          {stats.requests} reqs · {stats.tokens.toLocaleString()} tokens · ${stats.cost.toFixed(4)}
                        </span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.03)", height: "8px", borderRadius: "99px", overflow: "hidden" }}>
                        <div
                          style={{
                            background: providerColor,
                            width: `${percentage}%`,
                            height: "100%",
                            borderRadius: "99px",
                            boxShadow: `0 0 8px ${providerColor}4d`,
                            transition: "width 0.4s ease-out",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No active model logs found. Run a completion request to start visualization.
              </div>
            )}
          </div>

          {/* Providers usage breakdown */}
          <div className="card" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "1.25rem", color: "var(--text-primary)" }}>
              Provider Breakdown
            </h3>
            {sortedProviders.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {sortedProviders.map(([providerName, stats]) => {
                  const maxRequests = Math.max(...Object.values(providerStats).map((s) => s.requests));
                  const percentage = Math.round((stats.requests / maxRequests) * 100);
                  const color = PROVIDER_COLORS[providerName] ?? "var(--text-secondary)";

                  return (
                    <div key={providerName}>
                      <div className="flex justify-between text-sm" style={{ marginBottom: "0.35rem" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{providerName}</span>
                        <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                          {stats.requests} reqs · {stats.tokens.toLocaleString()} tokens · ${stats.cost.toFixed(4)}
                        </span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.03)", height: "8px", borderRadius: "99px", overflow: "hidden" }}>
                        <div
                          style={{
                            background: color,
                            width: `${percentage}%`,
                            height: "100%",
                            borderRadius: "99px",
                            boxShadow: `0 0 8px ${color}4d`,
                            transition: "width 0.4s ease-out",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No active provider logs found. Run a completion request to start visualization.
              </div>
            )}
          </div>
        </div>

        {/* ─── Recent Activity Log Preview ───────────────────────────────── */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <div className="flex justify-between items-center" style={{ marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Recent Activity
            </h3>
            <a
              href="/logs"
              className="text-xs text-accent"
              style={{ textDecoration: "none", fontWeight: 500 }}
            >
              View All Logs →
            </a>
          </div>
          {successfulLogs.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    <th style={{ padding: "0.5rem" }}>Time</th>
                    <th style={{ padding: "0.5rem" }}>Model</th>
                    <th style={{ padding: "0.5rem" }}>Provider</th>
                    <th style={{ padding: "0.5rem" }}>Latency</th>
                    <th style={{ padding: "0.5rem", textAlign: "right" }}>Tokens</th>
                    <th style={{ padding: "0.5rem", textAlign: "right" }}>Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...successfulLogs]
                    .reverse()
                    .slice(0, 5)
                    .map((log) => {
                      const cost = estimateLogCost(log.model, log.tokens);
                      return (
                        <tr
                          key={log.id}
                          style={{ borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}
                        >
                          <td style={{ padding: "0.6rem 0.5rem", color: "var(--text-secondary)" }}>
                            {new Date(log.timestamp * 1000).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </td>
                          <td className="mono" style={{ padding: "0.6rem 0.5rem" }}>
                            {log.model}
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem", fontWeight: 500 }}>
                            {log.provider}
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>
                            <span
                              style={{
                                color: log.latencyMs > 2000 ? "var(--yellow)" : "var(--green)",
                              }}
                            >
                              {log.latencyMs}ms
                            </span>
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>
                            {log.tokens?.toLocaleString() ?? "—"}
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", color: "var(--text-secondary)" }}>
                            ${cost.toFixed(5)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
              No recent requests mapped to active providers.
            </div>
          )}
        </div>
      </div>

      <ToastContainer />
    </Shell>
  );
}
