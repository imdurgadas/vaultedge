"use client";
import { useState, useEffect, useCallback } from "react";
import Shell from "@/components/layout/Shell";
import { ToastContainer, toast } from "@/components/ui/Toast";
import {
  getKeys, addKey, removeKey, setKeyValid, importVaultKeys,
  type StoredKey,
} from "@/lib/store";

const PROVIDERS = [
  "OpenAI", "Anthropic", "Groq", "Gemini", "Mistral", "xAI", "DeepSeek",
  "OpenRouter", "Cohere", "Cerebras", "Sambanova", "Cloudflare",
  "Github", "Nvidia", "Together", "Perplexity",
];

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI:     "#10a37f",
  Anthropic:  "#c96442",
  Groq:       "#f55036",
  Gemini:     "#4285f4",
  Mistral:    "#ff7000",
  xAI:        "#ffffff",
  DeepSeek:   "#4d6bfe",
  OpenRouter: "#6366f1",
  Cohere:     "#39d3c3",
  Cerebras:   "#9b59b6",
  Sambanova:  "#e74c3c",
  Cloudflare: "#f48120",
  Github:     "#6e7681",
  Nvidia:     "#76b900",
  Together:   "#2563eb",
  Perplexity: "#20b2aa",
};

function ProviderIcon({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider] ?? "#888";
  return (
    <div
      className="provider-icon"
      style={{
        background: `${color}18`,
        border: `1px solid ${color}33`,
        color,
      }}
    >
      {provider[0]}
    </div>
  );
}

