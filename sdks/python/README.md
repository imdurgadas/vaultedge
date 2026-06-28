# VaultEdge Python SDK 🔐

Zero-Trust AI API Key Manager & Routing Engine for Python. Decrypt credentials securely at runtime and implement automatic fallback routing between 15+ AI providers.

---

## 🚀 Key Features

* **Zero-Trust Security**: Raw API keys are never stored on server databases in plaintext. They are encrypted client-side using `AES-256-GCM` and only decrypted in-memory at runtime.
* **Smart Routing & Failover**: Configure automatic fallbacks so that if a primary provider (e.g. OpenAI) is down or rate-limited, the SDK transparently routes requests to secondary providers (e.g. Gemini, Anthropic).
* **OpenAI API Compatibility**: Works seamlessly with your existing AI workflows.

---

## 📦 Installation

Install VaultEdge using `pip`:

```bash
pip install vaultedge
```

Make sure your system has `cryptography` and `httpx` installed (automatically handled by pip):
```bash
pip install cryptography httpx
```

---

## 🛠️ Quick Start

Export your encrypted vault blob and password to environment variables:

```bash
export VAULTEDGE_VAULT="VE_VAULT_v1_<your_encrypted_payload>"
export VAULTEDGE_PASSWORD="your-master-password"
```

Initialize `VaultEdge` in Python and execute a request:

```python
import asyncio
import os
from vaultedge import VaultEdge

# Initialize with environment variables or constructor arguments
ve = VaultEdge(
    vault=os.environ["VAULTEDGE_VAULT"],
    password=os.environ["VAULTEDGE_PASSWORD"],
)

async def main():
    # Execute a chat completion (automatic routing & decryption)
    response = await ve.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello, VaultEdge!"}],
    )
    print(response["choices"][0]["message"]["content"])

asyncio.run(main())
```

---

## 🔒 Security Architecture

VaultEdge uses standard, high-performance cryptography primitives:
* **PBKDF2-HMAC-SHA256**: Converts your master password into a strong 256-bit encryption key with `210,000` iterations.
* **AES-256-GCM**: Secure authenticated encryption for the vault payload.

---

## 🔗 Resources

* **GitHub Repository**: [github.com/imdurgadas/vaultedge](https://github.com/imdurgadas/vaultedge)
* **License**: MIT
