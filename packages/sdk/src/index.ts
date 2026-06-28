/**
 * VaultEdge SDK
 *
 * OpenAI-compatible client that routes requests through your encrypted vault.
 *
 * @example
 * ```ts
 * import { VaultEdge } from "vaultedge-sdk";
 *
 * const ve = new VaultEdge({
 *   vault: process.env.VAULTEDGE_VAULT,
 *   password: process.env.VAULTEDGE_PASSWORD,
 * });
 *
 * // Non-streaming
 * const response = await ve.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * console.log(response.choices[0].message.content);
 *
 * // Streaming
 * const stream = await ve.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "Hello!" }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 * }
 * ```
 */

import {
  decryptVault,
  routeRequest,
  resolveProviderForModel,
  VaultEdgeError,
} from "@durgadas/vaultedge-core";

import type {
  VaultEdgeConfig,
  VaultEntry,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  RoutingRule,
} from "@durgadas/vaultedge-core";

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  VaultEdgeConfig,
  VaultEntry,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  RoutingRule,
} from "@durgadas/vaultedge-core";

export {
  VaultEdgeError,
  VaultDecryptionError,
  ProviderError,
  NoProviderError,
  AllProvidersFailedError,
  decryptVault,
  encryptVault,
} from "@durgadas/vaultedge-core";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_RETRIES = 3;

// ─── Completions Namespace ─────────────────────────────────────────────────────

class Completions {
  constructor(
    private readonly getEntries: () => Promise<VaultEntry[]>,
    private readonly timeout: number,
    private readonly maxRetries: number,
    private readonly debug: boolean,
    private readonly routingRules?: RoutingRule[],
    private readonly providersFile?: string
  ) {}

  /**
   * Create a chat completion.
   * Pass `stream: true` to get an async generator of chunks.
   */
  async create(
    request: ChatCompletionRequest & { stream: true }
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>>;
  async create(
    request: ChatCompletionRequest & { stream?: false | undefined }
  ): Promise<ChatCompletionResponse>;
  async create(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const entries = await this.getEntries();

    if (this.debug) {
      const providers = [...new Set(entries.map((e) => e.provider))];
      console.error(
        `[vaultedge] Vault loaded: ${entries.length} keys [${providers.join(", ")}]`
      );
      const primary = resolveProviderForModel(request.model);
      console.error(
        `[vaultedge] Model "${request.model}" → primary: ${primary?.name ?? "unknown"}`
      );
    }

    return routeRequest(request, entries, {
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      debug: this.debug,
      routingRules: this.routingRules,
      providersFile: this.providersFile,
    });
  }
}

class Chat {
  public readonly completions: Completions;

  constructor(
    getEntries: () => Promise<VaultEntry[]>,
    timeout: number,
    maxRetries: number,
    debug: boolean,
    routingRules?: RoutingRule[],
    providersFile?: string
  ) {
    this.completions = new Completions(
      getEntries,
      timeout,
      maxRetries,
      debug,
      routingRules,
      providersFile
    );
  }
}

// ─── VaultEdge Client ─────────────────────────────────────────────────────────

/**
 * The main VaultEdge SDK client.
 *
 * Mirrors the OpenAI SDK's `chat.completions.create()` interface.
 * Keys are decrypted lazily on first use and cached for the lifetime of the client.
 */
export class VaultEdge {
  public readonly chat: Chat;

  private readonly vaultString: string;
  private readonly password: string;
  private readonly debug: boolean;
  private cachedEntries: Promise<VaultEntry[]> | null = null;

  constructor(config: VaultEdgeConfig = {}) {
    const vault = config.vault ?? process.env.VAULTEDGE_VAULT;
    const password = config.password ?? process.env.VAULTEDGE_PASSWORD;

    if (!vault) {
      throw new VaultEdgeError(
        "No vault provided. Pass `vault` in config or set VAULTEDGE_VAULT env var.",
        "MISSING_VAULT"
      );
    }
    if (!password) {
      throw new VaultEdgeError(
        "No password provided. Pass `password` in config or set VAULTEDGE_PASSWORD env var.",
        "MISSING_PASSWORD"
      );
    }

    this.vaultString = vault;
    this.password = password;
    this.debug = config.debug ?? false;

    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

    this.chat = new Chat(
      () => this.getEntries(),
      timeout,
      maxRetries,
      this.debug,
      config.routingRules,
      config.providersFile
    );
  }

  /** Lazily decrypt vault on first access; cache result. */
  private async getEntries(): Promise<VaultEntry[]> {
    if (this.cachedEntries === null) {
      if (this.debug) console.error("[vaultedge] Decrypting vault...");
      this.cachedEntries = decryptVault(this.vaultString, this.password).then((entries) => {
        if (this.debug) console.error(`[vaultedge] Vault decrypted: ${entries.length} entries`);
        return entries;
      });
    }
    return this.cachedEntries;
  }

  /** List all providers available in this vault. */
  async getProviders(): Promise<string[]> {
    const entries = await this.getEntries();
    return [...new Set(entries.map((e) => e.provider))];
  }

  /** Check if the vault contains a key for a given provider. */
  async hasProvider(provider: string): Promise<boolean> {
    const entries = await this.getEntries();
    return entries.some((e) => e.provider === provider);
  }

  /** Resolve which provider will handle a given model name. */
  resolveModel(model: string): string | null {
    return resolveProviderForModel(model)?.name ?? null;
  }
}

export default VaultEdge;
