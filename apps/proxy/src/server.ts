/**
 * VaultEdge Proxy Server
 *
 * A standalone HTTP server that acts as an OpenAI-compatible proxy,
 * routing requests through your encrypted vault keys with automatic
 * fallback, circuit breaking, and quota management.
 *
 * Environment variables:
 *   VAULTEDGE_VAULT      - Encrypted vault string (VE_VAULT_v1_...)
 *   VAULTEDGE_PASSWORD   - Master password to decrypt the vault
 *   VAULTEDGE_PORT       - Port to listen on (default: 8787)
 *   VAULTEDGE_HOST       - Host to bind to (default: 127.0.0.1)
 *   VAULTEDGE_SYSTEM_KEY - Bearer token required by clients (auto-generated if not set)
 *   VAULTEDGE_DEBUG      - Enable verbose logging (default: false)
 *   VAULTEDGE_MAX_RETRIES - Max provider fallbacks (default: 3)
 *   VAULTEDGE_TIMEOUT    - Request timeout ms (default: 60000)
 *   PROVIDERS_FILE       - Path to a custom providers.yaml
 *
 * Routes:
 *   POST /v1/chat/completions  - OpenAI-compatible chat (with fallback routing)
 *   POST /v1/messages          - Anthropic-native messages API
 *   GET  /v1/models            - List models from all vault providers
 *   GET  /health               - Health check
 *   GET  /status               - Vault + circuit breaker status
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  decryptVault,
  routeRequest,
  loadProviders,
  getProviderByName,
  CircuitBreaker,
  QuotaMap,
  VaultEdgeError,
  NoProviderError,
  AllProvidersFailedError,
  validateProviderKey,
  encryptLocalKey,
  decryptLocalKey,
  createStoredKeyEntry,
} from "@durgadas/vaultedge-core";
import yaml from "js-yaml";
import type { VaultEntry, ChatCompletionRequest, StoredKeyEntry, RoutingRule, ProviderDefinition } from "@durgadas/vaultedge-core";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.VAULTEDGE_PORT ?? "8787", 10);
const HOST = process.env.VAULTEDGE_HOST ?? "127.0.0.1";
const DEBUG = process.env.VAULTEDGE_DEBUG === "true";
const MAX_RETRIES = parseInt(process.env.VAULTEDGE_MAX_RETRIES ?? "3", 10);
const TIMEOUT = parseInt(process.env.VAULTEDGE_TIMEOUT ?? "60000", 10);
const PROVIDERS_FILE = process.env.PROVIDERS_FILE;
let customProviders: ProviderDefinition[] | undefined = undefined;
if (PROVIDERS_FILE && existsSync(PROVIDERS_FILE)) {
  try {
    const raw = readFileSync(PROVIDERS_FILE, "utf-8");
    const parsed = yaml.load(raw) as { providers: ProviderDefinition[] };
    if (parsed && Array.isArray(parsed.providers)) {
      customProviders = parsed.providers;
      console.log(`[vaultedge] Loaded ${customProviders.length} custom providers from ${PROVIDERS_FILE}`);
    }
  } catch (err) {
    console.error(`[vaultedge] Failed to load custom providers file "${PROVIDERS_FILE}":`, err);
  }
}
const DEFAULT_ROUTING_STRATEGY = (process.env.VAULTEDGE_ROUTING_STRATEGY ?? "default") as "cheapest" | "priority" | "default";
const DEFAULT_MAX_KEY_RETRIES = parseInt(process.env.VAULTEDGE_MAX_KEY_RETRIES ?? "2", 10);
const DEFAULT_BACKOFF_DELAY = parseInt(process.env.VAULTEDGE_BACKOFF_DELAY ?? "200", 10);

// ─── System Key ───────────────────────────────────────────────────────────────

const SYSTEM_KEY =
  process.env.VAULTEDGE_SYSTEM_KEY ?? `ve-${randomBytes(20).toString("hex")}`;

// ─── State ────────────────────────────────────────────────────────────────────

let vaultEntries: VaultEntry[] = [];
const circuitBreaker = new CircuitBreaker();
const quotaMap = new QuotaMap();

interface RequestLog {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  status: "success" | "error" | "fallback";
  latencyMs: number;
  tokens?: number;
}

const requestLogs: RequestLog[] = [];

function addRequestLog(log: Omit<RequestLog, "id" | "timestamp">) {
  const newLog: RequestLog = {
    ...log,
    id: randomBytes(16).toString("hex"),
    timestamp: Math.floor(Date.now() / 1000),
  };
  requestLogs.push(newLog);
  if (requestLogs.length > 200) {
    requestLogs.shift();
  }
}

// ─── Local Disk Vault Setup (Syncs with CLI) ───────────────────────────────────

const DATA_DIR = join(homedir(), ".vaultedge");
const VAULT_FILE = join(DATA_DIR, "local.vault.json");
const SECRET_FILE = join(DATA_DIR, ".secret");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getOrCreateSecret(): string {
  ensureDataDir();
  if (existsSync(SECRET_FILE)) {
    return readFileSync(SECRET_FILE, "utf-8").trim();
  }
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

interface LocalVault {
  version: 1;
  entries: StoredKeyEntry[];
  rules?: RoutingRule[];
}

function readLocalVault(): LocalVault {
  if (!existsSync(VAULT_FILE)) {
    return { version: 1, entries: [] };
  }
  try {
    const raw = readFileSync(VAULT_FILE, "utf-8");
    return JSON.parse(raw) as LocalVault;
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeLocalVault(vault: LocalVault) {
  ensureDataDir();
  writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

// ─── Vault Loader ─────────────────────────────────────────────────────────────

async function loadVault(): Promise<void> {
  const vault = process.env.VAULTEDGE_VAULT;
  const password = process.env.VAULTEDGE_PASSWORD;

  if (DEBUG) {
    console.log(`[vaultedge] loadVault: vault length = ${vault ? vault.length : "undefined"}, password length = ${password ? password.length : "undefined"}`);
  }

  if (vault && password) {
    vaultEntries = await decryptVault(vault, password);
    const providers = [...new Set(vaultEntries.map((e) => e.provider))];
    console.log(
      `[vaultedge] Vault loaded from ENV: ${vaultEntries.length} keys [${providers.join(", ")}]`
    );
    return;
  }

  // Load from local storage file (Syncs with CLI)
  try {
    const lv = readLocalVault();
    const secret = getOrCreateSecret();
    const entries: VaultEntry[] = [];
    for (const e of lv.entries) {
      const plaintext = await decryptLocalKey(e.encryptedKey, secret);
      entries.push({ provider: e.provider, key: plaintext });
    }
    vaultEntries = entries;
    const providers = [...new Set(vaultEntries.map((e) => e.provider))];
    console.log(
      `[vaultedge] Vault loaded from local file (${VAULT_FILE}): ${vaultEntries.length} keys [${providers.join(", ")}]`
    );
  } catch (err) {
    console.warn(
      "[vaultedge] No ENV vault provided, and failed to load local disk vault file. " +
        "Please create local keys via CLI or start dashboard to set keys. Error: " + (err instanceof Error ? err.message : String(err))
    );
  }
}

// ─── Request Helpers ──────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJSON(res, status, { error: { message, code: code ?? "error", type: "error" } });
}

function checkAuth(req: IncomingMessage): boolean {
  const auth = req.headers["authorization"];
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === SYSTEM_KEY;
}

function extractRoutingParams(req: IncomingMessage): {
  routingStrategy: "cheapest" | "priority" | "default";
  maxKeyRetries: number;
  backoffInitialDelayMs: number;
} {
  const strategyHeader = req.headers["x-vaultedge-routing-strategy"];
  const retriesHeader = req.headers["x-vaultedge-max-key-retries"];
  const delayHeader = req.headers["x-vaultedge-backoff-delay"];

  let routingStrategy = DEFAULT_ROUTING_STRATEGY;
  if (
    strategyHeader &&
    (strategyHeader === "cheapest" || strategyHeader === "priority" || strategyHeader === "default")
  ) {
    routingStrategy = strategyHeader as "cheapest" | "priority" | "default";
  }

  let maxKeyRetries = DEFAULT_MAX_KEY_RETRIES;
  if (retriesHeader) {
    const val = parseInt(Array.isArray(retriesHeader) ? retriesHeader[0] : retriesHeader, 10);
    if (!isNaN(val)) maxKeyRetries = val;
  }

  let backoffInitialDelayMs = DEFAULT_BACKOFF_DELAY;
  if (delayHeader) {
    const val = parseInt(Array.isArray(delayHeader) ? delayHeader[0] : delayHeader, 10);
    if (!isNaN(val)) backoffInitialDelayMs = val;
  }

  return { routingStrategy, maxKeyRetries, backoffInitialDelayMs };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized. Provide the system key as Bearer token.", "UNAUTHORIZED");
  }

  let body: ChatCompletionRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as ChatCompletionRequest;
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  if (!body.model || !Array.isArray(body.messages)) {
    return sendError(res, 400, "Missing required fields: model, messages.", "BAD_REQUEST");
  }

  try {
    let attemptCount = 0;
    const params = extractRoutingParams(req);
    const result = await routeRequest(body, vaultEntries, {
      timeout: TIMEOUT,
      maxRetries: MAX_RETRIES,
      debug: DEBUG,
      circuitBreaker,
      quotaMap,
      providersFile: PROVIDERS_FILE,
      customProviders,
      routingStrategy: params.routingStrategy,
      maxKeyRetries: params.maxKeyRetries,
      backoffInitialDelayMs: params.backoffInitialDelayMs,
      onAttempt: (event) => {
        attemptCount++;
        addRequestLog({
          model: event.model,
          provider: event.provider,
          status: event.status === "success"
            ? (attemptCount > 1 ? "fallback" : "success")
            : "error",
          latencyMs: event.latencyMs,
          tokens: event.tokens,
        });
      },
    });

    // ─── Streaming ────────────────────────────────────────────────────────────
    if (body.stream && typeof result === "object" && Symbol.asyncIterator in result) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
      });

      const stream = result as AsyncGenerator<import("@durgadas/vaultedge-core").ChatCompletionChunk>;
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ─── Non-streaming ────────────────────────────────────────────────────────
    sendJSON(res, 200, result);
  } catch (err) {
    if (DEBUG) console.error("[vaultedge] Routing error:", err);
    if (
      err instanceof Error &&
      (err.name === "NoProviderError" || (err as any).code === "NO_PROVIDER")
    ) {
      return sendError(res, 400, err.message, (err as any).code);
    }
    if (
      err instanceof Error &&
      (err.name === "AllProvidersFailedError" || (err as any).code === "ALL_PROVIDERS_FAILED")
    ) {
      return sendError(res, 502, err.message, (err as any).code);
    }
    if (
      err instanceof Error &&
      (err.name === "VaultEdgeError" || (err as any).code)
    ) {
      return sendError(res, 500, err.message, (err as any).code);
    }
    return sendError(res, 500, "Internal server error.");
  }
}

async function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Translate Anthropic-native format to OpenAI-compatible and route through the same engine
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }

  let body: import("@durgadas/vaultedge-core").AnthropicRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  // Convert Anthropic → OpenAI format and force provider to Anthropic
  const openAIReq: ChatCompletionRequest = {
    model: body.model,
    messages: [
      ...(body.system ? [{ role: "system" as const, content: body.system }] : []),
      ...body.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
    stream: body.stream,
  };

  // Force route to Anthropic provider
  try {
    const params = extractRoutingParams(req);
    const result = await routeRequest(openAIReq, vaultEntries, {
      timeout: TIMEOUT,
      maxRetries: 1, // Don't fallback on Anthropic-native endpoint
      debug: DEBUG,
      routingRules: [{ provider: "Anthropic", model: body.model }],
      circuitBreaker,
      quotaMap,
      providersFile: PROVIDERS_FILE,
      customProviders,
      maxKeyRetries: params.maxKeyRetries,
      backoffInitialDelayMs: params.backoffInitialDelayMs,
    });
    sendJSON(res, 200, result);
  } catch (err) {
    return sendError(res, 502, (err as Error).message);
  }
}

async function handleModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }

  const providers = customProviders ?? loadProviders(PROVIDERS_FILE);
  const availableProviders = new Set(vaultEntries.map((e) => e.provider));
  const models: { id: string; object: "model"; owned_by: string }[] = [];

  for (const entry of vaultEntries) {
    const pDef = getProviderByName(entry.provider, providers);
    if (!pDef) continue;

    if (pDef.staticModels) {
      for (const m of pDef.staticModels) {
        models.push({ id: m, object: "model", owned_by: entry.provider });
      }
    }
  }

  // De-duplicate
  const seen = new Set<string>();
  const unique = models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  sendJSON(res, 200, {
    object: "list",
    data: unique,
  });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJSON(res, 200, {
    status: "ok",
    vault: vaultEntries.length > 0 ? "loaded" : "empty",
    providers: [...new Set(vaultEntries.map((e) => e.provider))],
    uptime: Math.floor(process.uptime()),
  });
}

function handleStatus(_req: IncomingMessage, res: ServerResponse): void {
  if (!checkAuth(_req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  sendJSON(res, 200, {
    vault: {
      keys: vaultEntries.length,
      providers: [...new Set(vaultEntries.map((e) => e.provider))],
    },
    systemKey: SYSTEM_KEY,
  });
}

async function handleValidateKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }

  let body: { provider: string; key: string };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as { provider: string; key: string };
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  if (!body.provider || !body.key) {
    return sendError(res, 400, "Missing required fields: provider, key.", "BAD_REQUEST");
  }

  try {
    const result = await validateProviderKey(body.provider, body.key);
    sendJSON(res, 200, result);
  } catch (err) {
    return sendError(
      res,
      500,
      `Key validation failed internally: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function handleGetLogs(req: IncomingMessage, res: ServerResponse): void {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  sendJSON(res, 200, requestLogs);
}

function handleGetKeys(req: IncomingMessage, res: ServerResponse): void {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  if (process.env.VAULTEDGE_VAULT) {
    const list = vaultEntries.map((e, idx) => ({
      id: `env-${idx}`,
      provider: e.provider,
      encryptedKey: "",
      maskedKey: e.key.length > 8 ? `${e.key.slice(0, 4)}...${e.key.slice(-4)}` : "****",
      addedAt: Math.floor(Date.now() / 1000),
      isValid: null,
    }));
    return sendJSON(res, 200, list);
  }
  const lv = readLocalVault();
  sendJSON(res, 200, lv.entries);
}

async function handlePostKeys(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  if (process.env.VAULTEDGE_VAULT) {
    return sendError(res, 400, "Vault is read-only when loaded from environment variable.", "READ_ONLY");
  }

  let body: { provider: string; key: string };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as { provider: string; key: string };
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  if (!body.provider || !body.key) {
    return sendError(res, 400, "Missing required fields: provider, key.", "BAD_REQUEST");
  }

  try {
    const secret = getOrCreateSecret();
    const encryptedKey = await encryptLocalKey(body.key, secret);
    const masked = body.key.length > 8 ? `${body.key.slice(0, 4)}...${body.key.slice(-4)}` : "****";

    const entry: StoredKeyEntry = {
      id: randomBytes(16).toString("hex"),
      provider: body.provider,
      encryptedKey,
      maskedKey: masked,
      addedAt: Math.floor(Date.now() / 1000),
      isValid: null,
    };

    const lv = readLocalVault();
    lv.entries.push(entry);
    writeLocalVault(lv);

    await loadVault(); // Reload in-memory cache

    sendJSON(res, 200, { success: true, entry });
  } catch (err) {
    return sendError(res, 500, `Failed to save key: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleDeleteKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  if (process.env.VAULTEDGE_VAULT) {
    return sendError(res, 400, "Vault is read-only when loaded from environment variable.", "READ_ONLY");
  }

  let body: { id: string };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as { id: string };
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  if (!body.id) {
    return sendError(res, 400, "Missing key ID.", "BAD_REQUEST");
  }

  try {
    const lv = readLocalVault();
    const updated = lv.entries.filter((e) => e.id !== body.id);
    if (updated.length === lv.entries.length) {
      return sendError(res, 404, "Key ID not found in vault.", "NOT_FOUND");
    }
    lv.entries = updated;
    writeLocalVault(lv);

    await loadVault(); // Reload in-memory cache

    sendJSON(res, 200, { success: true });
  } catch (err) {
    return sendError(res, 500, `Failed to delete key: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function handleGetRules(req: IncomingMessage, res: ServerResponse): void {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  const lv = readLocalVault();
  sendJSON(res, 200, lv.rules || []);
}

async function handlePostRules(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req)) {
    return sendError(res, 401, "Unauthorized.", "UNAUTHORIZED");
  }
  if (process.env.VAULTEDGE_VAULT) {
    return sendError(res, 400, "Routing rules are read-only in env mode.", "READ_ONLY");
  }

  let body: { rules: RoutingRule[] };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as { rules: RoutingRule[] };
  } catch {
    return sendError(res, 400, "Invalid JSON body.", "BAD_REQUEST");
  }

  if (!Array.isArray(body.rules)) {
    return sendError(res, 400, "Invalid payload. 'rules' must be an array.", "BAD_REQUEST");
  }

  try {
    const lv = readLocalVault();
    lv.rules = body.rules;
    writeLocalVault(lv);
    sendJSON(res, 200, { success: true });
  } catch (err) {
    return sendError(res, 500, `Failed to save routing rules: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "/";

  if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
    return handleChatCompletions(req, res);
  }
  if (req.method === "POST" && url.startsWith("/v1/keys/validate")) {
    return handleValidateKey(req, res);
  }
  if (req.method === "POST" && url.startsWith("/v1/messages")) {
    return handleAnthropicMessages(req, res);
  }
  if (req.method === "GET" && url.startsWith("/v1/models")) {
    return handleModels(req, res);
  }
  if (req.method === "GET" && url === "/health") {
    return handleHealth(req, res);
  }
  if (req.method === "GET" && url === "/status") {
    return handleStatus(req, res);
  }
  if (req.method === "GET" && url === "/v1/logs") {
    return handleGetLogs(req, res);
  }
  if (req.method === "GET" && url === "/v1/keys") {
    return handleGetKeys(req, res);
  }
  if (req.method === "POST" && url === "/v1/keys") {
    return handlePostKeys(req, res);
  }
  if (req.method === "POST" && url === "/v1/keys/delete") {
    return handleDeleteKey(req, res);
  }
  if (req.method === "GET" && url === "/v1/routing/rules") {
    return handleGetRules(req, res);
  }
  if (req.method === "POST" && url === "/v1/routing/rules") {
    return handlePostRules(req, res);
  }

  sendError(res, 404, `Route ${req.method} ${url} not found.`, "NOT_FOUND");
}

// ─── Server Bootstrap ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadVault();

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[vaultedge] Unhandled error:", err);
      if (!res.headersSent) {
        sendError(res, 500, "Internal server error.");
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n🔐 VaultEdge Proxy`);
    console.log(`   Listening: http://${HOST}:${PORT}`);
    console.log(`   System Key: ${SYSTEM_KEY}`);
    console.log(`   Vault keys: ${vaultEntries.length}`);
    console.log(`   Debug: ${DEBUG}\n`);
    console.log(`   Set in your app: OPENAI_BASE_URL=http://${HOST}:${PORT}/v1`);
    console.log(`                    OPENAI_API_KEY=${SYSTEM_KEY}\n`);
    console.log(`   Web Dashboard:   http://localhost:3000/keys?key=${SYSTEM_KEY}\n`);
  });

  process.on("SIGTERM", () => {
    console.log("[vaultedge] Shutting down...");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[vaultedge] Fatal error:", err);
  process.exit(1);
});
