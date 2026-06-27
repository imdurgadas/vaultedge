// VaultEdge Go SDK — client & router
package vaultedge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─── Provider Config ──────────────────────────────────────────────────────────

type providerConfig struct {
	URL    string
	Scheme string // "bearer" or "x-api-key"
}

var providerConfigs = map[string]providerConfig{
	"OpenAI":     {URL: "https://api.openai.com/v1/chat/completions", Scheme: "bearer"},
	"Groq":       {URL: "https://api.groq.com/openai/v1/chat/completions", Scheme: "bearer"},
	"Anthropic":  {URL: "https://api.anthropic.com/v1/messages", Scheme: "x-api-key"},
	"Gemini":     {URL: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", Scheme: "bearer"},
	"Mistral":    {URL: "https://api.mistral.ai/v1/chat/completions", Scheme: "bearer"},
	"xAI":        {URL: "https://api.x.ai/v1/chat/completions", Scheme: "bearer"},
	"DeepSeek":   {URL: "https://api.deepseek.com/v1/chat/completions", Scheme: "bearer"},
	"OpenRouter": {URL: "https://openrouter.ai/api/v1/chat/completions", Scheme: "bearer"},
	"Cohere":     {URL: "https://api.cohere.ai/v1/chat/completions", Scheme: "bearer"},
	"Cerebras":   {URL: "https://api.cerebras.ai/v1/chat/completions", Scheme: "bearer"},
	"Sambanova":  {URL: "https://api.sambanova.ai/v1/chat/completions", Scheme: "bearer"},
	"Nvidia":     {URL: "https://integrate.api.nvidia.com/v1/chat/completions", Scheme: "bearer"},
	"Together":   {URL: "https://api.together.xyz/v1/chat/completions", Scheme: "bearer"},
	"Perplexity": {URL: "https://api.perplexity.ai/chat/completions", Scheme: "bearer"},
}

var modelPrefixMap = []struct {
	Prefix   string
	Provider string
}{
	{"gpt-", "OpenAI"},
	{"o1", "OpenAI"},
	{"o3", "OpenAI"},
	{"davinci", "OpenAI"},
	{"llama", "Groq"},
	{"groq", "Groq"},
	{"mixtral", "Groq"},
	{"gemma", "Groq"},
	{"gemini", "Gemini"},
	{"claude", "Anthropic"},
	{"mistral", "Mistral"},
	{"codestral", "Mistral"},
	{"grok", "xAI"},
	{"deepseek", "DeepSeek"},
	{"command", "Cohere"},
	{"cohere", "Cohere"},
	{"nvidia", "Nvidia"},
	{"nim", "Nvidia"},
	{"sonar", "Perplexity"},
	{"pplx-", "Perplexity"},
}

// ResolveProvider returns the primary provider name for a given model.
func ResolveProvider(model string) string {
	lower := strings.ToLower(model)
	for _, m := range modelPrefixMap {
		if strings.HasPrefix(lower, m.Prefix) {
			return m.Provider
		}
	}
	return ""
}

// ─── Chat Types ────────────────────────────────────────────────────────────────

// ChatMessage represents a single message in a conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest is an OpenAI-compatible completion request.
type ChatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"max_tokens,omitempty"`
	TopP        *float64      `json:"top_p,omitempty"`
	Stream      bool          `json:"stream,omitempty"`
}

// ChatCompletionResponse is an OpenAI-compatible completion response.
type ChatCompletionResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int         `json:"index"`
		Message ChatMessage `json:"message"`
		Reason  string      `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
	// Internal: which provider served this request
	VEProvider string `json:"_ve_provider,omitempty"`
}

// ─── Client ────────────────────────────────────────────────────────────────────

// Client is the VaultEdge Go SDK client.
type Client struct {
	vaultString string
	password    string
	timeout     time.Duration
	maxRetries  int
	debug       bool
	httpClient  *http.Client
	entries     []VaultEntry
}

// ClientOption is a functional option for Client.
type ClientOption func(*Client)

