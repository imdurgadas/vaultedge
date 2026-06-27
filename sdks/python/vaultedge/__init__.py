"""VaultEdge — zero-trust AI key manager SDK for Python."""

from .vault import VaultEntry, encrypt_vault, decrypt_vault, VAULT_PREFIX
from .client import VaultEdge, resolve_provider

__all__ = [
    "VaultEdge",
    "VaultEntry",
    "encrypt_vault",
    "decrypt_vault",
    "resolve_provider",
    "VAULT_PREFIX",
]

__version__ = "1.0.0"
