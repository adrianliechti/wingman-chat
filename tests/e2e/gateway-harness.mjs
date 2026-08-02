import assert from "node:assert/strict";
import { createServer } from "vite";

export const GATEWAY_URL = process.env.WINGMAN_E2E_GATEWAY ?? process.env.WINGMAN_URL ?? "http://localhost:8080";
export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WINGMAN_E2E_TIMEOUT_MS ?? "90000", 10);

export function messageText(messages) {
  return messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function lastAssistantText(messages) {
  const assistant = messages.findLast((message) => message.role === "assistant");
  return (assistant?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function lifecycleTypes(events) {
  return events.map((event) => event.type);
}

export function resultDetail(result) {
  return result.error ? JSON.stringify(result.error) : `${result.status}/${result.stopReason}`;
}

export function contentParts(messages, type) {
  return messages.flatMap((message) => message.content).filter((part) => part.type === type);
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function partialSseThroughTextDelta(buffer, waitForText) {
  const marker = "response.output_text.delta";
  const markerIndex = buffer.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const targetIndex = waitForText ? buffer.indexOf(waitForText, markerIndex) : markerIndex;
  if (targetIndex < 0) return undefined;
  const tail = buffer.slice(targetIndex);
  const boundary = /\r?\n\r?\n/.exec(tail);
  return boundary ? buffer.slice(0, targetIndex + boundary.index + boundary[0].length) : undefined;
}

/**
 * One-shot fault injector for `/v1/responses` streams. The first armed request
 * is forwarded to the real gateway until a text delta arrives, then the client
 * connection is cut without a terminal SSE event. The next request falls
 * through to the normal Vite proxy, exercising the application's real retry
 * path while keeping the failure deterministic.
 */
export function createResponseFaultInjector() {
  let armed;
  let requestCount = 0;
  let droppedCount = 0;

  const plugin = {
    name: "gateway-e2e-response-fault",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || !req.url?.startsWith("/api/v1/responses")) return next();
        requestCount++;
        if (!armed) return next();

        const fault = armed;
        armed = undefined;
        const upstreamController = new AbortController();

        try {
          const body = await requestBody(req);
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (
              value === undefined ||
              ["connection", "content-length", "host", "transfer-encoding"].includes(name.toLowerCase())
            )
              continue;
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          headers.set("authorization", `Bearer ${process.env.WINGMAN_TOKEN || "none"}`);

          const upstream = await fetch(`${GATEWAY_URL.replace(/\/$/, "")}/v1/responses`, {
            method: "POST",
            headers,
            body,
            signal: upstreamController.signal,
          });
          res.statusCode = upstream.status;
          for (const name of ["cache-control", "content-type", "openai-processing-ms", "x-request-id"]) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
          }
          res.flushHeaders();

          assert(upstream.body, "The real gateway returned no response stream");
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffered = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            const partial = partialSseThroughTextDelta(buffered, fault.waitForText);
            if (!partial) continue;

            await new Promise((resolve, reject) => {
              res.write(partial, (error) => (error ? reject(error) : resolve()));
            });
            // Give the downstream SSE parser a chance to publish the partial
            // delta before making the socket failure observable.
            await new Promise((resolve) => setTimeout(resolve, 25));
            droppedCount++;
            fault.onDrop?.();
            upstreamController.abort("Injected E2E response-stream drop");
            res.destroy(new Error("Injected E2E response-stream drop"));
            return;
          }

          // A provider may return no text delta (for example, a refusal). Still
          // fail the stream before a clean terminal response so retry behavior
          // remains under test rather than silently passing the first attempt.
          droppedCount++;
          fault.onDrop?.();
          res.destroy(new Error("Injected E2E response-stream drop before text delta"));
        } catch (error) {
          if (upstreamController.signal.aborted || res.destroyed) return;
          res.destroy(error instanceof Error ? error : new Error(String(error)));
        } finally {
          upstreamController.abort();
        }
      });
    },
  };

  return {
    plugin,
    dropNext(options = {}) {
      assert(!armed, "A response-stream fault is already armed");
      armed = options;
    },
    snapshot() {
      return { requestCount, droppedCount, armed: Boolean(armed) };
    },
  };
}

export async function startGatewayHarness(options = {}) {
  process.env.WINGMAN_URL = GATEWAY_URL.replace(/\/$/, "");
  const vite = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    ...(options.plugins?.length ? { plugins: options.plugins } : {}),
  });
  await vite.listen();

  const address = vite.httpServer?.address();
  assert(address && typeof address !== "string", "Vite E2E proxy did not bind to a TCP port");
  globalThis.window = { location: { origin: `http://127.0.0.1:${address.port}` } };

  let clientModule;
  let agentModule;
  let controllerModule;
  let chatModule;
  let client;
  let availableModels;
  try {
    clientModule = await vite.ssrLoadModule("/src/shared/lib/client.ts");
    agentModule = await vite.ssrLoadModule("/src/shared/lib/agent.ts");
    controllerModule = await vite.ssrLoadModule("/src/shared/lib/agent-run-controller.ts");
    chatModule = await vite.ssrLoadModule("/src/shared/types/chat.ts");
    client = new clientModule.Client();
    availableModels = await client.listModels();
  } catch (error) {
    delete globalThis.window;
    await vite.close();
    throw error;
  }

  return {
    vite,
    client,
    run: agentModule.run,
    AgentInvocationContext: controllerModule.AgentInvocationContext,
    Role: chatModule.Role,
    availableModels,
    async close() {
      delete globalThis.window;
      await vite.close();
    },
  };
}

export function assertModelsAvailable(availableModels, modelIds) {
  const available = new Set(availableModels.map((model) => model.id));
  const missing = modelIds.filter((model) => !available.has(model));
  assert.equal(
    missing.length,
    0,
    `Challenge model(s) not exposed by ${GATEWAY_URL}: ${missing.join(", ")}. Available: ${[...available].join(", ")}`,
  );
}
