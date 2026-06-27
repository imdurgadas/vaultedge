import { VaultEdge } from "../packages/sdk/dist/index.js";

const ve = new VaultEdge({
  vault: "VE_VAULT_v1_ko9A45REwASTccas1Dp+s7M8r9GAnBOaHiqWIcsx7EXmvoPGJpN6nPQEABpk2BjTdpxG6je199C8EM+aKhAM2IDGrnoO535ppCCKNrXSy1kQmuAXpPo/wfwtTVq7IHDtR70BboI0vjm6Kl2fUsl6W/+Qf1A+LHJRRHmr0u5QW6OvySc=",
  password: "mysecretpassword",
  debug: true
});

try {
  const response = await ve.chat.completions.create({
    model: "gemini-3.5-flash",
    messages: [{ role: "user", content: "Hello!" }],
  });
  console.log("Success:", JSON.stringify(response, null, 2));
} catch (err) {
  console.error("Error:", err);
}
