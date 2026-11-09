import { ImageRenderer, type DrawOptions } from "../../../src/features/canvas/lib/gl/renderer";
import { DEFAULTS, type Adjustments } from "../../../src/features/canvas/lib/recipe";
import { decodeBitmap, renderExport } from "../../../src/features/canvas/lib/exportImage";

function renderer(source: ImageData, floating = true) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false })!;
  if (!floating) {
    const extension = gl.getExtension.bind(gl);
    Object.defineProperty(gl, "getExtension", {
      value: (name: string) => (name === "EXT_color_buffer_float" ? null : extension(name)),
    });
  }
  const instance = new ImageRenderer(canvas, { preserveDrawingBuffer: true });
  instance.setSource(source);
  return {
    draw(patch: Partial<Adjustments> = {}, options?: DrawOptions) {
      const size = instance.draw({ ...DEFAULTS, ...patch }, options);
      const pixels = new Uint8Array(size.width * size.height * 4);
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
      // readPixels is bottom-up; expose the same orientation as ImageData.
      const topDown = new Uint8ClampedArray(pixels.length);
      const stride = size.width * 4;
      for (let y = 0; y < size.height; y++)
        topDown.set(pixels.subarray(y * stride, (y + 1) * stride), (size.height - y - 1) * stride);
      return new ImageData(topDown, size.width, size.height);
    },
    floating: !!gl.getExtension("EXT_color_buffer_float"),
    destroy: () => instance.destroy({ loseContext: true }),
  };
}

const api = { renderer, DEFAULTS, decodeBitmap, renderExport };
declare global {
  interface Window {
    canvasE2E: typeof api;
  }
}
window.canvasE2E = api;
