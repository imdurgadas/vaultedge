/**
 * Client-side vault store — persists to localStorage.
 * In production this would talk to the proxy /status API.
 */

export interface StoredKey {
  id: string;
  provider: string;
  key: string;
  maskedKey: string;
  addedAt: number;
  isValid: boolean | null;
}

export interface RoutingRule {
  id: string;
  provider: string;
  model: string;
  priority: number;
}

export interface RoutingLog {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  status: "success" | "error" | "fallback";
  latencyMs: number;
  tokens?: number;
}

const KEYS_KEY = "ve_keys";
const RULES_KEY = "ve_routing_rules";
const LOGS_KEY = "ve_logs";

// ─── Keys ─────────────────────────────────────────────────────────────────────

export function getKeys(): StoredKey[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEYS_KEY) ?? "[]"); } catch { return []; }
}

export function saveKeys(keys: StoredKey[]): void {
  localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
}

export function addKey(provider: string, rawKey: string): StoredKey {
  const masked = rawKey.length > 8
    ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}`
    : "****";
  const entry: StoredKey = {
    id: crypto.randomUUID(),
    provider,
    key: rawKey,
    maskedKey: masked,
    addedAt: Math.floor(Date.now() / 1000),
    isValid: null,
  };
  saveKeys([...getKeys(), entry]);
  return entry;
}

export function removeKey(id: string): void {
  saveKeys(getKeys().filter((k) => k.id !== id));
}

export function setKeyValid(id: string, valid: boolean): void {
  saveKeys(getKeys().map((k) => k.id === id ? { ...k, isValid: valid } : k));
}

export function importVaultKeys(entries: { provider: string; key: string }[]): void {
  const current = getKeys();
  const added: StoredKey[] = entries.map((entry) => {
    const rawKey = entry.key;
    const masked = rawKey.length > 8
      ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}`
      : "****";
    return {
      id: crypto.randomUUID(),
      provider: entry.provider,
      key: rawKey,
      maskedKey: masked,
      addedAt: Math.floor(Date.now() / 1000),
      isValid: null,
    };
  });
  saveKeys([...current, ...added]);
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export function getRules(): RoutingRule[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RULES_KEY) ?? "[]"); } catch { return []; }
}

export function saveRules(rules: RoutingRule[]): void {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function addRule(provider: string, model: string): RoutingRule {
  const rules = getRules();
  const rule: RoutingRule = {
    id: crypto.randomUUID(),
    provider,
    model,
    priority: rules.length + 1,
  };
  saveRules([...rules, rule]);
  return rule;
}

export function removeRule(id: string): void {
  const updated = getRules()
    .filter((r) => r.id !== id)
    .map((r, i) => ({ ...r, priority: i + 1 }));
  saveRules(updated);
}

export function moveRule(id: string, direction: "up" | "down"): void {
  const rules = getRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const newIdx = direction === "up" ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= rules.length) return;
  const updated = [...rules];
  [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
  saveRules(updated.map((r, i) => ({ ...r, priority: i + 1 })));
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export function getLogs(): RoutingLog[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LOGS_KEY) ?? "[]"); } catch { return []; }
}

export function clearLogs(): void {
  localStorage.removeItem(LOGS_KEY);
}

// Seed demo logs if empty
export function seedDemoLogs(): void {
  if (getLogs().length > 0) return;
  const providers = ["OpenAI", "Groq", "Anthropic", "Gemini", "Mistral"];
  const models = ["gpt-4o", "llama-3.3-70b-versatile", "claude-3-5-sonnet-latest", "gemini-1.5-pro", "mistral-large"];
  const statuses: RoutingLog["status"][] = ["success", "success", "success", "fallback", "error"];
  const logs: RoutingLog[] = Array.from({ length: 18 }, (_, i) => ({
    id: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000) - i * 240,
    model: models[i % models.length],
    provider: providers[i % providers.length],
    status: statuses[i % statuses.length],
    latencyMs: 300 + Math.floor(Math.random() * 2200),
    tokens: 150 + Math.floor(Math.random() * 1800),
  }));
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
}
