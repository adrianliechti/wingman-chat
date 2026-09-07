/** One audio operation owns its resources even while browser permission/setup is pending. */
export class AudioResources {
  private controller = new AbortController();
  private cleanups: Array<() => void | Promise<void>> = [];
  private closing?: Promise<void>;
  readonly signal = this.controller.signal;

  own<T>(value: T, release: (value: T) => void | Promise<void>): T {
    if (this.signal.aborted) {
      void this.release(() => release(value));
      this.signal.throwIfAborted();
    }
    this.cleanups.push(() => release(value));
    return value;
  }

  listen(target: EventTarget, event: string, callback: () => void) {
    target.addEventListener(event, callback);
    this.own(callback, () => target.removeEventListener(event, callback));
  }

  /** Stop waiting promptly; own() still disposes resources that arrive after cancellation. */
  wait<T>(pending: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      pending.then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
    });
  }

  close(reason?: unknown): Promise<void> {
    if (!this.closing) {
      this.controller.abort(reason);
      // Start every cleanup synchronously: a slow AudioContext.close must not
      // delay stopping tracks, pausing speakers, or releasing message ports.
      this.closing = Promise.all(
        this.cleanups
          .splice(0)
          .reverse()
          .map((cleanup) => this.release(cleanup)),
      ).then(() => {});
    }
    return this.closing;
  }

  private async release(cleanup: () => void | Promise<void>): Promise<void> {
    try {
      await cleanup();
    } catch {
      /* Already stopped/disconnected resources must not block other cleanup. */
    }
  }
}

export function stopAudioTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* Continue releasing other tracks. */
    }
  }
}

export async function loadAudioWorklet(scope: AudioResources, context: AudioContext, code: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
  try {
    await scope.wait(context.audioWorklet.addModule(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ownAudioNode<T extends AudioNode>(scope: AudioResources, node: T): T {
  return scope.own(node, (node) => node.disconnect());
}

export function ownAudioWorklet(scope: AudioResources, node: AudioWorkletNode): AudioWorkletNode {
  ownAudioNode(scope, node);
  scope.own(node.port, (port) => {
    port.onmessage = null;
    port.close();
  });
  return node;
}
