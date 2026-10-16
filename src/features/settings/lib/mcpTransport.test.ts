import type { Transport, JSONRPCRequest, ElicitResult } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { browserMcpTransport } from "./mcpTransport";

function fixture() {
  let answer!: (result: ElicitResult) => void;
  const send = vi.fn<Transport["send"]>().mockResolvedValue();
  const transport: Transport = { start: async () => {}, close: async () => {}, send };
  const elicit = vi.fn(
    () =>
      new Promise<ElicitResult>((resolve) => {
        answer = resolve;
      }),
  );
  const bridge = browserMcpTransport(transport, { elicit, initialized() {}, notification() {}, closed() {} });
  const response = vi.fn();
  bridge.onmessage = response;
  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "ask", _meta: { progressToken: 5 } },
  };
  const ask = (id: string | number = 5) =>
    transport.onmessage!({
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "input_required",
        inputRequests: {
          choice: {
            method: "elicitation/create",
            params: { message: "Choose", requestedSchema: { type: "object", properties: {} } },
          },
        },
        requestState: "state",
      },
    });
  return { bridge, send, elicit, response, request, ask, answer: (result: ElicitResult) => answer(result) };
}

it.each(["cancel", "close", "abort"])("does not retry when a late elicitation answer follows %s", async (reason) => {
  const f = fixture();
  const controller = new AbortController();
  await f.bridge.send(f.request, { requestSignal: controller.signal });
  f.ask();
  expect(f.elicit).toHaveBeenCalledOnce();
  if (reason === "cancel")
    await f.bridge.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 5 } });
  if (reason === "close") await f.bridge.close();
  if (reason === "abort") controller.abort();
  f.answer({ action: "accept" });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.send.mock.calls.filter(([message]) => "method" in message && message.method === "tools/call")).toHaveLength(
    1,
  );
  expect(f.response).not.toHaveBeenCalled();
});

it("preserves the request abort signal and redirects cancellation to the active retry", async () => {
  const f = fixture();
  const controller = new AbortController();
  await f.bridge.send(f.request, { requestSignal: controller.signal });
  f.ask();
  f.answer({ action: "accept" });
  await Promise.resolve();
  await Promise.resolve();
  const [retry, options] = f.send.mock.calls[1];
  expect(options?.requestSignal).toBe(controller.signal);
  expect(retry).toMatchObject({ params: { requestState: "state", _meta: { progressToken: 5 } } });
  await f.bridge.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 5 } });
  expect(f.send).toHaveBeenLastCalledWith(
    { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "id" in retry ? retry.id : undefined } },
    undefined,
  );
});
