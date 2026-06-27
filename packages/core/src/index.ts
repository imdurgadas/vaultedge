// @vaultedge/core — public API

// Types
export type {
  ProviderDefinition,
  VaultEntry,
  StoredKeyEntry,
  VaultExportFormat,
  ChatMessage,
  ToolCall,
  Tool,
  ResponseFormat,
  ChatCompletionRequest,
  ChatCompletionChoice,
  CompletionUsage,
  ChatCompletionResponse,
  ChatCompletionChunkChoice,
  ChatCompletionChunk,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicContentBlock,
  AnthropicResponse,
  RoutingRule,
  VaultEdgeConfig,
} from "./types.js";

// Errors
export {
  VaultEdgeError,
  VaultDecryptionError,
  ProviderError,
  NoProviderError,
  AllProvidersFailedError,
} from "./types.js";

// Vault crypto
export {
  VAULT_PREFIX,
  encryptVault,
  decryptVault,
  encryptLocalKey,
  decryptLocalKey,
  createStoredKeyEntry,
} from "./vault.js";

// Provider registry
export {
  loadProviders,
  resolveProviderForModel,
  getProviderByName,
  buildAuthHeader,
  buildProviderHeaders,
  clearProviderCache,
  validateProviderKey,
} from "./providers.js";

// Quota & circuit breaker
export {
  CircuitBreaker,
  QuotaMap,
  extractQuotaHeaders,
  globalCircuitBreaker,
  globalQuotaMap,
} from "./quota.js";
export type { CircuitState, QuotaState } from "./quota.js";

// Router
export { routeRequest, resolveProviderForModel as resolveModel } from "./router.js";
export type { RouterConfig } from "./router.js";
