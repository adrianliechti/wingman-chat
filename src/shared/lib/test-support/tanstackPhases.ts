import { chat, StreamProcessor, uiMessagesToWire, type ModelMessage } from "@tanstack/ai";
import { OpenAITextAdapter } from "@tanstack/ai-openai";
import { finished, response, textItem, user } from "./ai";

/** Exercise the unextended SDK, including persisted UI history. No gateway or sidecar. */
export async function nativePhaseReplay() {
  const requests: { input: Record<string, unknown>[] }[] = [];
  const adapter = new OpenAITextAdapter(
    {
      apiKey: "test-key",
      dangerouslyAllowBrowser: true,
      fetch: async (input, init) => {
        requests.push(await new Request(input, init).json());
        return finished(
          response(
            requests.length === 1
              ? [
                  { ...textItem("Working"), id: "commentary", phase: "commentary" },
                  { ...textItem("Done"), id: "final", phase: "final_answer" },
                ]
              : [textItem("Next")],
            { model: "gpt-5.5" },
          ),
        );
      },
    },
    "gpt-5.5",
  );
  let saved: ModelMessage[] = [];
  const processor = new StreamProcessor({ initialMessages: [user("Go")] });
  await processor.process(
    chat({
      adapter,
      threadId: "phase-test",
      messages: [user("Go")],
      middleware: [
        {
          onFinish(ctx) {
            saved = [...ctx.messages];
          },
        },
      ],
    }),
  );
  const restored = JSON.parse(JSON.stringify(uiMessagesToWire(processor.getMessages())));
  for await (const _ of chat({ adapter, threadId: "phase-test", messages: [...restored, user("Again")] })) {
    /* drain */
  }
  return { saved, replay: requests[1].input.filter((item) => item.role === "assistant") };
}
