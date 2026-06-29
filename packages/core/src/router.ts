/**
 * VaultEdge Smart Router
 *
 * Routes chat completion requests to the right provider based on:
 *  1. Explicit routing rules (user-defined)
 *  2. Model prefix auto-detection via providers.yaml
 *  3. Fallback chain when the primary provider fails
 *
 * Features:
 *  - Anthropic format translation (OpenAI ↔ Anthropic messages API)
 *  - Real SSE streaming for all OpenAI-compatible providers
 *  - Real SSE streaming for Anthropic
 *  - Per-key circuit breaking and quota-aware key ordering
 */

import type {
  VaultEntry,
  RoutingRule,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicMessage,
  ProviderDefinition,
  ChatMessage,
} from "./types.js";
import { ProviderError, NoProviderError, AllProvidersFailedError, VaultEdgeError } from "./types.js";
import {
  CircuitBreaker,
  QuotaMap,
  extractQuotaHeaders,
  globalCircuitBreaker,
  globalQuotaMap,
} from "./quota.js";
import { loadProviders, resolveProviderForModel, buildProviderHeaders } from "./providers.js";

// ─── Router Config ────────────────────────────────────────────────────────────

export interface RouterConfig {
  timeout: number;
  maxRetries: number;
  debug: boolean;
  routingRules?: RoutingRule[];
  providersFile?: string;
  customProviders?: ProviderDefinition[];
  circuitBreaker?: CircuitBreaker;
  quotaMap?: QuotaMap;
  routingStrategy?: "cheapest" | "priority" | "default";
  maxKeyRetries?: number;
  backoffInitialDelayMs?: number;
  onAttempt?: (event: {
    provider: string;
    model: string;
    status: "success" | "error";
    latencyMs: number;
    tokens?: number;
    error?: string;
  }) => void;
}

// ─── Anthropic Format Translation ─────────────────────────────────────────────

function toAnthropicRequest(req: ChatCompletionRequest): AnthropicRequest {
  let systemPrompt: string | undefined;
  const messages: AnthropicMessage[] = [];

  for (const msg of req.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemPrompt = (systemPrompt ? systemPrompt + "\n" : "") + (msg.content ?? "");
    } else if (msg.role === "user" || msg.role === "assistant") {
      messages.push({ role: msg.role, content: msg.content ?? "" });
    }
  }

  const anthropicReq: AnthropicRequest = {
    model: req.model,
    max_tokens: req.max_tokens ?? 4096,
    messages,
    stream: req.stream,
  };

  if (systemPrompt) anthropicReq.system = systemPrompt;
  if (req.temperature !== undefined) anthropicReq.temperature = req.temperature;
  if (req.top_p !== undefined) anthropicReq.top_p = req.top_p;
  if (req.stop) {
    anthropicReq.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }

  return anthropicReq;
}

function fromAnthropicResponse(resp: AnthropicResponse): ChatCompletionResponse {
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const finishReason: "stop" | "length" = resp.stop_reason === "max_tokens" ? "length" : "stop";

  return {
    id: resp.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: resp.usage.input_tokens,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  };
}

// ─── Anthropic SSE Parser ─────────────────────────────────────────────────────

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
  requestId: string
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentModel = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);

        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const evt = JSON.parse(data);
              if (evt.type === "message_start") {
                currentModel = evt.message?.model ?? "";
              } else if (evt.type === "content_block_delta" && evt.delta?.text) {
                yield {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: currentModel,
                  choices: [
                    {
                      index: 0,
                      delta: { content: evt.delta.text },
                      finish_reason: null,
                    },
                  ],
                };
              } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
                yield {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: currentModel,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: evt.delta.stop_reason === "max_tokens" ? "length" : "stop",
                    },
                  ],
                };
              }
            } catch {
              // Ignore unparseable SSE events
            }
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── OpenAI-compatible SSE Parser ────────────────────────────────────────────

