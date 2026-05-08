/**
 * Attaches a ResizeObserver to `container` and keeps `iframe` width in sync with it.
 * Height is intentionally left unmanaged so the app can control it via its own
 * size-change events and the container can scroll vertically when needed.
 * Returns a cleanup function that disconnects the observer and removes the inline style.
 */
export function fitIframeToContainer(iframe: HTMLIFrameElement, container: HTMLElement): () => void {
  let rafId: number | null = null;

  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const width = entry.contentRect.width;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      iframe.style.width = `${width}px`;
    });
  });

  observer.observe(container);

  // Apply immediately using the current size
  iframe.style.width = `${container.getBoundingClientRect().width}px`;

  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    observer.disconnect();
    iframe.style.width = "";
  };
}
