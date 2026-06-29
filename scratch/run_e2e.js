import { spawn } from "node:child_process";

const PROXY_PORT = 8789;
const SYSTEM_KEY = "test-system-key";

async function main() {
  console.log("🧪 Starting Real VaultEdge End-to-End Integration Tests (No Mocks)...\n");

  // 1. Start Proxy Server
  // It will load the real local vault keys and use default providers.yaml
  const env = {
    ...process.env,
    VAULTEDGE_PORT: String(PROXY_PORT),
    VAULTEDGE_SYSTEM_KEY: SYSTEM_KEY,
    VAULTEDGE_DEBUG: "true"
  };

  const proxyProcess = spawn("node", ["--loader", "ts-node/esm", "apps/proxy/src/server.ts"], {
    env,
    stdio: "inherit"
  });

  // Wait for proxy to start
  let proxyReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
      if (res.ok) {
        proxyReady = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  if (!proxyReady) {
    console.error("❌ Proxy failed to start.");
    proxyProcess.kill();
    process.exit(1);
  }

  console.log("✅ Proxy Server is ready. Running requests against real providers...\n");

  let allPassed = true;

  try {
    // -------------------------------------------------------------------------
    // Test 1: Cheapest-First Auto-Routing (No reasoning -> Cheap model)
    // -------------------------------------------------------------------------
    console.log("👉 Test 1: Cheapest-First Routing (No reasoning -> Cheap model)");
    const res1 = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SYSTEM_KEY}`,
        "X-VaultEdge-Routing-Strategy": "cheapest"
      },
      body: JSON.stringify({
        model: "gpt-4o", // requested premium OpenAI model
        messages: [{ role: "user", content: "Tell me a 1-sentence joke." }]
      })
    });

    if (!res1.ok) {
      throw new Error(`Test 1 HTTP error! status: ${res1.status} body: ${await res1.text()}`);
    }

    const data1 = await res1.json();
    console.log(`   Routed to: ${data1._ve_provider}`);
    console.log(`   Model substituted & used: ${data1.model}`);
    console.log(`   Response text: "${data1.choices[0].message.content.trim()}"`);
    console.log("   ✅ Test 1 Passed!");
    console.log("");

    // -------------------------------------------------------------------------
    // Test 2: Cheapest-First Routing (With reasoning -> Premium model)
    // -------------------------------------------------------------------------
    console.log("👉 Test 2: Cheapest-First Routing (With reasoning -> Premium model)");
    const res2 = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SYSTEM_KEY}`,
        "X-VaultEdge-Routing-Strategy": "cheapest"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "<think>Explain step-by-step.</think> What is 2 + 2?" }
        ]
      })
    });

    if (!res2.ok) {
      throw new Error(`Test 2 HTTP error! status: ${res2.status} body: ${await res2.text()}`);
    }

    const data2 = await res2.json();
    console.log(`   Routed to: ${data2._ve_provider}`);
    console.log(`   Model substituted & used: ${data2.model}`);
    console.log(`   Response text: "${data2.choices[0].message.content.trim()}"`);
    console.log("   ✅ Test 2 Passed!");
    console.log("");

    // -------------------------------------------------------------------------
    // Test 3: Real E2E Streaming Completion
    // -------------------------------------------------------------------------
    console.log("👉 Test 3: Response Streaming (Real E2E)");
    const res3 = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SYSTEM_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant", // Route specifically to Groq
        messages: [{ role: "user", content: "Count from 1 to 5." }],
        stream: true
      })
    });

    if (!res3.ok) {
      throw new Error(`Test 3 HTTP error! status: ${res3.status} body: ${await res3.text()}`);
    }

    console.log("   Streaming response chunks:");
    const reader = res3.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(line.slice(6));
            const content = parsed.choices[0].delta.content || "";
            process.stdout.write(content);
            accumulated += content;
          } catch {}
        }
      }
    }
    console.log("\n   ✅ Test 3 Passed!");
    console.log("");

  } catch (err) {
    console.error("❌ E2E real integration test failed with error:", err);
    allPassed = false;
  } finally {
    console.log("🛑 Stopping Proxy Server...");
    proxyProcess.kill();
    
    if (allPassed) {
      console.log("\n🎉 ALL REAL E2E INTEGRATION TESTS COMPLETED SUCCESSFULLY! 🎉");
    } else {
      console.error("\n❌ SOME REAL E2E INTEGRATION TESTS FAILED.");
      process.exit(1);
    }
  }
}

main().catch(console.error);
