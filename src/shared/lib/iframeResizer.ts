/**
 * Attaches a ResizeObserver to `container` and keeps `iframe` width in sync with it.
 * Height is intentionally left unmanaged so the app can control it via its own
 * size-change events and the container can scroll vertically when needed.
 * Returns a cleanup function that disconnects the observer and removes the inline style.
 */
export function fitIframeToContainer(
  iframe: HTMLIFrameElement,
  container: HTMLElement,
): () => void {
  const applyWidth = (entry: ResizeObserverEntry) => {
    iframe.style.width = `${entry.contentRect.width}px`;
  };

  const observer = new ResizeObserver(([entry]) => {
    if (entry) applyWidth(entry);
  });

  observer.observe(container);

  // Apply immediately using the current size
  iframe.style.width = `${container.getBoundingClientRect().width}px`;

  return () => {
    observer.disconnect();
    iframe.style.width = "";
  };
}
