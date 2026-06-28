import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { decryptLocalKey } from "@durgadas/vaultedge-core";

const DATA_DIR = join(homedir(), ".vaultedge");
const VAULT_FILE = join(DATA_DIR, "local.vault.json");
const SECRET_FILE = join(DATA_DIR, ".secret");

const raw = readFileSync(VAULT_FILE, "utf-8");
const lv = JSON.parse(raw);
const secret = readFileSync(SECRET_FILE, "utf-8").trim();

const geminiEntry = lv.entries.find(e => e.provider === "Gemini");
if (!geminiEntry) {
  console.log("No Gemini entry found.");
  process.exit(1);
}

const key = await decryptLocalKey(geminiEntry.encryptedKey, secret);
console.log("Using key:", key.slice(0, 8) + "..." + key.slice(-4));

try {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  console.log("Status:", res.status);
  const data = await res.json();
  if (data.models) {
    console.log("Models:", data.models.map(m => m.name));
  } else {
    console.log("Response:", JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error(err);
}
