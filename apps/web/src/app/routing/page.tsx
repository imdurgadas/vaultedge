"use client";
import { useState, useEffect, useCallback } from "react";
import Shell from "@/components/layout/Shell";
import { ToastContainer, toast } from "@/components/ui/Toast";
import {
  getKeys, getRules, addRule, removeRule, moveRule, saveRules,
  type RoutingRule,
} from "@/lib/store";

const PROVIDERS = [
  "OpenAI","Anthropic","Groq","Gemini","Mistral","xAI","DeepSeek",
  "OpenRouter","Cohere","Cerebras","Sambanova","Cloudflare","Github","Nvidia","Together","Perplexity",
];

export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newProvider, setNewProvider] = useState(PROVIDERS[0]);
  const [newModel, setNewModel] = useState("");

  const reload = useCallback(() => {
    setRules(getRules());
    setAvailableProviders([...new Set(getKeys().map((k) => k.provider))]);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleAdd = () => {
    if (!newModel.trim()) return;
    addRule(newProvider, newModel.trim());
    setNewModel("");
    setShowModal(false);
    reload();
    toast(`Rule added: ${newProvider} → ${newModel}`, "success");
  };

  const handleRemove = (id: string) => {
    removeRule(id);
    reload();
    toast("Routing rule removed", "info");
  };

  const handleMove = (id: string, dir: "up" | "down") => {
    moveRule(id, dir);
    reload();
  };

  return (
    <Shell>
      <div className="topbar">
        <span className="topbar-title">Routing Rules</span>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <PlusIcon /> Add Rule
          </button>
        </div>
      </div>

      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Routing Rules</h1>
            <p className="page-header-sub">
              Define which provider handles each model. Rules are tried in priority order.
              Without rules, the model name is auto-detected.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <PlusIcon /> Add Rule
          </button>
        </div>

        {/* Auto-routing notice */}
        <div
          className="card mb-6"
          style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}
        >
          <span style={{ fontSize: "1.4rem" }}>⚡</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.3rem" }}>Auto-Routing Active</div>
            <div className="text-sm text-secondary">
              When no rules are set, VaultEdge automatically routes based on model name prefixes
              defined in <code style={{ background: "rgba(255,255,255,0.07)", padding: "0.1rem 0.35rem", borderRadius: "4px" }}>providers.yaml</code>.
              Explicit rules override auto-routing.
            </div>
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-state-icon">⚙️</div>
            <div className="empty-state-title">No routing rules</div>
            <div className="empty-state-desc">
              Auto-routing is active. Add explicit rules to control which provider handles each model.
            </div>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <PlusIcon /> Add Rule
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                {rules.length} rule{rules.length !== 1 ? "s" : ""} · tried top-to-bottom
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { saveRules([]); reload(); toast("All rules cleared", "info"); }}
              >
                Clear all
              </button>
            </div>

            <div style={{ padding: "0.75rem 1rem" }}>
              {rules.map((rule, idx) => (
                <div key={rule.id} className="rule-row">
                  <div className="rule-number">{idx + 1}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{rule.provider}</div>
                    <div className="mono text-muted">{rule.model}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => handleMove(rule.id, "up")}
                      disabled={idx === 0}
                      title="Move up"
                    >↑</button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => handleMove(rule.id, "down")}
                      disabled={idx === rules.length - 1}
                      title="Move down"
                    >↓</button>
                    <button
                      className="btn btn-danger btn-icon btn-sm"
                      onClick={() => handleRemove(rule.id)}
                      title="Remove rule"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add Routing Rule</h2>
            <p className="modal-sub">Route a specific model to a specific provider.</p>

            <div className="form-group">
              <label className="form-label">Provider</label>
              <select className="input" value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}{availableProviders.includes(p) ? " ✓" : ""}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Model Name</label>
              <input
                className="input"
                placeholder="e.g. gpt-4o, claude-3-5-sonnet-latest"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setShowModal(false); setNewModel(""); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={!newModel.trim()}>
                <PlusIcon /> Add Rule
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </Shell>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
