<div align="center">
  <h1>🔐 VaultEdge</h1>
  <p><strong>Zero-Trust AI Key Manager & Smart Proxy</strong></p>
  <p>Store LLM API keys encrypted. Route through 15+ providers. Fall back automatically. Never leak a key again.</p>

  [![TypeScript](https://img.shields.io/badge/TypeScript-SDK-blue?style=for-the-badge&logo=typescript)](https://www.npmjs.com/package/vaultedge-sdk)
  [![Python](https://img.shields.io/badge/Python-SDK-yellow?style=for-the-badge&logo=python)](https://pypi.org/project/vaultedge/)
  [![Go](https://img.shields.io/badge/Go-SDK-cyan?style=for-the-badge&logo=go)](https://pkg.go.dev/github.com/you/vaultedge)
  [![Docker](https://img.shields.io/badge/Docker-Proxy-2496ED?style=for-the-badge&logo=docker)](https://hub.docker.com/r/you/vaultedge)
  [![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
</div>

---

## What is VaultEdge?

VaultEdge is a **contributor-friendly, language-agnostic** AI API key manager. It solves three problems:

1. **Local dev**: Never accidentally commit `.env` files. Keys live encrypted on your machine.
2. **Production**: Deploy an encrypted vault string in one env var. Keys are decrypted at the edge, in memory only.
3. **Resilience**: If one provider is rate-limited or down, automatically fall back to the next one.

---

## Architecture

```
vaultedge/
├── packages/
│   ├── core/        # TypeScript — vault crypto + routing engine (shared)
│   ├── sdk/         # TypeScript — vaultedge-sdk npm package
│   └── cli/         # TypeScript — vaultedge CLI tool
├── apps/
│   ├── proxy/       # TypeScript — standalone HTTP proxy (Docker-ready)
│   └── web/         # Next.js — web dashboard (manage vault in browser)
├── sdks/
│   ├── python/      # Python SDK (pip install vaultedge)
│   └── go/          # Go SDK (go get github.com/you/vaultedge)
├── docker/          # Dockerfile + docker-compose.yml
└── providers.yaml   # 📝 Add new providers here — no code changes!
```

---

## Supported Providers

| Provider | Auto-detected models |
|---|---|
| OpenAI | `gpt-*`, `o1`, `o3`, `o4`, `davinci` |
| Groq | `llama`, `groq`, `mixtral`, `gemma` |
| Anthropic | `claude-*` |
| Gemini | `gemini-*` |
| Mistral | `mistral-*`, `codestral-*` |
| xAI | `grok-*` |
| DeepSeek | `deepseek-*` |
| OpenRouter | (any model via OpenRouter) |
| Cohere | `command-*`, `cohere-*` |
| Cerebras | `cerebras-*` |
| Sambanova | `meta-llama-*`, `qwen-*` |
| Cloudflare AI | `@cf/*` |
| GitHub Models | static list |
| Nvidia NIM | `nvidia-*`, `nim-*`, `nv-*` |
| Together AI | `together-*` |
| Perplexity | `sonar-*`, `pplx-*` |

> **Want to add a provider?** Edit [`providers.yaml`](./providers.yaml) — no code changes needed!

---

## Quick Start

### 1. Install the CLI

```bash
npm install -g @vaultedge/cli
```

### 2. Create & populate your vault

```bash
# Initialize local vault
vaultedge vault init

# Add your API keys interactively
vaultedge vault add-key

# List keys
vaultedge vault list

# Export an encrypted vault string
vaultedge vault export
# → VAULTEDGE_VAULT=VE_VAULT_v1_<...>
```

### 3. Use in your app

---

#### TypeScript / Node.js SDK

```bash
npm install vaultedge-sdk
```

```typescript
import { VaultEdge } from "vaultedge-sdk";

const ve = new VaultEdge({
  vault: process.env.VAULTEDGE_VAULT,
  password: process.env.VAULTEDGE_PASSWORD,
});

// Non-streaming
const response = await ve.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await ve.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

---

#### Python SDK

```bash
pip install vaultedge
```

```python
import asyncio
import os
from vaultedge import VaultEdge

ve = VaultEdge(
    vault=os.environ["VAULTEDGE_VAULT"],
    password=os.environ["VAULTEDGE_PASSWORD"],
)

async def main():
    response = await ve.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(response["choices"][0]["message"]["content"])

asyncio.run(main())
```

---

#### Go SDK

```bash
go get github.com/you/vaultedge
```

```go
package main

import (
    "context"
    "fmt"
    "os"
    "github.com/you/vaultedge/sdks/go/vaultedge"
)

func main() {
    client := vaultedge.New(os.Getenv("VAULTEDGE_VAULT"), os.Getenv("VAULTEDGE_PASSWORD"))
    
    resp, err := client.Chat().Create(context.Background(), vaultedge.ChatCompletionRequest{
        Model:    "gpt-4o",
        Messages: []vaultedge.ChatMessage{
            {Role: "user", Content: "Hello!"},
        },
    })
    if err != nil {
        panic(err)
    }
    fmt.Println(resp.Choices[0].Message.Content)
}
```

---

#### Run the Proxy Server (OpenAI-compatible)

Point any OpenAI SDK at VaultEdge — no code changes in your app!

**With Docker:**
```bash
docker-compose -f docker/docker-compose.yml up -d
```

**Locally:**
```bash
VAULTEDGE_VAULT="VE_VAULT_v1_..." \
VAULTEDGE_PASSWORD="my-password" \
node apps/proxy/dist/server.js
```

Then in your app:
```bash
export OPENAI_BASE_URL=http://localhost:8787/v1
export OPENAI_API_KEY=<system-key-printed-at-startup>
```

---

## Security Architecture

VaultEdge uses industry-standard primitives:

| Primitive | Usage |
|---|---|
| **AES-256-GCM** | Vault encryption (authenticated, tamper-proof) |
| **PBKDF2-HMAC-SHA256** | Password → key derivation (210,000 iterations) |
| **Random 256-bit salt** | Per-export unique salt (prevents rainbow table attacks) |
| **Random 96-bit nonce** | Per-export unique IV (prevents ciphertext reuse) |

The encrypted vault format is **cross-language compatible** — a vault exported by the CLI can be decrypted by the TypeScript, Python, or Go SDK.


---


## Contributing

VaultEdge is designed for contributors at all levels:

- **Add a provider**: Edit [`providers.yaml`](./providers.yaml) — no TypeScript/Go/Python needed
- **Improve the TypeScript SDK**: Work in [`packages/sdk/`](./packages/sdk/)
- **Improve the Python SDK**: Work in [`sdks/python/`](./sdks/python/)
- **Improve the Go SDK**: Work in [`sdks/go/`](./sdks/go/)
- **Improve the proxy**: Work in [`apps/proxy/`](./apps/proxy/)

See [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

---

## License

MIT — see [LICENSE](./LICENSE).
