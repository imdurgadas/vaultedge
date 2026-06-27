/**
 * VaultEdge Vault Crypto
 *
 * Wire format for exported vaults:
 *   Prefix: "VE_VAULT_v1_"
 *   Payload (base64): salt[32] + nonce[12] + AES-256-GCM ciphertext
 *
 * Key derivation: PBKDF2-HMAC-SHA256, 210,000 iterations (OWASP 2023 recommendation)
 *
 * Pure Web Crypto API — works in Node.js 18+, Deno, Bun,
 * Cloudflare Workers, and any modern browser. Zero native dependencies.
 */

import type { VaultEntry, StoredKeyEntry } from "./types.js";
import { VaultDecryptionError } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const VAULT_PREFIX = "VE_VAULT_v1_";
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 32;
const NONCE_BYTES = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== "undefined") return globalThis.crypto;
  // Node.js 18 exposes it on globalThis, but just in case:
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:crypto").webcrypto as Crypto;
}

function toB64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

function fromB64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"));
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      // Ensure we pass a plain ArrayBuffer, not SharedArrayBuffer
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypt an array of VaultEntry objects with a master password.
 * Returns a string starting with VE_VAULT_v1_ ready to be stored in an env var.
 */
export async function encryptVault(entries: VaultEntry[], password: string): Promise<string> {
  const crypto = getCrypto();
  const enc = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveKey(password, salt);

  const plaintext = enc.encode(JSON.stringify(entries));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext)
  );

  const wire = new Uint8Array(SALT_BYTES + NONCE_BYTES + ciphertext.byteLength);
  wire.set(salt, 0);
  wire.set(nonce, SALT_BYTES);
  wire.set(ciphertext, SALT_BYTES + NONCE_BYTES);

  return `${VAULT_PREFIX}${toB64(wire)}`;
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypt a VaultEdge vault string into an array of VaultEntry objects.
 */
export async function decryptVault(vaultString: string, password: string): Promise<VaultEntry[]> {
  const crypto = getCrypto();

  let b64: string;
  if (vaultString.startsWith(VAULT_PREFIX)) {
    b64 = vaultString.slice(VAULT_PREFIX.length);
  } else {
    throw new VaultDecryptionError(
      `Invalid vault format. Expected string starting with "${VAULT_PREFIX}".`
    );
  }

  let wire: Uint8Array;
  try {
    wire = fromB64(b64);
  } catch {
    throw new VaultDecryptionError("Vault string is not valid base64.");
  }

  if (wire.byteLength < SALT_BYTES + NONCE_BYTES + 16) {
    throw new VaultDecryptionError("Vault data is too short to be valid.");
  }

  const salt = wire.slice(0, SALT_BYTES);
  const nonce = wire.slice(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const ciphertext = wire.slice(SALT_BYTES + NONCE_BYTES);

  const key = await deriveKey(password, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  } catch {
    throw new VaultDecryptionError(
      "Decryption failed. The password is incorrect or the vault is corrupted."
    );
  }

  const dec = new TextDecoder();
  const json = dec.decode(plaintext);

  try {
    const entries = JSON.parse(json) as VaultEntry[];
    if (!Array.isArray(entries)) throw new Error("Not an array");
    return entries;
  } catch {
    throw new VaultDecryptionError("Vault decrypted but contained invalid JSON.");
  }
}

// ─── Local Vault (at-rest per-machine storage) ────────────────────────────────

/**
 * Encrypt a single plaintext API key for local at-rest storage.
 * Uses a machine-specific secret (VAULTEDGE_LOCAL_SECRET env var or a random key
 * stored in the data directory).
 *
 * This is used by the proxy server and CLI when managing the local key store,
 * NOT for the exported portable vault.
 */
export async function encryptLocalKey(
  plaintext: string,
  secret: string
): Promise<string> {
  const crypto = getCrypto();
  const enc = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveKey(secret, salt);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, enc.encode(plaintext))
  );

  const wire = new Uint8Array(SALT_BYTES + NONCE_BYTES + ciphertext.byteLength);
  wire.set(salt, 0);
  wire.set(nonce, SALT_BYTES);
  wire.set(ciphertext, SALT_BYTES + NONCE_BYTES);

  return toB64(wire);
}

export async function decryptLocalKey(
  encrypted: string,
  secret: string
): Promise<string> {
  const crypto = getCrypto();

  const wire = fromB64(encrypted);
  const salt = wire.slice(0, SALT_BYTES);
  const nonce = wire.slice(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const ciphertext = wire.slice(SALT_BYTES + NONCE_BYTES);

  const key = await deriveKey(secret, salt);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── Local Key Store ─────────────────────────────────────────────────────────

export interface LocalKeyStore {
  entries: StoredKeyEntry[];
  version: 1;
}

export function createStoredKeyEntry(
  provider: string,
  plaintext: string,
  encryptedKey: string
): StoredKeyEntry {
  const masked =
    plaintext.length > 8
      ? `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`
      : "****";

  return {
    id: crypto.randomUUID(),
    provider,
    encryptedKey,
    maskedKey: masked,
    addedAt: Math.floor(Date.now() / 1000),
    isValid: null,
  };
}
