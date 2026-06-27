"""
VaultEdge Python SDK — main client.

Usage:
    import asyncio
    import os
    from vaultedge import VaultEdge

    ve = VaultEdge(
        vault=os.environ["VAULTEDGE_VAULT"],
        password=os.environ["VAULTEDGE_PASSWORD"],
    )

    async def main():
        response = await ve.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello!"}],
        )
        print(response["choices"][0]["message"]["content"])

    asyncio.run(main())
"""

import os
from typing import Any, AsyncIterator, Dict, List, Optional, Union
import httpx

from .vault import VaultEntry, decrypt_vault

# ─── Provider Config ───────────────────────────────────────────────────────────

PROVIDER_CONFIGS: Dict[str, Dict[str, Any]] = {
    "OpenAI":      {"url": "https://api.openai.com/v1/chat/completions",          "scheme": "bearer"},
    "Groq":        {"url": "https://api.groq.com/openai/v1/chat/completions",     "scheme": "bearer"},
    "Anthropic":   {"url": "https://api.anthropic.com/v1/messages",               "scheme": "x-api-key"},
    "Gemini":      {"url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "scheme": "bearer"},
    "Mistral":     {"url": "https://api.mistral.ai/v1/chat/completions",           "scheme": "bearer"},
    "xAI":         {"url": "https://api.x.ai/v1/chat/completions",                "scheme": "bearer"},
    "DeepSeek":    {"url": "https://api.deepseek.com/v1/chat/completions",         "scheme": "bearer"},
    "OpenRouter":  {"url": "https://openrouter.ai/api/v1/chat/completions",        "scheme": "bearer"},
    "Cohere":      {"url": "https://api.cohere.ai/v1/chat/completions",            "scheme": "bearer"},
    "Cerebras":    {"url": "https://api.cerebras.ai/v1/chat/completions",          "scheme": "bearer"},
    "Sambanova":   {"url": "https://api.sambanova.ai/v1/chat/completions",         "scheme": "bearer"},
    "Nvidia":      {"url": "https://integrate.api.nvidia.com/v1/chat/completions", "scheme": "bearer"},
    "Together":    {"url": "https://api.together.xyz/v1/chat/completions",         "scheme": "bearer"},
    "Perplexity":  {"url": "https://api.perplexity.ai/chat/completions",           "scheme": "bearer"},
}

MODEL_PREFIX_MAP = [
    ("gpt-",       "OpenAI"),
    ("o1",         "OpenAI"),
    ("o3",         "OpenAI"),
    ("davinci",    "OpenAI"),
    ("llama",      "Groq"),
    ("groq",       "Groq"),
    ("mixtral",    "Groq"),
    ("gemma",      "Groq"),
    ("gemini",     "Gemini"),
    ("claude",     "Anthropic"),
    ("mistral",    "Mistral"),
    ("codestral",  "Mistral"),
    ("grok",       "xAI"),
    ("deepseek",   "DeepSeek"),
    ("command",    "Cohere"),
    ("cohere",     "Cohere"),
    ("nvidia",     "Nvidia"),
    ("nim",        "Nvidia"),
    ("sonar",      "Perplexity"),
    ("pplx-",      "Perplexity"),
]


def resolve_provider(model: str) -> Optional[str]:
    lower = model.lower()
    for prefix, provider in MODEL_PREFIX_MAP:
        if lower.startswith(prefix):
            return provider
    return None


def build_headers(provider: str, api_key: str) -> Dict[str, str]:
    config = PROVIDER_CONFIGS.get(provider, {})
    scheme = config.get("scheme", "bearer")
    headers = {"Content-Type": "application/json"}
    if scheme == "bearer":
        headers["Authorization"] = f"Bearer {api_key}"
    elif scheme == "x-api-key":
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    return headers


# ─── Completions ───────────────────────────────────────────────────────────────

class Completions:
    def __init__(self, client: "VaultEdge") -> None:
        self._client = client

    async def create(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        *,
        stream: bool = False,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        top_p: Optional[float] = None,
        **kwargs: Any,
    ) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        """
        Create a chat completion.

        Args:
            model: Model name (e.g. "gpt-4o", "claude-3-5-sonnet-latest")
            messages: List of message dicts with "role" and "content"
            stream: If True, returns an async iterator of chunk dicts
            temperature: Sampling temperature
            max_tokens: Max tokens to generate
            **kwargs: Any other OpenAI-compatible parameters

        Returns:
            If stream=False: A dict matching the OpenAI ChatCompletion format.
            If stream=True: An async iterator of chunk dicts.
        """
        entries = await self._client._get_entries()
        provider_keys: Dict[str, List[str]] = {}
        for e in entries:
            provider_keys.setdefault(e.provider, []).append(e.key)

        primary = resolve_provider(model)
        if not primary:
            raise ValueError(f"No provider found for model '{model}'.")

        order = [primary] + [p for p in PROVIDER_CONFIGS if p != primary]
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if top_p is not None:
            payload["top_p"] = top_p

        errors = []
        attempts = 0

        for provider in order:
            keys = provider_keys.get(provider, [])
            if not keys:
                continue
            if attempts >= self._client.max_retries:
                break

            config = PROVIDER_CONFIGS.get(provider)
            if not config:
                continue

            for key in keys:
                if attempts >= self._client.max_retries:
                    break
                attempts += 1
                headers = build_headers(provider, key)
                try:
                    async with httpx.AsyncClient(timeout=self._client.timeout) as http:
                        if stream:
                            return self._stream_response(http, config["url"], headers, payload)
                        resp = await http.post(config["url"], json=payload, headers=headers)
                        if resp.status_code == 200:
                            return resp.json()
                        errors.append(f"{provider}: HTTP {resp.status_code}")
                except Exception as exc:
                    errors.append(f"{provider}: {exc}")

        raise RuntimeError(f"All providers failed: {'; '.join(errors)}")

    async def _stream_response(
        self,
        http: httpx.AsyncClient,
        url: str,
        headers: Dict[str, str],
        payload: Dict[str, Any],
    ) -> AsyncIterator[Dict[str, Any]]:
        import json as _json
        async with http.stream("POST", url, json=payload, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        yield _json.loads(data)
                    except _json.JSONDecodeError:
                        pass


class Chat:
    def __init__(self, client: "VaultEdge") -> None:
        self.completions = Completions(client)


# ─── Main Client ───────────────────────────────────────────────────────────────

class VaultEdge:
    """
    VaultEdge Python SDK client.

    Example::

        ve = VaultEdge(
            vault=os.environ["VAULTEDGE_VAULT"],
            password=os.environ["VAULTEDGE_PASSWORD"],
        )
        response = await ve.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello!"}],
        )
    """

    def __init__(
        self,
        vault: Optional[str] = None,
        password: Optional[str] = None,
        *,
        timeout: float = 60.0,
        max_retries: int = 3,
        debug: bool = False,
    ) -> None:
        self._vault_string = vault or os.environ.get("VAULTEDGE_VAULT")
        self._password = password or os.environ.get("VAULTEDGE_PASSWORD")

        if not self._vault_string:
            raise ValueError(
                "No vault provided. Pass vault= or set VAULTEDGE_VAULT env var."
            )
        if not self._password:
            raise ValueError(
                "No password provided. Pass password= or set VAULTEDGE_PASSWORD env var."
            )

        self.timeout = timeout
        self.max_retries = max_retries
        self.debug = debug
        self.chat = Chat(self)
        self._cached_entries: Optional[List[VaultEntry]] = None

    async def _get_entries(self) -> List[VaultEntry]:
        if self._cached_entries is None:
            if self.debug:
                print("[vaultedge] Decrypting vault...")
            self._cached_entries = decrypt_vault(self._vault_string, self._password)  # type: ignore[arg-type]
            if self.debug:
                print(f"[vaultedge] Vault decrypted: {len(self._cached_entries)} entries")
        return self._cached_entries

    async def get_providers(self) -> List[str]:
        """Return list of providers available in the vault."""
        entries = await self._get_entries()
        return list({e.provider for e in entries})

    async def has_provider(self, provider: str) -> bool:
        """Check if the vault has a key for the given provider."""
        entries = await self._get_entries()
        return any(e.provider == provider for e in entries)

    def resolve_model(self, model: str) -> Optional[str]:
        """Resolve which provider will handle a given model name."""
        return resolve_provider(model)
