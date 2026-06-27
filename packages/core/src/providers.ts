/**
 * VaultEdge Provider Registry
 *
 * Provides provider definitions. By default, uses the built-in compiler-friendly
 * registry list to avoid Node.js fs dependencies on browser/edge environments.
 * Optional Node.js file loading is supported if a custom filePath is passed.
 *
 * This is the single source of truth for all provider metadata —
 * routing, URL endpoints, auth schemes, and model prefix mappings.
 */

import type { ProviderDefinition } from "./types.js";

// ─── Default Registry List (Inlined for Browser/Edge Compatibility) ──────────

export const DEFAULT_PROVIDERS: ProviderDefinition[] = [
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.openai.com/v1/models",
    modelPrefixes: ["gpt-", "o1", "o3", "o4", "davinci", "text-"],
    fallbackOrder: 1
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    modelPrefixes: ["llama", "groq", "mixtral", "gemma", "whisper"],
    fallbackOrder: 2
  },
  {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    authScheme: "x-api-key",
    modelPrefixes: ["claude"],
    fallbackOrder: 3,
    staticModels: [
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
      "claude-3-haiku-20240307"
    ],
    headers: {
      "anthropic-version": "2023-06-01"
    }
  },
  {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    modelPrefixes: ["gemini"],
    fallbackOrder: 4
  },
  {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.mistral.ai/v1/models",
    modelPrefixes: ["mistral", "codestral", "pixtral"],
    fallbackOrder: 5
  },
  {
    name: "xAI",
    baseUrl: "https://api.x.ai/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.x.ai/v1/models",
    modelPrefixes: ["grok"],
    fallbackOrder: 6
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.deepseek.com/models",
    modelPrefixes: ["deepseek"],
    fallbackOrder: 7
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    modelPrefixes: [],
    fallbackOrder: 8,
    headers: {
      "HTTP-Referer": "https://vaultedge.dev",
      "X-Title": "VaultEdge"
    }
  },
  {
    name: "Cohere",
    baseUrl: "https://api.cohere.ai/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.cohere.ai/v1/models",
    modelPrefixes: ["command", "cohere"],
    fallbackOrder: 9
  },
  {
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    authScheme: "bearer",
    modelPrefixes: ["cerebras"],
    fallbackOrder: 10,
    staticModels: [
      "llama3.1-8b",
      "llama-3.3-70b"
    ]
  },
  {
    name: "Sambanova",
    baseUrl: "https://api.sambanova.ai/v1/chat/completions",
    authScheme: "bearer",
    modelPrefixes: ["meta-llama", "sambanova", "qwen", "deepseek-r1-distill"],
    fallbackOrder: 11,
    staticModels: [
      "Meta-Llama-3.1-8B-Instruct",
      "Meta-Llama-3.1-70B-Instruct",
      "Meta-Llama-3.3-70B-Instruct",
      "Qwen2.5-72B-Instruct",
      "DeepSeek-R1-Distill-Llama-70B"
    ]
  },
  {
    name: "Cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/default/ai/v1/chat/completions",
    authScheme: "bearer",
    modelPrefixes: ["@cf/"],
    fallbackOrder: 12,
    staticModels: [
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/qwen/qwen1.5-14b-chat-awq"
    ]
  },
  {
    name: "Github",
    baseUrl: "https://models.inference.ai.azure.com/chat/completions",
    authScheme: "bearer",
    modelPrefixes: [],
    fallbackOrder: 13,
    staticModels: [
      "gpt-4o",
      "gpt-4o-mini",
      "Phi-3.5-mini-instruct",
      "Llama-3.3-70B-Instruct"
    ]
  },
  {
    name: "Nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    modelPrefixes: ["nvidia", "nim", "nv-"],
    fallbackOrder: 14
  },
  {
    name: "Together",
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    authScheme: "bearer",
    modelsUrl: "https://api.together.xyz/v1/models",
    modelPrefixes: ["together"],
    fallbackOrder: 15
  },
  {
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai/chat/completions",
    authScheme: "bearer",
    modelPrefixes: ["sonar", "pplx-"],
    fallbackOrder: 16,
    staticModels: [
      "sonar",
      "sonar-pro",
      "sonar-reasoning"
    ]
  }
];

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: ProviderDefinition[] | null = null;
let _cacheFile: string | null = null;

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load and cache provider definitions.
 * If filePath is provided, dynamically resolves fs/path on Node.js to load custom config.
 */
