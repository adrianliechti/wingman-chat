import assert from "node:assert/strict";
import { createServer } from "vite";

export const GATEWAY_URL = process.env.WINGMAN_E2E_GATEWAY ?? process.env.WINGMAN_URL ?? "http://localhost:4242";
export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WINGMAN_E2E_TIMEOUT_MS ?? "90000", 10);

export const Role = { User: "user", Assistant: "assistant" };

/** Scenario inputs may use the compact `{ role, content: [{ type: "text", text }] }` form; runs take native messages. */
export function nativeMessage(message) {
  if (message.parts) return message;
  const parts = message.content.map((part) => {
    if (part.type === "text") return { type: "text", content: part.text };
    const match = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/.exec(part.data);
    const kind = part.type === "file" ? "document" : part.type;
    return {
      type: kind,
      source: match ? { type: "data", value: match[2], mimeType: match[1] } : { type: "url", value: part.data },
      metadata: {
        ...(part.name ? { filename: part.name } : {}),
        ...(part.contentType ? { contentType: part.contentType } : {}),
      },
    };
  });
  return { id: message.id ?? crypto.randomUUID(), role: message.role, parts };
}

export function user(text) {
  return nativeMessage({ role: "user", content: [{ type: "text", text }] });
}

export function messageText(messages) {
  return messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

export function lastAssistantText(messages) {
  const assistant = messages.findLast((message) => message.role === "assistant");
  return (assistant?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

export function chunkTypes(events) {
  return events.map((event) => event.type);
}

/** Record native middleware events and iteration counts for gateway assertions. */
export function observeRun(events) {
  events.modelCalls = 0;
  return {
    onIteration() {
      events.modelCalls++;
    },
    onChunk(_ctx, chunk) {
      events.push(chunk);
    },
  };
}

export function resultDetail(result) {
  return result.error ? JSON.stringify(result.error) : result.status;
}

/**
 * Parts of one kind across the transcript, by the scenario's legacy names:
 * "reasoning" yields the gateway reasoning state (text, summary, encryptedContent, model),
 * "tool_result" yields tool-result parts with their call's name and arguments attached.
 */
export function contentParts(messages, type) {
  const parts = messages.flatMap((message) => message.parts);
  if (type === "reasoning")
    return parts
      .filter((part) => part.type === "thinking")
      .map((part) => ({ ...part, ...readReasoning(part.signature) }));
  if (type === "tool_call") return parts.filter((part) => part.type === "tool-call");
  if (type === "tool_result") {
    const calls = new Map(parts.filter((part) => part.type === "tool-call").map((part) => [part.id, part]));
    return parts
      .filter((part) => part.type === "tool-result")
      .map((part) => ({
        ...part,
        id: part.toolCallId,
        name: calls.get(part.toolCallId)?.name,
        arguments: calls.get(part.toolCallId)?.arguments,
        meta: part.metadata?.meta,
      }));
  }
  return parts.filter((part) => part.type === type);
}

function readReasoning(signature) {
  if (!signature) return {};
  try {
    const value = JSON.parse(signature);
    return {
      id: value.id,
      encryptedContent: value.encrypted_content,
      text: value.wingman?.text,
      summary: value.wingman?.summary,
      model: value.wingman?.model,
    };
  } catch {
    return {};
  }
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
 * through to the normal Vite proxy so an explicit retry can be tested while
 * keeping the failure deterministic.
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
  let clientModule;
  let agentModule;
  let client;
  let availableModels;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert(address && typeof address !== "string", "Vite E2E proxy did not bind to a TCP port");
    globalThis.window = { location: { origin: `http://127.0.0.1:${address.port}` } };
    clientModule = await vite.ssrLoadModule("/src/shared/lib/client.ts");
    agentModule = await vite.ssrLoadModule("/src/shared/lib/agent.ts");
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
    run: (client, model, instructions, messages, tools, hooks) =>
      agentModule.run(client, model, instructions, messages.map(nativeMessage), tools, hooks),
    Role,
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
