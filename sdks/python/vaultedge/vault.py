"""
VaultEdge vault crypto — AES-256-GCM + PBKDF2.

Wire format:
  Prefix: "VE_VAULT_v1_"
  Payload (base64): salt[32] + nonce[12] + AES-256-GCM ciphertext+tag
"""

import base64
import json
import os
from dataclasses import dataclass
from typing import List

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

VAULT_PREFIX = "VE_VAULT_v1_"
PBKDF2_ITERATIONS = 210_000
SALT_BYTES = 32
NONCE_BYTES = 12


@dataclass
class VaultEntry:
    """A decrypted API key entry from the vault."""
    provider: str
    key: str


def _derive_key(password: str, salt: bytes) -> bytes:
    """Derive a 256-bit AES key from a password using PBKDF2-HMAC-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_vault(entries: List[VaultEntry], password: str) -> str:
    """
    Encrypt a list of VaultEntry objects with a master password.

    Returns a string starting with VE_VAULT_v1_ suitable for an env var.
    """
    salt = os.urandom(SALT_BYTES)
    nonce = os.urandom(NONCE_BYTES)
    key = _derive_key(password, salt)

    plaintext = json.dumps(
        [{"provider": e.provider, "key": e.key} for e in entries]
    ).encode("utf-8")

    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    wire = salt + nonce + ciphertext
    b64 = base64.b64encode(wire).decode("ascii")
    return f"{VAULT_PREFIX}{b64}"


def decrypt_vault(vault_string: str, password: str) -> List[VaultEntry]:
    """
    Decrypt a VaultEdge vault string.

    Raises:
        ValueError: If the vault string is invalid or the password is wrong.
    """
    if vault_string.startswith(VAULT_PREFIX):
        b64 = vault_string[len(VAULT_PREFIX):]
    else:
        raise ValueError(
            f"Invalid vault format. Expected string starting with '{VAULT_PREFIX}'."
        )

    try:
        wire = base64.b64decode(b64)
    except Exception as exc:
        raise ValueError("Vault string is not valid base64.") from exc

    if len(wire) < SALT_BYTES + NONCE_BYTES + 16:
        raise ValueError("Vault data is too short to be valid.")

    salt = wire[:SALT_BYTES]
    nonce = wire[SALT_BYTES:SALT_BYTES + NONCE_BYTES]
    ciphertext = wire[SALT_BYTES + NONCE_BYTES:]

    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)

    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except Exception as exc:
        raise ValueError(
            "Decryption failed. The password is incorrect or the vault is corrupted."
        ) from exc

    try:
        data = json.loads(plaintext.decode("utf-8"))
        if not isinstance(data, list):
            raise ValueError("Vault decrypted but contained invalid JSON structure.")
        return [VaultEntry(provider=item["provider"], key=item["key"]) for item in data]
    except (json.JSONDecodeError, KeyError) as exc:
        raise ValueError("Vault decrypted but contained invalid JSON.") from exc