export function loadProviders(filePath?: string): ProviderDefinition[] {
  if (!filePath) {
    if (!_cache || _cacheFile !== "default") {
      _cache = [...DEFAULT_PROVIDERS].sort((a, b) => a.fallbackOrder - b.fallbackOrder);
      _cacheFile = "default";
    }
    return _cache;
  }

  if (_cache && _cacheFile === filePath) return _cache;

  let fsModule: any;
  let yamlModule: any;

  try {
    // Avoid compile-time static imports of node:fs / js-yaml
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = typeof require !== "undefined" ? require : eval("require");
    fsModule = req("node:fs");
    yamlModule = req("js-yaml");
  } catch (err) {
    throw new Error(
      `Custom providers path "${filePath}" requires a Node.js environment with "js-yaml" dependency installed.`
    );
  }

  const raw = fsModule.readFileSync(filePath, "utf-8");
  const parsed = yamlModule.load(raw) as { providers: ProviderDefinition[] };

  if (!parsed?.providers || !Array.isArray(parsed.providers)) {
    throw new Error(`Config file at "${filePath}" must have a top-level "providers" array.`);
  }

  _cache = [...parsed.providers].sort((a, b) => a.fallbackOrder - b.fallbackOrder);
  _cacheFile = filePath;
  return _cache;
}

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

/**
 * Find the primary provider for a given model name using prefix matching.
 * Returns the provider definition or null if unrecognized.
 */
export function resolveProviderForModel(
  model: string,
  providers?: ProviderDefinition[]
): ProviderDefinition | null {
  const list = providers ?? loadProviders();
  const lowerModel = model.toLowerCase();

  for (const p of list) {
    for (const prefix of p.modelPrefixes) {
      if (lowerModel.startsWith(prefix.toLowerCase())) {
        return p;
      }
    }
  }
  return null;
}

/**
 * Find a provider definition by name (case-insensitive).
 */
export function getProviderByName(
  name: string,
  providers?: ProviderDefinition[]
): ProviderDefinition | undefined {
  const list = providers ?? loadProviders();
  return list.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Build the Authorization header value for a given provider and API key.
 */
export function buildAuthHeader(
  provider: ProviderDefinition,
  apiKey: string
): Record<string, string> {
  switch (provider.authScheme) {
    case "bearer":
      return { Authorization: `Bearer ${apiKey}` };
    case "x-api-key":
      return { "x-api-key": apiKey };
    case "query":
      return {}; // Handled separately in request builders
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}

/**
 * Build all necessary request headers including auth, content type, and static headers.
 */
export function buildProviderHeaders(
  provider: ProviderDefinition,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeader(provider, apiKey),
  };

  if (provider.headers) {
    Object.assign(headers, provider.headers);
  }

  return headers;
}

export function clearProviderCache(): void {
  _cache = null;
  _cacheFile = null;
}

/**
 * Perform a real lightweight validation request to the provider's API.
 * Returns { valid: boolean, message?: string }
 */
export async function validateProviderKey(
  providerName: string,
  apiKey: string,
  customProviders?: ProviderDefinition[]
): Promise<{ valid: boolean; message?: string }> {
  const p = getProviderByName(providerName, customProviders);
  if (!p) {
    return { valid: false, message: `Unknown provider: ${providerName}` };
  }

  // Determine validation URL and payload
  let url = p.modelsUrl;
  let method = "GET";
  let body: string | undefined = undefined;

  const headers = buildProviderHeaders(p, apiKey);

  if (!url) {
    // If no modelsUrl, perform a minimal chat completion request
    url = p.baseUrl;
    method = "POST";
    if (p.name === "Anthropic") {
      body = JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    } else {
      body = JSON.stringify({
        model: p.staticModels?.[0] || "gpt-4o-mini",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    }
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
    });

    if (res.status === 200) {
      return { valid: true };
    }

    // Anthropic or some providers might return 400 for bad parameters, which still means the key is valid (since they authenticated it)
    if (res.status === 400 && p.name === "Anthropic") {
      const text = await res.text();
      if (text.includes("api_key") || text.includes("authentication")) {
        return { valid: false, message: `API returned status ${res.status}: ${text}` };
      }
      return { valid: true };
    }

    const text = await res.text();
    let errMessage = text;
    try {
      const json = JSON.parse(text);
      errMessage = json.error?.message || json.message || text;
    } catch {}

    return {
      valid: false,
      message: `Auth failed (status ${res.status}): ${errMessage.slice(0, 150)}`,
    };
  } catch (err) {
    return {
      valid: false,
      message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

