# VaultEdge Cryptographic & Security Architecture

This document explains the security design, cryptographic choices, and architectural rationale behind VaultEdge.

---

## 🔒 The Core Philosophy: Zero-Trust Key Management

In typical AI integrations, API keys for platforms (OpenAI, Gemini, Anthropic) are stored in plaintext databases or encrypted under master keys managed entirely by cloud servers. If the database is compromised, the provider keys are exposed, leading to potential financial exploitation or data leaks.

VaultEdge operates on a **Zero-Trust model**:
1. **End-to-End Client Encryption**: Raw keys are encrypted directly on your local device (CLI/browser).
2. **Opaque Vault Strings**: The server only stores or receives an encrypted vault blob starting with `VE_VAULT_v1_`.
3. **No Key Storage on Server Databases**: The master password is never sent to or stored by any server database.
4. **Lazy Runtime Decryption**: Keys are only decrypted in-memory inside the client SDK or local proxy instance at runtime.

---

## 🛠️ The Cryptographic Model

VaultEdge uses the standard browser-native **Web Crypto API** (supported in modern browsers, Node.js 18+, Bun, Deno, and Cloudflare Workers/Vercel Edge) to perform secure, high-performance cryptography.

### 1. Key Derivation Function (KDF)
To convert your Master Password or local machine secret into a secure 256-bit encryption key, VaultEdge uses:
* **Algorithm**: `PBKDF2-HMAC-SHA256`
* **Iterations**: `210,000` (conforms to the OWASP recommended guidelines for cryptographic strength)
* **Salt Size**: `32 bytes` (cryptographically random)

### 2. Encryption Algorithm
Once the key is derived, the vault payload is encrypted using:
* **Algorithm**: `AES-256-GCM` (Galois/Counter Mode for authenticated encryption, ensuring payload integrity and preventing tampering)
* **Initialization Vector (Nonce)**: `12 bytes` (unique per encryption)

### 3. Vault Wire Format
When you run `vaultedge vault export`, the CLI yields a single portable string format:
```text
VE_VAULT_v1_<Base64Payload>
```
The decoded `<Base64Payload>` is structured as a contiguous byte array:
```text
┌────────────────────────┬────────────────────────┬──────────────────────────────────┐
│       Salt (32B)       │       Nonce (12B)      │      AES-256-GCM Ciphertext      │
└────────────────────────┴────────────────────────┴──────────────────────────────────┘
```

---

## 🗄️ Local Storage Architecture (CLI & Proxy Integration)

VaultEdge implements separate, sandboxed encryption models depending on where keys reside.

### A. Local Machine Storage (`~/.vaultedge/`)
When using the CLI or local proxy server without supplying a Master Password, VaultEdge secures keys on your hard drive to prevent other local user processes or malicious scripts from accessing them in plaintext:
1. **System Secret**: On first run, VaultEdge generates a secure 32-byte random hex secret and writes it to `~/.vaultedge/.secret`.
2. **File Permissions**: The secret is locked down with strict OS-level file permissions (`0o600` — read/write only by the owner).
3. **Encrypted JSON**: Your credentials are encrypted via AES-256-GCM using that secret and stored in `~/.vaultedge/local.vault.json`.

### B. Browser Storage (Web UI Dashboard)
To keep the dashboard interface fully client-side and secure:
* Keys added directly to the Web UI are encrypted using `AES-256-GCM` before being committed to your browser's `localStorage` cache.
* They never leave your device or contact our servers in plaintext.

---

## ⚖️ Rationale: Security vs. Complexity Trade-Off

While managing master passwords, decryption keys, and environment vault strings adds initial configuration steps, it provides critical production guarantees:

| Concern | Traditional Key Gateways | VaultEdge (Zero-Trust) |
| :--- | :--- | :--- |
| **Server Database Hack** | ❌ All client API keys are leaked |  Keys remain encrypted and unreadable |
| **Malware read on local filesystem**| ❌ Key files are exposed in plaintext | 🛡️ Key files are AES-GCM encrypted |
| **Cloud Provider Trust** | ❌ Provider can see/intercept raw keys | 🛡️ Provider only sees encrypted vault blobs |
| **Edge Function Latency** | ❌ Requires querying central key database | ⚡ Instant in-memory decryption locally |
