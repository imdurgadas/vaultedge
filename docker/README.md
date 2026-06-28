# VaultEdge Proxy 🔐

VaultEdge Proxy is a high-performance, zero-trust, OpenAI-compatible proxy server designed to manage and route LLM API keys securely without storing them in plaintext databases.

---

## 🚀 Key Features

* **Zero-Trust Key Management**: Raw API keys are never stored in database tables in plaintext. They are encrypted client-side using `AES-256-GCM` and only decrypted in-memory inside the proxy instance at runtime.
* **Smart Routing & Failover**: Configurable automatic fallbacks. If a primary provider (e.g. OpenAI) is down or rate-limited, the proxy transparently routes requests to secondary providers (e.g. Gemini, Anthropic).
* **OpenAI API Compatibility**: Works out of the box with any standard OpenAI SDK (Node.js, Python, Go, etc.) by simply changing your client's `baseURL`.

---

## 🛠️ Quick Start

### 1. Run with Docker CLI

Launch the proxy container locally by supplying your encrypted vault payload and master password:

```bash
docker run -d \
  -p 8787:8787 \
  -e VAULTEDGE_VAULT="VE_VAULT_v1_your_encrypted_vault_blob" \
  -e VAULTEDGE_PASSWORD="your-master-password" \
  durgadas/vaultedge-proxy:latest
```

### 2. Run with Docker Compose

You can define it in your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  vaultedge-proxy:
    image: durgadas/vaultedge-proxy:latest
    ports:
      - "8787:8787"
    environment:
      - VAULTEDGE_VAULT=VE_VAULT_v1_your_encrypted_vault_blob
      - VAULTEDGE_PASSWORD=your-master-password
```

Then start the service:
```bash
docker-compose up -d
```

---

## 💡 How to Query the Proxy

Once the proxy is running, point your LLM clients to:
* **API Base URL**: `http://localhost:8787/v1`
* **API Key**: The system-level proxy key printed in the container console during startup.

---

## 🔗 Links

* **GitHub Repository**: [github.com/imdurgadas/vaultedge](https://github.com/imdurgadas/vaultedge)
* **SDK Documentation**: Detailed guides for Node.js, Python, and Go SDKs are available in the [README.md](https://github.com/imdurgadas/vaultedge).