function StatusBadge({ valid }: { valid: boolean | null }) {
  if (valid === null) return <span className="badge badge-muted">Unknown</span>;
  if (valid) return <span className="badge badge-green">● Valid</span>;
  return <span className="badge badge-red">● Invalid</span>;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importVaultString, setImportVaultString] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [proxyHost, setProxyHost] = useState("http://localhost:8787");
  const [proxyKey, setProxyKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setProxyHost(localStorage.getItem("ve_proxy_host") || "http://localhost:8787");
      setProxyKey(localStorage.getItem("ve_proxy_key") || "");
    }
  }, []);

  const reload = useCallback(async () => setKeys(await getKeys()), []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = keys.filter((k) =>
    k.provider.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async () => {
    if (!apiKey.trim()) return;
    await addKey(provider, apiKey.trim());
    setApiKey("");
    setShowModal(false);
    await reload();
    toast(`${provider} key added`, "success");
  };

  const handleImport = async () => {
    if (!importVaultString.trim() || !importPassword) return;
    setImporting(true);
    try {
      const { decryptVault } = await import("@vaultedge/core");
      const decrypted = await decryptVault(importVaultString.trim(), importPassword);
      if (decrypted.length === 0) {
        toast("The vault is empty or decrypted key list is invalid", "error");
        setImporting(false);
        return;
      }
      await importVaultKeys(decrypted);
      setImportVaultString("");
      setImportPassword("");
      setShowImportModal(false);
      await reload();
      toast(`Imported ${decrypted.length} keys successfully!`, "success");
    } catch (err) {
      toast("Decryption failed: incorrect password or corrupted vault string", "error");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string, p: string) => {
    await removeKey(id);
    await reload();
    toast(`${p} key removed`, "info");
  };

  const handleValidate = async (key: StoredKey) => {
    setValidating(key.id);
    try {
      const host = localStorage.getItem("ve_proxy_host") || "http://localhost:8787";
      const sysKey = localStorage.getItem("ve_proxy_key") || "";

      const res = await fetch(`${host}/v1/keys/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sysKey}`,
        },
        body: JSON.stringify({
          provider: key.provider,
          key: key.key,
        }),
      });

      if (res.status === 401) {
        toast("Validation unauthorized: Check System Key in top-right settings.", "error");
        await setKeyValid(key.id, false);
        return;
      }

      if (!res.ok) {
        const err = await res.json();
        const msg = err.error?.message || `HTTP ${res.status}`;
        toast(`Validation error: ${msg}`, "error");
        await setKeyValid(key.id, false);
        return;
      }

      const data = await res.json() as { valid: boolean; message?: string };
      await setKeyValid(key.id, data.valid);

      if (data.valid) {
        toast(`${key.provider} key validated successfully ✓`, "success");
      } else {
        toast(`Validation failed: ${data.message || "Invalid API key"}`, "error");
      }
    } catch (err) {
      toast(`Connection error: ${err instanceof Error ? err.message : String(err)}`, "error");
      await setKeyValid(key.id, false);
    } finally {
      await reload();
      setValidating(null);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("ve_proxy_host", proxyHost);
    localStorage.setItem("ve_proxy_key", proxyKey);
    setShowSettings(false);
    toast("Settings saved successfully", "success");
  };

  const stats = {
    total: keys.length,
    valid: keys.filter((k) => k.isValid === true).length,
    providers: new Set(keys.map((k) => k.provider)).size,
  };

  return (
    <Shell>
      <div className="topbar">
        <span className="topbar-title">API Keys</span>
        <div className="topbar-actions">
          <input
            className="input"
            style={{ width: 200 }}
            placeholder="Search providers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-ghost" onClick={() => setShowImportModal(true)}>
            📥 Import Vault
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)} title="Proxy Settings">
            ⚙️ Settings
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <PlusIcon /> Add Key
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Your API Keys</h1>
            <p className="page-header-sub">
              Keys are stored encrypted in your browser. Never sent to any server.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setShowImportModal(true)}>
              📥 Import Vault
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <PlusIcon /> Add Key
            </button>
          </div>
        </div>

        {/* Stats */}
        {keys.length > 0 && (
          <div className="grid-3 mb-6">
            <div className="card stat-card">
              <div className="stat-value text-accent">{stats.total}</div>
              <div className="stat-label">Total Keys</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value" style={{ color: "var(--green)" }}>{stats.valid}</div>
              <div className="stat-label">Validated</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.providers}</div>
              <div className="stat-label">Providers</div>
            </div>
          </div>
        )}

        {/* Key list */}
        {filtered.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-state-icon">🔑</div>
            <div className="empty-state-title">
              {search ? "No matching keys" : "No keys yet"}
            </div>
            <div className="empty-state-desc">
              {search ? "Try a different search term." : "Add your first API key to get started."}
            </div>
            {!search && (
              <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                <PlusIcon /> Add Key
              </button>
            )}
          </div>
        ) : (
          <div className="grid-2">
            {filtered.map((k) => (
              <div key={k.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ProviderIcon provider={k.provider} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{k.provider}</div>
                      <div className="mono text-muted" style={{ marginTop: "0.1rem" }}>{k.maskedKey}</div>
                    </div>
                  </div>
                  <StatusBadge valid={k.isValid} />
                </div>

                <div className="text-xs text-muted">
                  Added {new Date(k.addedAt * 1000).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </div>

                <div className="flex gap-2" style={{ marginTop: "auto" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleValidate(k)}
                    disabled={validating === k.id}
                  >
                    {validating === k.id ? <Spinner /> : <CheckIcon />}
                    {validating === k.id ? "Checking..." : "Validate"}
                  </button>
                  <button
                    className="btn btn-danger btn-icon btn-sm"
                    onClick={() => handleDelete(k.id, k.provider)}
                    title="Remove key"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Key Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Add API Key</h2>
            <p className="modal-sub">Encrypted and stored locally. Never leaves your device.</p>

            <div className="form-group">
              <label className="form-label">Provider</label>
              <select
                className="input"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                className="input"
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
              />
            </div>

            <div
              style={{
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.15)",
                borderRadius: "8px",
                padding: "0.75rem",
                fontSize: "0.775rem",
                color: "var(--text-secondary)",
                display: "flex",
                gap: "0.5rem",
              }}
            >
              <span>🔐</span>
              <span>
                Keys are encrypted in your browser's localStorage using AES-256-GCM.
                Use <strong>Export</strong> to get a portable encrypted vault string.
              </span>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setShowModal(false); setApiKey(""); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={!apiKey.trim()}>
                <PlusIcon /> Add Key
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}>
          <div className="modal">
            <h2 className="modal-title">Import Vault String</h2>
            <p className="modal-sub">Paste an encrypted vault string (starting with VE_VAULT_v1_) and enter the password to decrypt and import keys.</p>

            <div className="form-group">
              <label className="form-label">Vault String</label>
              <textarea
                className="input"
                style={{ height: 100, resize: "none", fontFamily: "monospace", fontSize: "0.75rem" }}
                placeholder="VE_VAULT_v1_..."
                value={importVaultString}
                onChange={(e) => setImportVaultString(e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Master Password</label>
              <input
                className="input"
                type="password"
                placeholder="Enter password used to encrypt vault"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleImport()}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setShowImportModal(false); setImportVaultString(""); setImportPassword(""); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleImport} disabled={!importVaultString.trim() || !importPassword || importing}>
                {importing ? "Decrypting..." : "📥 Import Keys"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="modal">
            <h2 className="modal-title">Proxy Settings</h2>
            <p className="modal-sub">Configure the local proxy server URL and System Key to enable real key validation.</p>

            <div className="form-group">
              <label className="form-label">Proxy Host URL</label>
              <input
                className="input"
                placeholder="http://localhost:8787"
                value={proxyHost}
                onChange={(e) => setProxyHost(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">System Key (Bearer Token)</label>
              <input
                className="input"
                type="password"
                placeholder="ve-..."
                value={proxyKey}
                onChange={(e) => setProxyKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveSettings()}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveSettings}>
                💾 Save Settings
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
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      style={{ animation: "spin 0.8s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2a10 10 0 0110 10" />
    </svg>
  );
}
