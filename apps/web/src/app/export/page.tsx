"use client";
import { useState } from "react";
import Shell from "@/components/layout/Shell";
import { ToastContainer, toast } from "@/components/ui/Toast";

export default function ExportPage() {
  const [step, setStep] = useState<"form" | "result">("form");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [vaultString, setVaultString] = useState("");
  const [copied, setCopied] = useState(false);

  const handleExport = async () => {
    if (!password || password !== confirm) return;
    setLoading(true);

    // Dynamically import the browser-compatible vault crypto
    try {
      const { encryptVault } = await import("@durgadas/vaultedge-core");
      // Read keys from localStorage store
      const { getKeys } = await import("@/lib/store");
      const storedKeys = await getKeys();

      if (storedKeys.length === 0) {
        toast("No keys to export. Add some on the Keys page.", "error");
        setLoading(false);
        return;
      }

      // Export actual raw keys
      const entries = storedKeys.map((k) => ({
        provider: k.provider,
        key: k.key,
      }));

      const result = await encryptVault(entries, password);
      setVaultString(result);
      setStep("result");
    } catch (err) {
      toast("Export failed: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(vaultString);
    setCopied(true);
    toast("Vault string copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([`VAULTEDGE_VAULT=${vaultString}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vault.env";
    a.click();
    URL.revokeObjectURL(url);
    toast("vault.env downloaded", "success");
  };

  return (
    <Shell>
      <div className="topbar">
        <span className="topbar-title">Export Vault</span>
      </div>

      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-header-title">Export Vault</h1>
            <p className="page-header-sub">
              Encrypt your keys into a portable vault string for serverless deployments.
            </p>
          </div>
        </div>

        {step === "form" ? (
          <div style={{ maxWidth: 520 }}>
            {/* How it works */}
            <div className="card mb-6">
              <div style={{ fontWeight: 600, marginBottom: "1rem" }}>How it works</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {[
                  ["🔑", "All your vault keys are encrypted with your master password"],
                  ["🧂", "A unique random salt is generated per export (prevents rainbow table attacks)"],
                  ["🔐", "AES-256-GCM + PBKDF2-SHA256 (210k iterations) — military-grade encryption"],
                  ["🚀", "Set VAULTEDGE_VAULT + VAULTEDGE_PASSWORD in Vercel / Railway / Fly.io"],
                ].map(([icon, text]) => (
                  <div key={text} className="flex items-center gap-3 text-sm text-secondary">
                    <span style={{ fontSize: "1.1rem" }}>{icon}</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="card">
              <div className="form-group">
                <label className="form-label">Master Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Choose a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExport()}
                />
                {confirm && password !== confirm && (
                  <div className="text-xs" style={{ color: "var(--red)", marginTop: "0.4rem" }}>
                    Passwords do not match
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center", padding: "0.7rem" }}
                onClick={handleExport}
                disabled={!password || password !== confirm || loading}
              >
                {loading ? "Encrypting..." : "⚡ Generate Encrypted Vault"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 640 }}>
            <div className="card mb-4" style={{
              background: "rgba(34,197,94,0.04)",
              border: "1px solid rgba(34,197,94,0.2)",
            }}>
              <div className="flex items-center gap-3 mb-4">
                <span style={{ fontSize: "1.5rem" }}>✅</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Vault exported successfully</div>
                  <div className="text-sm text-secondary">Set these env vars in your deployment</div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">VAULTEDGE_VAULT</label>
                <div className="vault-string-box">{vaultString}</div>
              </div>

              <div className="form-group">
                <label className="form-label">VAULTEDGE_PASSWORD</label>
                <div className="vault-string-box">[the password you just set]</div>
              </div>

              <div className="flex gap-3 mt-4">
                <button className="btn btn-primary" onClick={handleCopy} style={{ flex: 1, justifyContent: "center" }}>
                  {copied ? "✓ Copied!" : "📋 Copy Vault String"}
                </button>
                <button className="btn btn-ghost" onClick={handleDownload}>
                  ⬇ Download .env
                </button>
              </div>
            </div>

            {/* Usage snippet */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.875rem" }}>
                Use it in your app
              </div>
              <div className="code-block">{`import { VaultEdge } from "vaultedge-sdk";

const ve = new VaultEdge({
  vault: process.env.VAULTEDGE_VAULT,
  password: process.env.VAULTEDGE_PASSWORD,
});

const resp = await ve.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});`}
              </div>
            </div>

            <div className="mt-2">
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep("form"); setPassword(""); setConfirm(""); setVaultString(""); }}>
                ← Export again with different password
              </button>
            </div>
          </div>
        )}
      </div>

      <ToastContainer />
    </Shell>
  );
}