// WithTimeout sets the HTTP request timeout.
func WithTimeout(d time.Duration) ClientOption {
	return func(c *Client) { c.timeout = d }
}

// WithMaxRetries sets the maximum number of provider fallbacks.
func WithMaxRetries(n int) ClientOption {
	return func(c *Client) { c.maxRetries = n }
}

// WithDebug enables verbose logging.
func WithDebug(v bool) ClientOption {
	return func(c *Client) { c.debug = v }
}

// New creates a new VaultEdge client.
func New(vaultString, password string, opts ...ClientOption) *Client {
	c := &Client{
		vaultString: vaultString,
		password:    password,
		timeout:     60 * time.Second,
		maxRetries:  3,
	}
	for _, opt := range opts {
		opt(c)
	}
	c.httpClient = &http.Client{Timeout: c.timeout}
	return c
}

// ─── Lazy Vault Load ──────────────────────────────────────────────────────────

func (c *Client) getEntries(ctx context.Context) ([]VaultEntry, error) {
	if c.entries != nil {
		return c.entries, nil
	}
	entries, err := DecryptVault(c.vaultString, c.password)
	if err != nil {
		return nil, err
	}
	c.entries = entries
	return entries, nil
}

// ─── Chat Completions ─────────────────────────────────────────────────────────

// ChatCompletions is the namespace for chat completion methods.
type ChatCompletions struct {
	client *Client
}

// Chat returns the chat namespace.
func (c *Client) Chat() *ChatCompletions {
	return &ChatCompletions{client: c}
}

// Create sends a chat completion request.
func (cc *ChatCompletions) Create(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	entries, err := cc.client.getEntries(ctx)
	if err != nil {
		return nil, err
	}

	// Build provider → keys map
	providerKeys := make(map[string][]string)
	for _, e := range entries {
		providerKeys[e.Provider] = append(providerKeys[e.Provider], e.Key)
	}

	primary := ResolveProvider(req.Model)
	if primary == "" {
		return nil, fmt.Errorf("no provider found for model %q", req.Model)
	}

	// Build attempt order
	order := []string{primary}
	for p := range providerConfigs {
		if p != primary {
			order = append(order, p)
		}
	}

	var lastErr error
	attempts := 0

	for _, provider := range order {
		keys := providerKeys[provider]
		if len(keys) == 0 {
			continue
		}
		cfg, ok := providerConfigs[provider]
		if !ok {
			continue
		}

		for _, key := range keys {
			if attempts >= cc.client.maxRetries {
				break
			}
			attempts++

			resp, err := cc.client.doRequest(ctx, cfg, provider, key, req)
			if err != nil {
				lastErr = err
				if cc.client.debug {
					fmt.Printf("[vaultedge] ✗ %s failed: %v\n", provider, err)
				}
				continue
			}

			resp.VEProvider = provider
			return resp, nil
		}

		if attempts >= cc.client.maxRetries {
			break
		}
	}

	if lastErr != nil {
		return nil, fmt.Errorf("all providers failed; last error: %w", lastErr)
	}
	return nil, fmt.Errorf("no providers available for model %q", req.Model)
}

func (c *Client) doRequest(
	ctx context.Context,
	cfg providerConfig,
	provider, key string,
	req ChatCompletionRequest,
) (*ChatCompletionResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	switch cfg.Scheme {
	case "bearer":
		httpReq.Header.Set("Authorization", "Bearer "+key)
	case "x-api-key":
		httpReq.Header.Set("x-api-key", key)
		httpReq.Header.Set("anthropic-version", "2023-06-01")
	}

	if c.debug {
		fmt.Printf("[vaultedge] → %s (model: %s)\n", provider, req.Model)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var result ChatCompletionResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parsing response: %w", err)
	}

	return &result, nil
}

// GetProviders returns all provider names available in the vault.
func (c *Client) GetProviders(ctx context.Context) ([]string, error) {
	entries, err := c.getEntries(ctx)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	var providers []string
	for _, e := range entries {
		if !seen[e.Provider] {
			seen[e.Provider] = true
			providers = append(providers, e.Provider)
		}
	}
	return providers, nil
}
