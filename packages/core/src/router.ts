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
} from "./types.js";
import { ProviderError, NoProviderError, AllProvidersFailedError } from "./types.js";
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
  circuitBreaker?: CircuitBreaker;
  quotaMap?: QuotaMap;
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
  const providers = loadProviders(config.providersFile);
  const cb = config.circuitBreaker ?? globalCircuitBreaker;
  const qm = config.quotaMap ?? globalQuotaMap;

  // Build a map of provider name → available keys
  const providerKeys = new Map<string, string[]>();
  for (const entry of vaultEntries) {
    if (!providerKeys.has(entry.provider)) providerKeys.set(entry.provider, []);
    providerKeys.get(entry.provider)!.push(entry.key);
  }

  // Build the ordered attempt list
  const attempts: { provider: ProviderDefinition; model: string; key: string }[] = [];

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

  if (attempts.length === 0) throw new NoProviderError(request.model);

  const maxAttempts = Math.min(attempts.length, config.maxRetries);
  const errors: ProviderError[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const { provider, model, key } = attempts[i];
    const startTime = Date.now();

    try {
      const result = await sendToProvider(provider, key, request, model, {
        timeout: config.timeout,
        debug: config.debug,
        quotaMap: qm,
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
