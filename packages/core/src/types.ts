// ─── Provider Types ───────────────────────────────────────────────────────────

/** A single provider definition loaded from providers.yaml */
export interface ProviderDefinition {
  name: string;
  baseUrl: string;
  /** How to authenticate: "bearer" | "x-api-key" | "query" */
  authScheme: "bearer" | "x-api-key" | "query";
  /** Optional URL to fetch available models list */
  modelsUrl?: string;
  /** Model name prefixes that auto-route to this provider */
  modelPrefixes: string[];
  /** Priority order when used as a fallback (lower = higher priority) */
  fallbackOrder: number;
  /** Hardcoded models when modelsUrl is unavailable */
  staticModels?: string[];
  /** Extra static headers to include in every request to this provider */
  headers?: Record<string, string>;
}

// ─── Vault Types ──────────────────────────────────────────────────────────────

/** A decrypted key entry from the vault */
export interface VaultEntry {
  provider: string;
  key: string;
}

/** A stored (encrypted) key entry in the local vault */
export interface StoredKeyEntry {
  id: string;
  provider: string;
  encryptedKey: string;
  maskedKey: string;
  addedAt: number;
  isValid: boolean | null;
}

/** The serialized format of the exported encrypted vault */
export interface VaultExportFormat {
  version: 1;
  /** base64(salt[32] + nonce[12] + ciphertext) */
  data: string;
}

// ─── Chat Completion Types (OpenAI-compatible) ───────────────────────────────

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ResponseFormat {
  type: "text" | "json_object";
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  response_format?: ResponseFormat;
  seed?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: CompletionUsage;
  system_fingerprint?: string;
  /** Internal: which provider actually served this request */
  _ve_provider?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: "system" | "developer" | "user" | "assistant" | "tool";
    content?: string | null;
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// ─── Anthropic-specific types (internal) ─────────────────────────────────────

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface AnthropicContentBlock {
  type: "text";
  text: string;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── SDK / Proxy Configuration ────────────────────────────────────────────────

export interface RoutingRule {
  provider: string;
  model: string;
}

export interface VaultEdgeConfig {
  /**
   * The encrypted vault string (starts with "VE_VAULT_v1_").
   * Also read from VAULTEDGE_VAULT env var.
   */
  vault?: string;

  /**
   * The master password used to encrypt the vault.
   * Also read from VAULTEDGE_PASSWORD env var.
   */
  password?: string;

  /** Request timeout in milliseconds. Default: 60000 */
  timeout?: number;

  /** Max fallback providers to try. Default: 3 */
  maxRetries?: number;

  /**
   * Explicit routing rules. If set, skips auto-routing from model prefixes.
   * Example: [{ provider: "Groq", model: "llama-3.3-70b-versatile" }]
   */
  routingRules?: RoutingRule[];

  /** Enable verbose debug logging to stderr. Default: false */
  debug?: boolean;

  /**
   * Path to a custom providers.yaml file.
   * Default: uses the built-in providers.yaml.
   */
  providersFile?: string;

  /** Pre-parsed provider definitions (avoids dynamic file loading in browser/edge) */
  customProviders?: ProviderDefinition[];

  /**
   * Routing strategy to use.
   * "cheapest": Sort providers/keys by lowest cost and substitute cheap model versions if reasoning is not required.
   * "priority" / "default": Use fallback priority order defined in providers config.
   */
  routingStrategy?: "cheapest" | "priority" | "default";

  /** Max retries on the same provider key before switching to fallback. Default: 2 */
  maxKeyRetries?: number;

  /** Initial delay for exponential backoff retries on the same key in milliseconds. Default: 200 */
  backoffInitialDelayMs?: number;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class VaultEdgeError extends Error {
  public readonly code: string;
  public readonly provider?: string;
  public readonly statusCode?: number;

  constructor(message: string, code: string, provider?: string, statusCode?: number) {
    super(message);
    this.name = "VaultEdgeError";
    this.code = code;
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class VaultDecryptionError extends VaultEdgeError {
  constructor(message: string) {
    super(message, "VAULT_DECRYPTION_ERROR");
    this.name = "VaultDecryptionError";
  }
}

export class ProviderError extends VaultEdgeError {
  constructor(message: string, provider: string, statusCode?: number) {
    super(message, "PROVIDER_ERROR", provider, statusCode);
    this.name = "ProviderError";
  }
}

export class NoProviderError extends VaultEdgeError {
  constructor(model: string) {
    super(
      `No provider found for model "${model}". Make sure your vault has a key for the relevant provider.`,
      "NO_PROVIDER"
    );
    this.name = "NoProviderError";
  }
}

export class AllProvidersFailedError extends VaultEdgeError {
  public readonly errors: ProviderError[];

  constructor(model: string, errors: ProviderError[]) {
    const summary = errors.map((e) => `${e.provider}: ${e.message}`).join("; ");
    super(`All providers failed for model "${model}": ${summary}`, "ALL_PROVIDERS_FAILED");
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}
