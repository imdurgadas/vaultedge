# VaultEdge E2E Local Verification

This document provides step-by-step instructions to run end-to-end (E2E) verification of VaultEdge locally using the stored Gemini API key.

## 📋 Prerequisites & Initial Check

1. **Verify Stored Keys:**
   Run the CLI command to ensure the Gemini key is present in your local vault:
   ```bash
   node packages/cli/dist/index.js vault list
   ```
   *Expected output:*
   ```text
   Local Vault Keys:
     ? Gemini           AIza...Kx4w          id:<uuid>
   ```

2. **Compile the Workspace:**
   Make sure all TypeScript packages and projects are built:
   ```bash
   npm run build
   ```

---

## ⚡ Method 1: HTTP Proxy Server E2E Verification (Recommended)

This method tests the complete flow through the VaultEdge standalone proxy server, acting as an OpenAI-compatible gateway.

### Step 1: Start the Proxy Server
Run the proxy locally in your terminal. You can define a target port and a custom system Bearer token key:
```bash
VAULTEDGE_PORT=8787 VAULTEDGE_SYSTEM_KEY=test-system-key VAULTEDGE_DEBUG=true npm run dev:proxy
```
*The proxy will load your local key automatically:*
```text
[vaultedge] Vault loaded from local file (~/.vaultedge/local.vault.json): 1 keys [Gemini]
🔐 VaultEdge Proxy
   Listening: http://127.0.0.1:8787
   System Key: test-system-key
```

### Step 2: Make the completion request
In another terminal, use `curl` to query the proxy server. 

> [!IMPORTANT]
> Use **`gemini-3.5-flash`** as the model name. The older `gemini-1.5-flash` model is not active on this workspace API key.

```bash
curl -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer test-system-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Tell me a very short joke."}]
  }'
```

*Expected output:*
```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "My wife told me to stop impersonating a flamingo. \n\nI had to put my foot down.",
        "role": "assistant"
      }
    }
  ],
  "model": "gemini-3.5-flash",
  "object": "chat.completion",
  "_ve_provider": "Gemini"
}
```

---

## 📦 Method 2: SDK Direct E2E Verification

This method runs verification using the compiled `vaultedge-sdk` package programmatically, pulling keys from an encrypted vault string.

### Step 1: Export the encrypted vault
Generate your encrypted vault string using the master password:
```bash
node packages/cli/dist/index.js vault export --password mysecretpassword
```
Copy the resulting `VAULTEDGE_VAULT=VE_VAULT_v1_...` string.

### Step 2: Create/Run a program
Create a javascript runner (e.g. `scratch/test_direct.js`):
```javascript
import { VaultEdge } from "../packages/sdk/dist/index.js";

const ve = new VaultEdge({
  vault: "VE_VAULT_v1_...", // Paste the exported vault string here
  password: "mysecretpassword",
  debug: true
});

try {
  const response = await ve.chat.completions.create({
    model: "gemini-3.5-flash",
    messages: [{ role: "user", content: "Hello!" }],
  });
  console.log("Success:", response.choices[0].message.content);
} catch (err) {
  console.error("Error:", err);
}
```

Run the script:
```bash
node scratch/test_direct.js
```

---

## 🌐 Method 3: Web UI Dashboard Verification

VaultEdge has an interactive Next.js-based web dashboard that interfaces with your running local proxy.

### Step 1: Start the Proxy Server
Keep the proxy server running on port `8787` with your system key:
```bash
VAULTEDGE_PORT=8787 VAULTEDGE_SYSTEM_KEY=test-system-key VAULTEDGE_DEBUG=true npm run dev:proxy
```

### Step 2: Start the Web Dashboard
In another terminal, start the Next.js development server:
```bash
npm run dev:web
```
*The web UI will start running at:* `http://localhost:3000`

### Step 3: Access and Configure Dashboard
Open your browser and navigate to the dashboard with the system key query parameter:
```text
http://localhost:3000/keys?key=test-system-key
```
This automatically configures the dashboard's `localStorage` credentials (`ve_proxy_key` and `ve_proxy_host`) and connects to your local proxy.

### Step 4: Validate Keys and Manage Settings
1. Go to the **Keys** tab:
   * You should see your `Gemini` key listed in the vault.
   * Click the **Validate** button. The dashboard will request key validation from the proxy, verifying your key with the live API.
2. Go to the **Routing** tab to view or create fallback/priority rules.
3. Go to the **Logs** tab to inspect latency and token usage logs from the E2E requests.

---

## 🔍 Gemini Model Compatibility Notes

During E2E setup, standard testing with `gemini-1.5-flash` returned a `404: models/gemini-1.5-flash is not found for API version v1main`. 

Querying Gemini's `ListModels` API directly using the stored key returned the list of active models:
* `gemini-3.5-flash`
* `gemini-2.5-flash`
* `gemini-2.0-flash`
* `gemini-flash-latest`
* `gemini-pro-latest`
