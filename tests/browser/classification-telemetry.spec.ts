import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";

// Use a real HTTP receiver: Playwright routes cannot prove that a fetch survives
// tab closure. Source modules are served by the suite's Vite server.
async function receiver(viteURL: string, receive: (body: string, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<script type="module">
        import { initTelemetry } from "${viteURL}/src/features/repository/lib/telemetry.ts";
        import { recordClassification } from "${viteURL}/src/features/chat/lib/classificationTelemetry.ts";
        initTelemetry("classification-browser-test");
        window.startClassification = () => recordClassification(
          { categories: [{ id: "legal", confidence: 0.9 }], risks: [{ id: "pii", confidence: 0.8 }] },
          { categories: [{ id: "legal" }], risks: [{ id: "pii" }], threshold: 0.6 },
          { conversationId: "conversation-1", model: "classifier" }
        );
        window.deliveryReady = true;
      </script>`);
      return;
    }
    if (request.url !== "/telemetry/v1/metrics") {
      response.end("{}");
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => receive(body, response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing HTTP address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test("an immediate classification export survives normal tab closure", async ({ page, baseURL }) => {
  let pending: ServerResponse | undefined;
  let body = "";
  let finished = false;
  const sink = await receiver(baseURL!, (received, response) => {
    body = received;
    pending = response;
    response.on("finish", () => {
      finished = true;
    });
  });
  try {
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url.includes("/telemetry/v1/metrics")) {
          (window as unknown as { classificationKeepalive: boolean }).classificationKeepalive =
            init?.keepalive === true;
        }
        return original(input, init);
      };
    });
    await page.goto(sink.url);
    await page.waitForFunction(() => (window as unknown as { deliveryReady: boolean }).deliveryReady);
    await page.evaluate(() => (window as unknown as { startClassification: () => void }).startClassification());
    await expect.poll(() => !!pending).toBe(true);
    expect(
      await page.evaluate(() => (window as unknown as { classificationKeepalive: boolean }).classificationKeepalive),
    ).toBe(true);
    const metrics = JSON.parse(body).resourceMetrics[0].scopeMetrics[0].metrics;
    const points = metrics[0].histogram.dataPoints;
    expect(points).toHaveLength(2);
    const attrs = points.map((point: { attributes: { key: string; value: { stringValue?: string } }[] }) =>
      Object.fromEntries(point.attributes.map(({ key, value }) => [key, value.stringValue])),
    );
    expect(attrs[0]["wingman.classification.event_id"]).toBe(attrs[1]["wingman.classification.event_id"]);
    expect(attrs[0]["gen_ai.conversation.id"]).toBe("conversation-1");
    await page.close();
    expect(pending!.destroyed).toBe(false);
    pending!.end("{}");
    await expect.poll(() => finished).toBe(true);
  } finally {
    await sink.close();
  }
});

test("retryable Insights rejection reuses the exact classification export", async ({ page, baseURL }) => {
  const bodies: string[] = [];
  const sink = await receiver(baseURL!, (body, response) => {
    bodies.push(body);
    if (bodies.length === 1) {
      response.writeHead(503, { "Retry-After": "0" });
    }
    response.end("{}");
  });
  try {
    await page.goto(sink.url);
    await page.waitForFunction(() => (window as unknown as { deliveryReady: boolean }).deliveryReady);
    await page.evaluate(() => (window as unknown as { startClassification: () => void }).startClassification());
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toBe(bodies[0]);
  } finally {
    await sink.close();
  }
});
