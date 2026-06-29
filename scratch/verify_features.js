import { routeRequest } from "../packages/core/dist/router.js";
import { ProviderError } from "../packages/core/dist/types.js";

// Save original fetch
const originalFetch = globalThis.fetch;

async function runTests() {
  console.log("🧪 Starting VaultEdge Feature Verification Tests...\n");

  const vaultEntries = [
    { provider: "Gemini", key: "gemini-key-123" },
    { provider: "OpenAI", key: "openai-key-456" },
  ];

  // ---------------------------------------------------------------------------
  // Test 1: Cheapest-First Routing (No Reasoning -> Cheap Models)
  // ---------------------------------------------------------------------------
  console.log("👉 Test 1: Cheapest-First Routing (No Reasoning)");
  let fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      id: "chatcmpl-test1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello from cheap!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const req1 = {
    model: "gpt-4o", // Premium model requested
    messages: [{ role: "user", content: "Hi there!" }],
  };

  const res1 = await routeRequest(req1, vaultEntries, {
    timeout: 5000,
    maxRetries: 3,
    debug: false,
    routingStrategy: "cheapest",
  });

  // Since Gemini's cheap model is gemini-2.5-flash and has a lower cost ($0.25) than OpenAI's gpt-4o-mini ($0.30),
  // it should route to Gemini with gemini-2.5-flash!
  const firstCall = fetchCalls[0];
  console.log(`   Routed to: ${firstCall.url}`);
  console.log(`   Substituted Model: ${firstCall.body.model}`);
  if (firstCall.url.includes("googleapis.com") && firstCall.body.model === "gemini-2.5-flash") {
    console.log("   ✅ Test 1 Passed!");
  } else {
    console.error("   ❌ Test 1 Failed!");
  }
  console.log("");

  // ---------------------------------------------------------------------------
  // Test 2: Cheapest-First Routing (With Reasoning -> Premium Models)
  // ---------------------------------------------------------------------------
  console.log("👉 Test 2: Cheapest-First Routing (With <think> Reasoning Tag)");
  fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      id: "chatcmpl-test2",
      choices: [{ index: 0, message: { role: "assistant", content: "Thinking process complete." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const req2 = {
    model: "gpt-4o",
    messages: [
      { role: "user", content: "<think>Let me reason step-by-step.</think> Solve 2+2." }
    ],
  };

  await routeRequest(req2, vaultEntries, {
    timeout: 5000,
    maxRetries: 3,
    debug: false,
    routingStrategy: "cheapest",
  });

  // With reasoning tag, Gemini premium is gemini-2.5-pro ($5.00) and OpenAI premium is gpt-4o ($10.00).
  // So it should route to Gemini with gemini-2.5-pro!
  const secondCall = fetchCalls[0];
  console.log(`   Routed to: ${secondCall.url}`);
  console.log(`   Substituted Model: ${secondCall.body.model}`);
  if (secondCall.url.includes("googleapis.com") && secondCall.body.model === "gemini-2.5-pro") {
    console.log("   ✅ Test 2 Passed!");
  } else {
    console.error("   ❌ Test 2 Failed!");
  }
  console.log("");

  // ---------------------------------------------------------------------------
  // Test 3: Automatic Retries with Exponential Backoff
  // ---------------------------------------------------------------------------
  console.log("👉 Test 3: Automatic Retries with Exponential Backoff");
  let fetchAttempts = 0;
  const startRetryTime = Date.now();
  globalThis.fetch = async (url, options) => {
    fetchAttempts++;
    if (fetchAttempts < 3) {
      // Fail first two times with a retriable error (e.g. 500 Internal Server Error)
      return new Response("Internal Server Error", { status: 500 });
    }
    // Succeed on the third attempt
    return new Response(JSON.stringify({
      id: "chatcmpl-test3",
      choices: [{ index: 0, message: { role: "assistant", content: "Succeeded after retries!" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const res3 = await routeRequest(req1, [vaultEntries[0]], { // Only Gemini
    timeout: 5000,
    maxRetries: 1,
    debug: false,
    maxKeyRetries: 3,
    backoffInitialDelayMs: 100, // 100ms, then 200ms
  });

  const totalTime = Date.now() - startRetryTime;
  console.log(`   Total attempts: ${fetchAttempts}`);
  console.log(`   Elapsed time: ${totalTime}ms (Expected ~300ms delay)`);
  if (fetchAttempts === 3 && totalTime >= 300) {
    console.log("   ✅ Test 3 Passed!");
  } else {
    console.error("   ❌ Test 3 Failed!");
  }
  console.log("");

  // ---------------------------------------------------------------------------
  // Test 4: Mid-Stream Failover during Token Streaming
  // ---------------------------------------------------------------------------
  console.log("👉 Test 4: Mid-Stream Failover");
  
  // Custom mock stream helper
  function createMockStream(chunks, shouldFail) {
    return new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          // Small delay between chunks
          await new Promise(r => setTimeout(r, 10));
        }
        if (shouldFail) {
          controller.error(new Error("Network connection dropped mid-stream"));
        } else {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        }
      }
    });
  }

  fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    const isStream = options.body && JSON.parse(options.body).stream;
    fetchCalls.push({ url, isStream, body: JSON.parse(options.body) });

    if (url.includes("googleapis.com")) {
      // Gemini fails mid-stream after emitting part of the content
      const chunks = [
        { id: "stream-id-123", model: "gemini-2.5-flash", choices: [{ index: 0, delta: { content: "Part 1 " }, finish_reason: null }] },
        { id: "stream-id-123", model: "gemini-2.5-flash", choices: [{ index: 0, delta: { content: "Part 2 " }, finish_reason: null }] },
      ];
      return new Response(createMockStream(chunks, true), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    } else {
      // OpenAI (backup) completes successfully
      const chunks = [
        { id: "stream-openai", model: "gpt-4o-mini", choices: [{ index: 0, delta: { content: "Part 3 (Resumed)" }, finish_reason: "stop" }] }
      ];
      return new Response(createMockStream(chunks, false), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
  };

  const req4 = {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Tell me a long story." }],
    stream: true,
  };

  const streamResult = await routeRequest(req4, vaultEntries, {
    timeout: 5000,
    maxRetries: 3,
    debug: false,
    routingStrategy: "cheapest",
  });

  const outputChunks = [];
  for await (const chunk of streamResult) {
    outputChunks.push(chunk);
  }

  console.log(`   Number of fetch calls: ${fetchCalls.length}`);
  console.log(`   Fetch 1 (Primary): ${fetchCalls[0].url}`);
  console.log(`   Fetch 2 (Failover Resumed): ${fetchCalls[1].url}`);
  
  // Verify the failover request payload had the accumulated assistant message appended!
  const backupMessages = fetchCalls[1].body.messages;
  const lastMsg = backupMessages[backupMessages.length - 1];
  console.log(`   Backup Last Message Role: ${lastMsg.role}`);
  console.log(`   Backup Last Message Content: "${lastMsg.content}"`);

  // Verify output text
  const mergedText = outputChunks.map(c => c.choices[0].delta.content || "").join("");
  console.log(`   Complete Stream Output: "${mergedText}"`);

  // Verify consistent chunk IDs and models
  const uniqueIds = new Set(outputChunks.map(c => c.id));
  const uniqueModels = new Set(outputChunks.map(c => c.model));
  console.log(`   Unique Chunk IDs: [${[...uniqueIds].join(", ")}]`);
  console.log(`   Unique Model Names: [${[...uniqueModels].join(", ")}]`);

  const passed =
    fetchCalls.length === 2 &&
    lastMsg.role === "assistant" &&
    lastMsg.content === "Part 1 Part 2 " &&
    mergedText === "Part 1 Part 2 Part 3 (Resumed)" &&
    uniqueIds.size === 1 &&
    uniqueModels.size === 1;

  if (passed) {
    console.log("   ✅ Test 4 Passed!");
  } else {
    console.error("   ❌ Test 4 Failed!");
  }
  console.log("");

  // Restore fetch
  globalThis.fetch = originalFetch;
}

runTests().catch(console.error);
