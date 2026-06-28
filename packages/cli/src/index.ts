#!/usr/bin/env node
/**
 * VaultEdge CLI
 *
 * Usage:
 *   vaultedge vault init                   Create a new local vault
 *   vaultedge vault add-key                Add an API key interactively
 *   vaultedge vault list                   List keys in the local vault
 *   vaultedge vault remove-key <id>        Remove a key by ID
 *   vaultedge vault export                 Export encrypted vault string
 *   vaultedge vault import <vault-string>  Import & decrypt a vault string
 *   vaultedge vault migrate <vault-string>  Re-encrypt a vault with a new password
 *   vaultedge run -- <command>             Inject keys & run a command
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — inquirer v9 ships its own bundled types
import inquirer from "inquirer";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — chalk v5 is ESM-only with bundled types
import chalk from "chalk";
import {
  encryptVault,
  decryptVault,
  encryptLocalKey,
  decryptLocalKey,
  loadProviders,
  createStoredKeyEntry,
} from "@durgadas/vaultedge-core";
import type { StoredKeyEntry, VaultEntry } from "@durgadas/vaultedge-core";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), ".vaultedge");
const VAULT_FILE = join(DATA_DIR, "local.vault.json");
const SECRET_FILE = join(DATA_DIR, ".secret");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getOrCreateSecret(): string {
  ensureDataDir();
  if (existsSync(SECRET_FILE)) {
    return readFileSync(SECRET_FILE, "utf-8").trim();
  }
  // Generate a 32-byte random secret
  const secret = Buffer.from(
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
  ).toString("hex");
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

interface LocalVault {
  version: 1;
  entries: StoredKeyEntry[];
}

function readLocalVault(): LocalVault {
  if (!existsSync(VAULT_FILE)) {
    return { version: 1, entries: [] };
  }
  const raw = readFileSync(VAULT_FILE, "utf-8");
  return JSON.parse(raw) as LocalVault;
}

function writeLocalVault(vault: LocalVault) {
  ensureDataDir();
  writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), { mode: 0o600 });
}

async function getPlaintextKey(entry: StoredKeyEntry): Promise<string> {
  const secret = getOrCreateSecret();
  return decryptLocalKey(entry.encryptedKey, secret);
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function prompt(questions: any[]): Promise<any> {
  return inquirer.prompt(questions);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("vaultedge")
  .description("VaultEdge — Zero-trust AI key manager")
  .version("1.0.10");

// ─── vault commands ────────────────────────────────────────────────────────────

const vault = program.command("vault").description("Manage your local vault");

vault
  .command("init")
  .description("Initialize a new local vault (run once)")
  .action(async () => {
    
    getOrCreateSecret();
    ensureDataDir();
    writeLocalVault({ version: 1, entries: [] });
    console.log(chalk.green("✓") + " Vault initialized at " + chalk.bold(DATA_DIR));
  });

vault
  .command("add-key")
  .description("Add an API key to the local vault")
  .option("-p, --provider <name>", "Provider name (e.g. OpenAI)")
  .option("-k, --key <apikey>", "API key value")
  .action(async (opts) => {
    
    const providers = loadProviders();
    const providerNames = providers.map((p) => p.name);

    const answers = await prompt([
      {
        type: "list",
        name: "provider",
        message: "Select provider:",
        choices: providerNames,
        when: !opts.provider,
      },
      {
        type: "password",
        name: "key",
        message: "Enter API key:",
        when: !opts.key,
        validate: (v: string) => v.length > 0 || "Key cannot be empty",
      },
    ]);

    const provider = opts.provider ?? answers.provider;
    const key = opts.key ?? answers.key;
    const secret = getOrCreateSecret();

    const encrypted = await encryptLocalKey(key, secret);
    const entry = createStoredKeyEntry(provider, key, encrypted);

    const lv = readLocalVault();
    lv.entries.push(entry);
    writeLocalVault(lv);

    console.log(chalk.green("✓") + ` Added ${chalk.bold(provider)} key ${chalk.dim(entry.maskedKey)} (id: ${entry.id})`);
  });

vault
  .command("list")
  .description("List all keys in the local vault")
  .action(async () => {
    
    const lv = readLocalVault();

    if (lv.entries.length === 0) {
      console.log(chalk.yellow("No keys found. Run `vaultedge vault add-key` to add one."));
      return;
    }

    console.log(chalk.bold("\nLocal Vault Keys:\n"));
    for (const e of lv.entries) {
      const status = e.isValid === null ? chalk.gray("?") : e.isValid ? chalk.green("✓") : chalk.red("✗");
      console.log(
        `  ${status} ${chalk.bold(e.provider.padEnd(16))} ${chalk.dim(e.maskedKey.padEnd(20))} ${chalk.gray("id:" + e.id)}`
      );
    }
    console.log();
  });

vault
  .command("remove-key <id>")
  .description("Remove a key by its ID")
  .action(async (id: string) => {
    
    const lv = readLocalVault();
    const before = lv.entries.length;
    lv.entries = lv.entries.filter((e) => e.id !== id);
    if (lv.entries.length === before) {
      console.log(chalk.red("✗") + ` No key found with id: ${id}`);
      process.exit(1);
    }
    writeLocalVault(lv);
    console.log(chalk.green("✓") + ` Removed key ${id}`);
  });

vault
  .command("export")
  .description("Export an encrypted vault string (for VAULTEDGE_VAULT env var)")
  .option("--password <pass>", "Master password to encrypt with")
  .option("--output <file>", "Write vault string to a file instead of stdout")
  .action(async (opts) => {
    
    const lv = readLocalVault();

    if (lv.entries.length === 0) {
      console.log(chalk.yellow("No keys to export. Add some with `vaultedge vault add-key`."));
      return;
    }

    let password = opts.password;
    if (!password) {
      const ans = await prompt([
        { type: "password", name: "password", message: "Master password to encrypt vault with:" },
        { type: "password", name: "confirm", message: "Confirm password:" },
      ]);
      if ((ans as { password: string; confirm: string }).password !== (ans as { password: string; confirm: string }).confirm) {
        console.log(chalk.red("✗ Passwords do not match."));
        process.exit(1);
      }
      password = (ans as { password: string }).password;
    }

    // Decrypt all local keys to plaintext VaultEntry objects
    const entries: VaultEntry[] = [];
    for (const e of lv.entries) {
      const key = await getPlaintextKey(e);
      entries.push({ provider: e.provider, key });
    }

    const vaultString = await encryptVault(entries, password);

    if (opts.output) {
      writeFileSync(resolve(opts.output), vaultString);
      console.log(chalk.green("✓") + ` Vault exported to ${opts.output}`);
    } else {
      console.log("\n" + chalk.bold("VAULTEDGE_VAULT=") + vaultString + "\n");
    }
  });

vault
  .command("import <vault-string>")
  .description("Decrypt and import a vault string into the local vault")
  .option("--password <pass>", "Master password")
  .action(async (vaultString: string, opts) => {
    
    let password = opts.password;
    if (!password) {
      const ans = await prompt([{ type: "password", name: "password", message: "Vault password:" }]);
      password = (ans as { password: string }).password;
    }

    const entries = await decryptVault(vaultString, password);
    const secret = getOrCreateSecret();
    const lv = readLocalVault();

    for (const e of entries) {
      const encrypted = await encryptLocalKey(e.key, secret);
      const stored = createStoredKeyEntry(e.provider, e.key, encrypted);
      lv.entries.push(stored);
    }
    writeLocalVault(lv);
    console.log(chalk.green("✓") + ` Imported ${entries.length} keys from vault.`);
  });

vault
  .command("migrate <vault-string>")
  .description("Re-encrypt a vault string with a new master password")
  .option("--old-password <pass>", "Current vault password")
  .option("--new-password <pass>", "New master password (defaults to same)")
  .action(async (vaultString: string, opts) => {
    
    let oldPass = opts.oldPassword;
    if (!oldPass) {
      const ans = await prompt([{ type: "password", name: "p", message: "Current vault password:" }]);
      oldPass = (ans as { p: string }).p;
    }

    console.log(chalk.gray("Decrypting vault..."));
    const entries = await decryptVault(vaultString, oldPass);

    const newPass = opts.newPassword ?? oldPass;
    const newVault = await encryptVault(entries, newPass);

    console.log(chalk.green("✓ Done!\n"));
    console.log(chalk.bold("VAULTEDGE_VAULT=") + newVault);
    console.log(
      chalk.gray("\nSet VAULTEDGE_PASSWORD=" + (opts.newPassword ? "<new-password>" : "<same-password>"))
    );
  });

// ─── run command ───────────────────────────────────────────────────────────────

program
  .command("run")
  .description("Inject decrypted API keys as env vars and run a command")
  .argument("<command...>", "Command to run (after --)")
  .option("--password <pass>", "Master password")
  .action(async (args: string[], opts) => {
    
    const lv = readLocalVault();

    if (lv.entries.length === 0) {
      console.error(chalk.red("✗") + " No keys in vault. Run `vaultedge vault add-key` first.");
      process.exit(1);
    }

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    for (const e of lv.entries) {
      const key = await getPlaintextKey(e);
      // Inject as PROVIDER_API_KEY, e.g. OPENAI_API_KEY, GROQ_API_KEY
      const envKey = `${e.provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
      env[envKey] = key;
    }

    const [cmd, ...cmdArgs] = args;
    console.log(chalk.gray(`[vaultedge] Running: ${cmd} ${cmdArgs.join(" ")}`));
    const result = spawnSync(cmd, cmdArgs, { env, stdio: "inherit", shell: false });
    process.exit(result.status ?? 0);
  });

program.parse();
