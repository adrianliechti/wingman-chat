import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const audioFile =
  process.env.WINGMAN_FAKE_MIC_FILE || fileURLToPath(new URL("./fixtures/voice-hi.wav", import.meta.url));
const baseURL = process.env.WINGMAN_WEB_URL || "http://localhost:5173";
const mode = process.env.WINGMAN_PROBE_MODE || "full";
const enableStudio = process.env.WINGMAN_PROBE_STUDIO === "1";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${audioFile}`,
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const receivedEvents = new Set();
const apiErrors = [];
const pageErrors = [];
const dialogs = [];

await page.addInitScript(({ probeMode, studioEnabled }) => {
  if (studioEnabled) {
    localStorage.setItem("app_tools", JSON.stringify(["studio"]));
    // Studio contributes its own format/generator skill pack. Keep the global
    // personal/catalog sources off so this probe is deterministic.
    localStorage.setItem("app_skills", JSON.stringify([]));
  }

  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function patchedSend(data) {
    if (typeof data === "string") {
      try {
        const event = JSON.parse(data);
        if (event.type === "session.update") {
          if (
            probeMode === "simple" ||
            probeMode === "no-tools" ||
            probeMode === "core-instructions" ||
            probeMode === "studio-instructions" ||
            probeMode.startsWith("studio-sections-") ||
            probeMode.startsWith("studio-workflow-item-") ||
            probeMode.startsWith("studio-images-part-") ||
            probeMode.startsWith("studio-quality-item-") ||
            probeMode === "skills-instructions" ||
            probeMode === "skills-guidance" ||
            probeMode === "skills-catalog" ||
            probeMode === "artifacts-instructions" ||
            probeMode === "artifact-files" ||
            probeMode === "artifact-interpreter" ||
            probeMode === "artifact-create-guidance" ||
            probeMode === "artifact-chat-guidance" ||
            probeMode === "artifact-intro" ||
            probeMode === "artifact-create-list" ||
            probeMode === "artifact-create-types" ||
            probeMode === "artifact-create-publish" ||
            probeMode === "artifact-data" ||
            probeMode === "artifact-publish-line" ||
            probeMode.startsWith("artifact-section-")
          ) {
            event.session.tools = [];
          }
          if (probeMode === "simple" || probeMode === "no-instructions") {
            event.session.instructions = "You are a concise, helpful voice assistant.";
          }
          if (typeof event.session.instructions === "string") {
            const studioMarker = event.session.instructions.indexOf("## Studio");
            const skillsMarker = event.session.instructions.indexOf("## Skills");
            const marker = event.session.instructions.indexOf("## Artifacts");
            if (probeMode === "studio-instructions" && studioMarker >= 0) {
              const end = skillsMarker >= 0 ? skillsMarker : marker;
              event.session.instructions =
                "You are a concise, helpful voice assistant.\n\n" +
                event.session.instructions.slice(studioMarker, end >= 0 ? end : undefined);
            }
            if (probeMode.startsWith("studio-sections-") && studioMarker >= 0) {
              const match = /^studio-sections-(\d+)-(\d+)$/.exec(probeMode);
              const boundaries = [
                studioMarker,
                event.session.instructions.indexOf("### Workflow", studioMarker),
                event.session.instructions.indexOf("### Working with the user", studioMarker),
                event.session.instructions.indexOf("### Runtime", studioMarker),
                event.session.instructions.indexOf("### Which skill to read", studioMarker),
                event.session.instructions.indexOf("### Choosing a visual", studioMarker),
                event.session.instructions.indexOf("### Images", studioMarker),
                event.session.instructions.indexOf("### Capability vs generator routing", studioMarker),
                event.session.instructions.indexOf("### Quality bar", studioMarker),
                event.session.instructions.indexOf("### Tweaks", studioMarker),
                event.session.instructions.indexOf("### Iterate", studioMarker),
                skillsMarker >= 0 ? skillsMarker : marker,
              ];
              const startIndex = match ? Number(match[1]) : -1;
              const endIndex = match ? Number(match[2]) : -1;
              if (
                startIndex >= 0 &&
                endIndex > startIndex &&
                boundaries[startIndex] >= 0 &&
                boundaries[endIndex] >= 0
              ) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" +
                  event.session.instructions.slice(boundaries[startIndex], boundaries[endIndex]);
              }
            }
            const selectIndexedStudioPart = (prefix, boundaries) => {
              if (!probeMode.startsWith(prefix)) return;
              const index = Number(probeMode.slice(prefix.length));
              if (
                Number.isInteger(index) &&
                index >= 0 &&
                index + 1 < boundaries.length &&
                boundaries[index] >= 0 &&
                boundaries[index + 1] >= 0
              ) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" +
                  event.session.instructions.slice(boundaries[index], boundaries[index + 1]);
              }
            };
            selectIndexedStudioPart("studio-workflow-item-", [
              event.session.instructions.indexOf("1. **Get the content first.**", studioMarker),
              event.session.instructions.indexOf("2. **Read the skill", studioMarker),
              event.session.instructions.indexOf("3. **Choose the runtime", studioMarker),
              event.session.instructions.indexOf("4. **Verify the requested", studioMarker),
              event.session.instructions.indexOf("5. **Hand off briefly", studioMarker),
              event.session.instructions.indexOf("### Working with the user", studioMarker),
            ]);
            selectIndexedStudioPart("studio-images-part-", [
              event.session.instructions.indexOf("### Images", studioMarker),
              event.session.instructions.indexOf("Route on where the image lives:", studioMarker),
              event.session.instructions.indexOf("- **Standalone image**", studioMarker),
              event.session.instructions.indexOf("- **Image inside a larger build**", studioMarker),
              event.session.instructions.indexOf("- **A whole poster**", studioMarker),
              event.session.instructions.indexOf("For a rendition of the user", studioMarker),
              event.session.instructions.indexOf("### Capability vs generator routing", studioMarker),
            ]);
            selectIndexedStudioPart("studio-quality-item-", [
              event.session.instructions.indexOf("### Quality bar", studioMarker),
              event.session.instructions.indexOf("- **Real, source-grounded data only.**", studioMarker),
              event.session.instructions.indexOf("- **Art direction is additive", studioMarker),
              event.session.instructions.indexOf("- **Diagrams prioritize meaning.**", studioMarker),
              event.session.instructions.indexOf("### Tweaks", studioMarker),
            ]);
            if (probeMode === "skills-instructions" && skillsMarker >= 0) {
              event.session.instructions =
                "You are a concise, helpful voice assistant.\n\n" +
                event.session.instructions.slice(skillsMarker, marker >= 0 ? marker : undefined);
            }
            if ((probeMode === "skills-guidance" || probeMode === "skills-catalog") && skillsMarker >= 0) {
              const catalogMarker = event.session.instructions.indexOf("<available_skills>", skillsMarker);
              const start = probeMode === "skills-guidance" ? skillsMarker : catalogMarker;
              const end = probeMode === "skills-guidance" ? catalogMarker : marker;
              if (start >= 0 && end >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(start, end);
              }
            }
            if (probeMode === "core-instructions" && marker >= 0) {
              event.session.instructions = event.session.instructions.slice(0, marker);
            }
            if (probeMode === "artifacts-instructions" && marker >= 0) {
              event.session.instructions =
                "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(marker);
            }
            const interpreterMarker = event.session.instructions.indexOf("## Code Interpreter");
            if (probeMode === "artifact-files" && marker >= 0) {
              const end = interpreterMarker >= 0 ? interpreterMarker : event.session.instructions.length;
              event.session.instructions =
                "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(marker, end);
            }
            if (probeMode === "artifact-interpreter" && interpreterMarker >= 0) {
              event.session.instructions =
                "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(interpreterMarker);
            }
            if (probeMode.startsWith("artifact-section-") && marker >= 0) {
              const headings = [
                marker,
                event.session.instructions.indexOf("### Working with files", marker),
                event.session.instructions.indexOf("### Files the user gives you", marker),
                event.session.instructions.indexOf("### Preview support", marker),
                interpreterMarker >= 0 ? interpreterMarker : event.session.instructions.length,
              ];
              const index = Number(probeMode.slice("artifact-section-".length));
              if (index >= 1 && index <= 4 && headings[index - 1] >= 0 && headings[index] >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" +
                  event.session.instructions.slice(headings[index - 1], headings[index]);
              }
            }
            if (
              (probeMode === "artifact-create-guidance" || probeMode === "artifact-chat-guidance") &&
              marker >= 0
            ) {
              const chatMarker = event.session.instructions.indexOf("### When to just answer in chat", marker);
              const workingMarker = event.session.instructions.indexOf("### Working with files", marker);
              const start = probeMode === "artifact-create-guidance" ? marker : chatMarker;
              const end = probeMode === "artifact-create-guidance" ? chatMarker : workingMarker;
              if (start >= 0 && end >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(start, end);
              }
            }
            if ((probeMode === "artifact-intro" || probeMode === "artifact-create-list") && marker >= 0) {
              const createMarker = event.session.instructions.indexOf("### When to create a file", marker);
              const chatMarker = event.session.instructions.indexOf("### When to just answer in chat", marker);
              const start = probeMode === "artifact-intro" ? marker : createMarker;
              const end = probeMode === "artifact-intro" ? createMarker : chatMarker;
              if (start >= 0 && end >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(start, end);
              }
            }
            if (
              (probeMode === "artifact-create-types" || probeMode === "artifact-create-publish") &&
              marker >= 0
            ) {
              const createMarker = event.session.instructions.indexOf("### When to create a file", marker);
              const dataMarker = event.session.instructions.indexOf("- Data —", createMarker);
              const chatMarker = event.session.instructions.indexOf("### When to just answer in chat", marker);
              const start = probeMode === "artifact-create-types" ? createMarker : dataMarker;
              const end = probeMode === "artifact-create-types" ? dataMarker : chatMarker;
              if (start >= 0 && end >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(start, end);
              }
            }
            if ((probeMode === "artifact-data" || probeMode === "artifact-publish-line") && marker >= 0) {
              const dataMarker = event.session.instructions.indexOf("- Data —", marker);
              const publishMarker = event.session.instructions.indexOf("- Short publishable prose", dataMarker);
              const chatMarker = event.session.instructions.indexOf("### When to just answer in chat", marker);
              const start = probeMode === "artifact-data" ? dataMarker : publishMarker;
              const end = probeMode === "artifact-data" ? publishMarker : chatMarker;
              if (start >= 0 && end >= 0) {
                event.session.instructions =
                  "You are a concise, helpful voice assistant.\n\n" + event.session.instructions.slice(start, end);
              }
            }
          }
          data = JSON.stringify(event);
        }
      } catch {
        // Forward non-JSON frames unchanged.
      }
    }
    return originalSend.call(this, data);
  };
}, { probeMode: mode, studioEnabled: enableStudio });

page.on("console", async (message) => {
  const text = message.text();
  if (text.startsWith("Compiled Tools from Providers:") || text.startsWith("Compiled Instructions:")) {
    console.log(`[browser:${message.type()}] ${text.split(":")[0]} (suppressed)`);
    return;
  }
  const values = [];
  for (const argument of message.args()) {
    try {
      values.push(await argument.jsonValue());
    } catch {
      values.push(argument.toString());
    }
  }
  const rendered = values.map((value) => {
    if (typeof value === "string") return value;
    const json = JSON.stringify(value);
    return json.length > 4_000 ? `${json.slice(0, 4_000)}…` : json;
  });
  if (values[0] === "Received message:" && typeof values[1] === "string") {
    receivedEvents.add(values[1]);
  }
  if (values[0] === "[voice] API error:") {
    apiErrors.push(values[1]);
  }
  console.log(`[browser:${message.type()}]`, ...rendered);
});
page.on("dialog", async (dialog) => {
  dialogs.push(dialog.message());
  console.log(`[browser:dialog] ${dialog.message()}`);
  await dialog.dismiss();
});
page.on("pageerror", (error) => {
  pageErrors.push(error);
  console.log(`[browser:pageerror] ${error.stack || error.message}`);
});

await page.goto(baseURL, { waitUntil: "networkidle" });
console.log(`[probe] mode=${mode} studio=${enableStudio}`);
await page.getByRole("button", { name: "Start voice mode" }).click();
await page.waitForTimeout(Number(process.env.WINGMAN_VOICE_WAIT_MS || 20_000));

console.log("[browser:body]", (await page.locator("body").innerText()).slice(0, 2_000));
await browser.close();

if (mode === "full") {
  const required = [
    "session.created",
    "session.updated",
    "conversation.item.input_audio_transcription.completed",
    "response.created",
    "response.output_audio.delta",
    "response.done",
  ];
  const missing = required.filter((event) => !receivedEvents.has(event));
  if (apiErrors.length > 0 || dialogs.some((message) => message.startsWith("Voice mode stopped:")) || pageErrors.length > 0) {
    throw new Error(
      `real voice browser probe failed: apiErrors=${JSON.stringify(apiErrors)}, dialogs=${JSON.stringify(dialogs)}, pageErrors=${pageErrors.map((error) => error.message).join("; ")}`,
    );
  }
  if (missing.length > 0) {
    throw new Error(`real voice browser probe missing events: ${missing.join(", ")}`);
  }
  console.log(`[probe] PASS ${required.join(" -> ")}`);
}