async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunkText = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);

        if (chunkText.startsWith("data: ")) {
          const data = chunkText.slice(6);
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as ChatCompletionChunk;
          } catch {
            // Ignore
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Single Provider Request ──────────────────────────────────────────────────

async function sendToProvider(
  provider: ProviderDefinition,
  apiKey: string,
  request: ChatCompletionRequest,
  model: string,
  opts: { timeout: number; debug: boolean; quotaMap: QuotaMap }
): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> {
  const isStream = request.stream === true;
  const isAnthropic = provider.name === "Anthropic";

  if (opts.debug) {
    console.error(`[vaultedge] → ${provider.name} (model: ${model}, stream: ${isStream})`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

  let response: Response;
  try {
    const headers = buildProviderHeaders(provider, apiKey);
    const body = isAnthropic
      ? JSON.stringify(toAnthropicRequest({ ...request, model }))
      : JSON.stringify({ ...request, model, stream: isStream });

    response = await fetch(provider.baseUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new ProviderError(
      `Request to ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      provider.name
    );
  }

  clearTimeout(timeoutId);

  // Update quota state from response headers
  extractQuotaHeaders(response.headers, provider.name, apiKey, opts.quotaMap);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ProviderError(
      `${provider.name} returned ${response.status}: ${body}`,
      provider.name,
      response.status
    );
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────
  if (isStream) {
    if (!response.body) {
      throw new ProviderError(`${provider.name} returned no stream body`, provider.name);
    }
    if (isAnthropic) {
      return parseAnthropicStream(response.body, `ve-${Date.now()}`);
    }
    return parseOpenAIStream(response.body);
  }

  // ─── Non-streaming ──────────────────────────────────────────────────────────
  if (isAnthropic) {
    const anthropicResp = (await response.json()) as AnthropicResponse;
    const result = fromAnthropicResponse(anthropicResp);
    result._ve_provider = provider.name;
    return result;
  }

  const result = (await response.json()) as ChatCompletionResponse;
  result._ve_provider = provider.name;
  return result;
}

// ─── Smart Router Helpers ──────────────────────────────────────────────────────

export interface CostEntry {
  cheapCost: number;
  premiumCost: number;
  cheapModel: string;
  premiumModel: string;
}

export const PROVIDER_COSTS: Record<string, CostEntry> = {
  OpenAI: { cheapCost: 0.30, premiumCost: 10.00, cheapModel: "gpt-4o-mini", premiumModel: "gpt-4o" },
  Anthropic: { cheapCost: 1.00, premiumCost: 15.00, cheapModel: "claude-3-5-haiku-latest", premiumModel: "claude-3-5-sonnet-latest" },
  Gemini: { cheapCost: 0.25, premiumCost: 5.00, cheapModel: "gemini-2.5-flash", premiumModel: "gemini-2.5-pro" },
  DeepSeek: { cheapCost: 0.20, premiumCost: 2.19, cheapModel: "deepseek-chat", premiumModel: "deepseek-reasoner" },
  Groq: { cheapCost: 0.10, premiumCost: 0.10, cheapModel: "llama-3.1-8b-instant", premiumModel: "llama-3.3-70b-versatile" },
  Mistral: { cheapCost: 0.50, premiumCost: 6.00, cheapModel: "mistral-large-latest", premiumModel: "mistral-large-latest" },
  xAI: { cheapCost: 2.00, premiumCost: 10.00, cheapModel: "grok-2-beta", premiumModel: "grok-2-beta" },
  Cohere: { cheapCost: 1.00, premiumCost: 5.00, cheapModel: "command", premiumModel: "command" },
  Cerebras: { cheapCost: 0.10, premiumCost: 0.10, cheapModel: "llama3.1-8b", premiumModel: "llama-3.3-70b" },
  Sambanova: { cheapCost: 0.15, premiumCost: 0.30, cheapModel: "Meta-Llama-3.1-8B-Instruct", premiumModel: "Meta-Llama-3.3-70B-Instruct" },
  Cloudflare: { cheapCost: 0.25, premiumCost: 1.00, cheapModel: "@cf/meta/llama-3.1-8b-instruct", premiumModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  Github: { cheapCost: 0.0, premiumCost: 0.0, cheapModel: "gpt-4o-mini", premiumModel: "gpt-4o" },
  Nvidia: { cheapCost: 0.20, premiumCost: 1.00, cheapModel: "nvidia", premiumModel: "nvidia" },
  Together: { cheapCost: 0.30, premiumCost: 1.00, cheapModel: "together", premiumModel: "together" },
  Perplexity: { cheapCost: 1.00, premiumCost: 5.00, cheapModel: "sonar", premiumModel: "sonar-reasoning" },
};

export function isReasoningRequired(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (!m.content) continue;
    const contentLower = m.content.toLowerCase();
    if (
      contentLower.includes("<think>") ||
      contentLower.includes("<thought>") ||
      contentLower.includes("<reasoning>") ||
      contentLower.includes("reason step-by-step") ||
      contentLower.includes("chain of thought") ||
      contentLower.includes("explain your thinking")
    ) {
      return true;
    }
  }
  return false;
}

async function sendToProviderWithRetry(
  provider: ProviderDefinition,
  apiKey: string,
  request: ChatCompletionRequest,
  model: string,
  opts: {
    timeout: number;
    debug: boolean;
    quotaMap: QuotaMap;
    maxKeyRetries: number;
    backoffInitialDelayMs: number;
  }
): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> {
  let attempt = 0;
  const maxAttempts = opts.maxKeyRetries > 0 ? opts.maxKeyRetries : 1;

  while (true) {
    try {
      return await sendToProvider(provider, apiKey, request, model, opts);
    } catch (err) {
      attempt++;
      const isRetriable =
        (err instanceof ProviderError && (
          err.statusCode === 429 ||
          (err.statusCode && err.statusCode >= 500) ||
          err.message.includes("failed") ||
          err.message.includes("timeout") ||
          err.message.includes("abort") ||
          err.message.includes("fetch")
        )) ||
        !(err instanceof ProviderError);

      if (attempt >= maxAttempts || !isRetriable) {
        throw err;
      }

      const delay = opts.backoffInitialDelayMs * Math.pow(2, attempt - 1);
      if (opts.debug) {
        console.error(
          `[vaultedge] Retry ${attempt}/${maxAttempts - 1} for ${provider.name} in ${delay}ms after error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function* createRobustStream(
  request: ChatCompletionRequest,
  attempts: { provider: ProviderDefinition; model: string; key: string }[],
  maxAttempts: number,
  config: RouterConfig,
  errors: ProviderError[]
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const cb = config.circuitBreaker ?? globalCircuitBreaker;
  const qm = config.quotaMap ?? globalQuotaMap;
  const maxKeyRetries = config.maxKeyRetries ?? 2;
  const backoffInitialDelayMs = config.backoffInitialDelayMs ?? 200;

  let currentRequest = { ...request };
  let accumulatedText = "";
  let attemptIdx = 0;
  let firstChunkId: string | undefined;
  let firstChunkModel: string | undefined;

  while (attemptIdx < maxAttempts) {
    const { provider, model, key } = attempts[attemptIdx];
    const startTime = Date.now();

    try {
      // If we are resuming mid-stream, modify the messages of the current request
      if (accumulatedText.length > 0) {
        const updatedMessages = [...request.messages];
        updatedMessages.push({
          role: "assistant",
          content: accumulatedText,
        });
        currentRequest.messages = updatedMessages;
        if (config.debug) {
          console.error(
            `[vaultedge] Resuming stream mid-generation using ${provider.name} (${model})`
          );
        }
      }

      const result = await sendToProviderWithRetry(provider, key, currentRequest, model, {
        timeout: config.timeout,
        debug: config.debug,
        quotaMap: qm,
        maxKeyRetries,
        backoffInitialDelayMs,
      });

      cb.recordSuccess(key);

      const latencyMs = Date.now() - startTime;
      config.onAttempt?.({
        provider: provider.name,
        model,
        status: "success",
        latencyMs,
      });

      const stream = result as AsyncGenerator<ChatCompletionChunk, void, unknown>;

      try {
        let hasFinished = false;
        for await (const chunk of stream) {
          if (!firstChunkId && chunk.id) firstChunkId = chunk.id;
          if (!firstChunkModel && chunk.model) firstChunkModel = chunk.model;

          const choice = chunk.choices?.[0];
          const deltaContent = choice?.delta?.content;
          if (deltaContent) {
            accumulatedText += deltaContent;
          }

          if (choice && choice.finish_reason !== null && choice.finish_reason !== undefined) {
            hasFinished = true;
          }

          if (firstChunkId) chunk.id = firstChunkId;
          if (firstChunkModel) chunk.model = firstChunkModel;

          yield chunk;
        }
        if (!hasFinished) {
          throw new ProviderError("Stream ended prematurely without finish reason", provider.name);
        }
        return;
      } catch (streamError) {
        const latencyMs = Date.now() - startTime;
        const provErr =
          streamError instanceof ProviderError
            ? streamError
            : new ProviderError(
                `Stream failed midway: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
                provider.name
              );
        errors.push(provErr);
        cb.recordFailure(key, provErr.statusCode === 401);

        config.onAttempt?.({
          provider: provider.name,
          model,
          status: "error",
          latencyMs,
          error: provErr.message,
        });

        if (config.debug) {
          console.error(
            `[vaultedge] ✗ Stream from ${provider.name} failed midway after generating ${accumulatedText.length} chars. Error: ${provErr.message}`
          );
        }

        attemptIdx++;
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const provErr =
        err instanceof ProviderError
          ? err
          : new ProviderError(
              err instanceof Error ? err.message : String(err),
              provider.name
            );
      errors.push(provErr);
      cb.recordFailure(key, provErr.statusCode === 401);

      config.onAttempt?.({
        provider: provider.name,
        model,
        status: "error",
        latencyMs,
        error: provErr.message,
      });

      if (config.debug) {
        console.error(
          `[vaultedge] ✗ Connection to ${provider.name} failed: ${provErr.message}`
        );
      }

      attemptIdx++;
    }
  }

  throw new AllProvidersFailedError(request.model, errors);
}

// ─── Smart Router ─────────────────────────────────────────────────────────────

/**
 * Route a chat completion request through available vault entries.
 * Handles fallback, circuit breaking, and quota-aware key selection.
 */
export async function routeRequest(
  request: ChatCompletionRequest,
  vaultEntries: VaultEntry[],
  config: RouterConfig
): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> {
  const providers = config.customProviders ?? loadProviders(config.providersFile);
  const cb = config.circuitBreaker ?? globalCircuitBreaker;
  const qm = config.quotaMap ?? globalQuotaMap;
  const strategy = config.routingStrategy ?? "default";
  const maxKeyRetries = config.maxKeyRetries ?? 2;
  const backoffInitialDelayMs = config.backoffInitialDelayMs ?? 200;

  // Build a map of provider name → available keys
  const providerKeys = new Map<string, string[]>();
  for (const entry of vaultEntries) {
    if (!providerKeys.has(entry.provider)) providerKeys.set(entry.provider, []);
    providerKeys.get(entry.provider)!.push(entry.key);
  }

  // Build the ordered attempt list
  const attempts: { provider: ProviderDefinition; model: string; key: string }[] = [];

  if (strategy === "cheapest") {
    const reasoning = isReasoningRequired(request.messages);
    const activeProviders = providers.filter((p) => providerKeys.has(p.name));

    const providerAttempts = activeProviders.map((p) => {
      const costInfo = PROVIDER_COSTS[p.name] ?? {
        cheapCost: 0.5,
        premiumCost: 5.0,
        cheapModel: p.staticModels?.[0] || "gpt-4o-mini",
        premiumModel: p.staticModels?.[0] || "gpt-4o",
      };
      const cost = reasoning ? costInfo.premiumCost : costInfo.cheapCost;
      const model = reasoning ? costInfo.premiumModel : costInfo.cheapModel;
      return {
        provider: p,
        model,
        cost,
      };
    });

    providerAttempts.sort((a, b) => a.cost - b.cost);

    for (const pa of providerAttempts) {
      const keys = providerKeys.get(pa.provider.name) ?? [];
      const validKeys = keys.filter((k) => cb.isAvailable(k));
      const sortedKeys = qm.sortKeys(validKeys);
      for (const key of sortedKeys) {
        attempts.push({ provider: pa.provider, model: pa.model, key });
      }
    }
  } else {
    if (config.routingRules && config.routingRules.length > 0) {
      // Explicit routing rules mode
      for (const rule of config.routingRules) {
        const provDef = providers.find((p) => p.name === rule.provider);
        if (!provDef) continue;
        const keys = providerKeys.get(rule.provider) ?? [];
        const validKeys = keys.filter((k) => cb.isAvailable(k));
        const sortedKeys = qm.sortKeys(validKeys);
        for (const key of sortedKeys) {
          attempts.push({ provider: provDef, model: rule.model, key });
        }
      }
    } else {
      // Auto-routing mode: detect primary provider from model name, then fallback chain
      const primaryDef = resolveProviderForModel(request.model, providers);
      if (!primaryDef) throw new NoProviderError(request.model);

      // Build fallback order: primary first, then by fallbackOrder
      const ordered = [
        primaryDef,
        ...providers.filter((p) => p.name !== primaryDef.name),
      ];

      for (const provDef of ordered) {
        const keys = providerKeys.get(provDef.name) ?? [];
        if (keys.length === 0) continue;

        // For fallback providers, keep the original model name —
        // if the provider doesn't understand it, it'll 400 and we move on.
        // Exception: Anthropic always needs an Anthropic model name.
        let targetModel = request.model;
        if (provDef.name === "Anthropic" && !request.model.startsWith("claude")) {
          targetModel = "claude-3-5-sonnet-latest";
        }

        const validKeys = keys.filter((k) => cb.isAvailable(k));
        const sortedKeys = qm.sortKeys(validKeys);
        for (const key of sortedKeys) {
          attempts.push({ provider: provDef, model: targetModel, key });
        }
      }
    }
  }

  if (attempts.length === 0) throw new NoProviderError(request.model);

  const maxAttempts = Math.min(attempts.length, config.maxRetries);
  const errors: ProviderError[] = [];

  if (request.stream) {
    return createRobustStream(request, attempts, maxAttempts, config, errors);
  }

  for (let i = 0; i < maxAttempts; i++) {
    const { provider, model, key } = attempts[i];
    const startTime = Date.now();

    try {
      const result = await sendToProviderWithRetry(provider, key, request, model, {
        timeout: config.timeout,
        debug: config.debug,
        quotaMap: qm,
        maxKeyRetries,
        backoffInitialDelayMs,
      });
      cb.recordSuccess(key);

      const latencyMs = Date.now() - startTime;
      let tokens: number | undefined = undefined;
      if (result && typeof result === "object" && "usage" in result && (result as any).usage) {
        tokens = (result as any).usage.total_tokens;
      }

      config.onAttempt?.({
        provider: provider.name,
        model,
        status: "success",
        latencyMs,
        tokens,
      });

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const provErr =
        err instanceof ProviderError
          ? err
          : new ProviderError(
              err instanceof Error ? err.message : String(err),
              provider.name
            );

      errors.push(provErr);
      cb.recordFailure(key, provErr.statusCode === 401);

      config.onAttempt?.({
        provider: provider.name,
        model,
        status: "error",
        latencyMs,
        error: provErr.message,
      });

      if (config.debug) {
        console.error(
          `[vaultedge] ✗ ${provider.name} failed (${provErr.statusCode ?? "network"}): ${provErr.message}`
        );
      }
    }
  }

  throw new AllProvidersFailedError(request.model, errors);
}

// ─── Re-export resolveProviderForModel for SDK convenience ────────────────────
export { resolveProviderForModel };
