// Package vaultedge provides a Go SDK for VaultEdge — zero-trust AI key management.
//
// Wire format:
//
//	Prefix: "VE_VAULT_v1_"
//	Payload (base64): salt[32] + nonce[12] + AES-256-GCM ciphertext+tag
//
// Key derivation: PBKDF2-HMAC-SHA256, 210,000 iterations.
package vaultedge

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

const (
	VaultPrefix  = "VE_VAULT_v1_"
	pbkdf2Iters  = 210_000
	saltBytes    = 32
	nonceBytes   = 12
)

// VaultEntry represents a decrypted API key in the vault.
type VaultEntry struct {
	Provider string `json:"provider"`
	Key      string `json:"key"`
}

func deriveKey(password string, salt []byte) []byte {
	return pbkdf2.Key([]byte(password), salt, pbkdf2Iters, 32, sha256.New)
}

// EncryptVault encrypts a slice of VaultEntry objects with a master password.
// Returns a string starting with VE_VAULT_v1_ ready to be stored in an env var.
func EncryptVault(entries []VaultEntry, password string) (string, error) {
	salt := make([]byte, saltBytes)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("generating salt: %w", err)
	}

	nonce := make([]byte, nonceBytes)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generating nonce: %w", err)
	}

	key := deriveKey(password, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("creating cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("creating GCM: %w", err)
	}

	plaintext, err := json.Marshal(entries)
	if err != nil {
		return "", fmt.Errorf("marshalling entries: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	wire := make([]byte, saltBytes+nonceBytes+len(ciphertext))
	copy(wire[0:], salt)
	copy(wire[saltBytes:], nonce)
	copy(wire[saltBytes+nonceBytes:], ciphertext)

	return VaultPrefix + base64.StdEncoding.EncodeToString(wire), nil
}

// DecryptVault decrypts a VaultEdge vault string into a slice of VaultEntry objects.
func DecryptVault(vaultString, password string) ([]VaultEntry, error) {
	var b64 string
	switch {
	case strings.HasPrefix(vaultString, VaultPrefix):
		b64 = vaultString[len(VaultPrefix):]
	default:
		return nil, fmt.Errorf("invalid vault format: expected prefix %q", VaultPrefix)
	}

	wire, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errors.New("vault string is not valid base64")
	}

	if len(wire) < saltBytes+nonceBytes+16 {
		return nil, errors.New("vault data is too short to be valid")
	}

	salt := wire[:saltBytes]
	nonce := wire[saltBytes : saltBytes+nonceBytes]
	ciphertext := wire[saltBytes+nonceBytes:]

	key := deriveKey(password, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, errors.New("decryption failed: incorrect password or corrupted vault")
	}

	var entries []VaultEntry
	if err := json.Unmarshal(plaintext, &entries); err != nil {
		return nil, fmt.Errorf("vault decrypted but contains invalid JSON: %w", err)
	}

	return entries, nil
}
