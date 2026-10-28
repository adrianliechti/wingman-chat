// @vitest-environment happy-dom
import { act, useContext } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ScreenCaptureProvider } from "./ScreenCaptureProvider";
import { ScreenCaptureContext, type ScreenCaptureContextType } from "./ScreenCaptureContext";

const state = vi.hoisted(() => ({ vision: true }));
vi.mock("@/features/chat/hooks/useChat", () => ({
  useChatModel: () => ({ model: { id: "selected" }, models: [{ id: "selected", supportsVision: state.vision }] }),
}));

it("releases a late screen permission grant after switching to a text-only model", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let grant!: (stream: MediaStream) => void;
  const getDisplayMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
  );
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
  const container = document.createElement("div");
  const root = createRoot(container);
  let capture!: ScreenCaptureContextType;
  function Consumer() {
    capture = useContext(ScreenCaptureContext)!;
    return null;
  }
  try {
    state.vision = true;
    await act(async () =>
      root.render(
        <ScreenCaptureProvider>
          <Consumer />
        </ScreenCaptureProvider>,
      ),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = capture.startCapture();
    });
    state.vision = false;
    await act(async () =>
      root.render(
        <ScreenCaptureProvider>
          <Consumer />
        </ScreenCaptureProvider>,
      ),
    );
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await act(async () => pending);
    expect(stop).toHaveBeenCalledOnce();
    expect(capture.isActive).toBe(false);
    expect(capture.isAvailable).toBe(false);
    await capture.startCapture();
    expect(getDisplayMedia).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
