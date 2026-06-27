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

function getProxyHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const key = localStorage.getItem("ve_proxy_key") || "";
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
}

function getProxyHost(): string {
  if (typeof window === "undefined") return "http://localhost:8787";
  return localStorage.getItem("ve_proxy_host") || "http://localhost:8787";
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

export async function getKeys(): Promise<StoredKey[]> {
  try {
    const res = await fetch(`${getProxyHost()}/v1/keys`, {
      headers: getProxyHeaders(),
    });
    if (res.ok) {
      return await res.json() as StoredKey[];
    }
  } catch {}
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEYS_KEY) ?? "[]"); } catch { return []; }
}

export function saveKeys(keys: StoredKey[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
}

export async function addKey(provider: string, rawKey: string): Promise<StoredKey> {
  try {
    const res = await fetch(`${getProxyHost()}/v1/keys`, {
      method: "POST",
      headers: getProxyHeaders(),
      body: JSON.stringify({ provider, key: rawKey }),
    });
    if (res.ok) {
      const data = await res.json() as { entry: StoredKey };
      return data.entry;
    }
  } catch {}

  // Fallback to local storage
  const masked = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : "****";
  const entry: StoredKey = {
    id: crypto.randomUUID(),
    provider,
    key: rawKey,
    maskedKey: masked,
    addedAt: Math.floor(Date.now() / 1000),
    isValid: null,
  };
  const current = await getKeys();
  saveKeys([...current, entry]);
  return entry;
}

export async function removeKey(id: string): Promise<void> {
  try {
    const res = await fetch(`${getProxyHost()}/v1/keys/delete`, {
      method: "POST",
      headers: getProxyHeaders(),
      body: JSON.stringify({ id }),
    });
    if (res.ok) return;
  } catch {}

  // Fallback
  const current = await getKeys();
  saveKeys(current.filter((k) => k.id !== id));
}

export async function setKeyValid(id: string, valid: boolean): Promise<void> {
  // Key validation status updates can be saved locally in browser
  const current = await getKeys();
  saveKeys(current.map((k) => k.id === id ? { ...k, isValid: valid } : k));
}

export async function importVaultKeys(entries: { provider: string; key: string }[]): Promise<void> {
  for (const entry of entries) {
    await addKey(entry.provider, entry.key);
  }
}

// ─── Routing Rules ────────────────────────────────────────────────────────────

export async function getRules(): Promise<RoutingRule[]> {
  try {
    const res = await fetch(`${getProxyHost()}/v1/routing/rules`, {
      headers: getProxyHeaders(),
    });
    if (res.ok) {
      return await res.json() as RoutingRule[];
    }
  } catch {}
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RULES_KEY) ?? "[]"); } catch { return []; }
}

export async function saveRules(rules: RoutingRule[]): Promise<void> {
  try {
    const res = await fetch(`${getProxyHost()}/v1/routing/rules`, {
      method: "POST",
      headers: getProxyHeaders(),
      body: JSON.stringify({ rules }),
    });
    if (res.ok) return;
  } catch {}
  if (typeof window === "undefined") return;
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export async function addRule(provider: string, model: string): Promise<RoutingRule> {
  const rules = await getRules();
  const rule: RoutingRule = {
    id: crypto.randomUUID(),
    provider,
    model,
    priority: rules.length + 1,
  };
  await saveRules([...rules, rule]);
  return rule;
}

export async function removeRule(id: string): Promise<void> {
  const rules = await getRules();
  const updated = rules
    .filter((r) => r.id !== id)
    .map((r, i) => ({ ...r, priority: i + 1 }));
  await saveRules(updated);
}

export async function moveRule(id: string, direction: "up" | "down"): Promise<void> {
  const rules = await getRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const newIdx = direction === "up" ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= rules.length) return;
  const updated = [...rules];
  [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
  await saveRules(updated.map((r, i) => ({ ...r, priority: i + 1 })));
}
