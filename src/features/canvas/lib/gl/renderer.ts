import { outputSize, sourceMatrix } from "../geometry";
import type { Adjustments } from "../recipe";
import { BLUR_FRAGMENT, DEVELOP_FRAGMENT, FINISH_FRAGMENT, VERTEX } from "./shaders";

export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RenderSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | ImageData;

export interface DrawOptions {
  /** Show the untouched pixels (still cropped/rotated) instead of the developed ones. */
  original?: boolean;
  /** Output-space x in 0..1; everything left of it shows the original. */
  splitX?: number;
  /** Flatten transparency onto this color (e.g. for JPEG export). */
  matte?: [number, number, number] | null;
}

export interface RendererOptions {
  preserveDrawingBuffer?: boolean;
  onContextLost?: () => void;
}

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

let supported: boolean | undefined;

/** Whether this browser can create a WebGL2 context (cached). */
export function supportsWebGL2(): boolean {
  if (supported !== undefined) return supported;
  try {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    supported = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown error";
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: WebGLShader, fragmentSource: string, names: string[]): Program {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown error";
    gl.deleteProgram(program);
    throw new Error(`Program failed to link: ${log}`);
  }
  const uniforms: Program["uniforms"] = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

/** Source RGBA8 or a render target (half float when the driver supports it). */
function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  image: RenderSource | null = null,
  floating = false,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not create texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  else
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      floating ? gl.RGBA16F : gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      floating ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    gl.deleteTexture(texture);
    throw new Error(`Could not upload a ${width}×${height} texture (GL error ${error})`);
  }
  return texture;
}

function createTarget(gl: WebGL2RenderingContext, width: number, height: number, floating: boolean): Target {
  const texture = createTexture(gl, width, height, null, floating);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    gl.deleteTexture(texture);
    throw new Error("Could not create framebuffer");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`Could not allocate a ${width}×${height} render target`);
  }
  return { texture, framebuffer };
}

/** Column-major copy of a row-major 3×3 matrix, as `uniformMatrix3fv` expects. */
function columnMajor(m: number[]): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/**
 * WebGL2 develop pipeline for one source image: develop pass (tone + color),
 * optional two-pass luminance blur for clarity, and a finish pass that applies
 * geometry and effects while drawing to the canvas. `draw()` is cheap enough
 * to run on every slider move.
 */
export class ImageRenderer {
  readonly canvas: RenderCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly floating: boolean;
  private readonly vertex: WebGLShader;
  private readonly develop: Program;
  private readonly blur: Program;
  private readonly finish: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly positions: WebGLBuffer;
  private source: WebGLTexture | null = null;
  private rendered: Target | null = null;
  private blurX: Target | null = null;
  private blurY: Target | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  private readonly onLost?: () => void;
  private readonly lostListener = (event: Event) => {
    event.preventDefault();
    this.onLost?.();
  };

  constructor(canvas: RenderCanvas, options: RendererOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.canvas = canvas;
    this.gl = gl;
    this.floating = !!gl.getExtension("EXT_color_buffer_float");
    this.onLost = options.onContextLost;
    if ("addEventListener" in canvas) canvas.addEventListener("webglcontextlost", this.lostListener);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    this.develop = link(gl, this.vertex, DEVELOP_FRAGMENT, [
      "u_flip",
      "u_source",
      "u_light",
      "u_tone",
      "u_color",
      "u_mixer",
    ]);
    this.blur = link(gl, this.vertex, BLUR_FRAGMENT, ["u_flip", "u_input", "u_direction", "u_blurSize"]);
    this.finish = link(gl, this.vertex, FINISH_FRAGMENT, [
      "u_flip",
      "u_rendered",
      "u_blurred",
      "u_original",
      "u_matrix",
      "u_effects",
      "u_compare",
      "u_matte",
    ]);
    // A real vertex buffer: attribute-less draws are legal in WebGL2 but not
    // every driver renders them. All three programs share attribute slot 0.
    const vao = gl.createVertexArray();
    const positions = gl.createBuffer();
    if (!vao || !positions) throw new Error("Could not create vertex state");
    this.vao = vao;
    this.positions = positions;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const { program } of [this.develop, this.blur, this.finish]) {
      const location = gl.getAttribLocation(program, "a_position");
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      }
    }
  }

  /** Source dimensions in pixels, or 0×0 before `setSource`. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Upload the pixels every later `draw()` develops. Replaces any previous source. */
  setSource(image: RenderSource): void {
    if (this.disposed) return;
    const gl = this.gl;
    const width = "naturalWidth" in image ? image.naturalWidth : image.width;
    const height = "naturalHeight" in image ? image.naturalHeight : image.height;
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if (width < 1 || height < 1 || width > limit || height > limit) {
      throw new Error(`The ${width}×${height} image exceeds this device's texture limit (${limit} pixels per edge)`);
    }
    const source = createTexture(gl, width, height, image);
    let rendered: Target;
    try {
      rendered = createTarget(gl, width, height, this.floating);
    } catch (error) {
      gl.deleteTexture(source);
      throw error;
    }
    this.releaseTargets();
    if (this.source) gl.deleteTexture(this.source);
    this.source = source;
    this.rendered = rendered;
    this.width = width;
    this.height = height;
  }

  /** Render `recipe` to the canvas; returns the output size in pixels. */
  draw(recipe: Adjustments, options: DrawOptions = {}): { width: number; height: number } {
    const gl = this.gl;
    if (this.disposed || !this.source || !this.rendered) {
      return { width: 0, height: 0 };
    }
    if (gl.isContextLost()) throw new Error("The graphics context was lost");
    const [width, height] = outputSize(recipe.geometry, this.width, this.height);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.bindVertexArray(this.vao);

    // Develop: tone and color at source resolution.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rendered.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.develop.program);
    gl.uniform1f(this.develop.uniforms.u_flip, 0);
    this.bindTexture(0, this.source, this.develop.uniforms.u_source);
    gl.uniform4f(
      this.develop.uniforms.u_light,
      recipe.exposure,
      recipe.contrast / 100,
      recipe.highlights,
      recipe.shadows,
    );
    gl.uniform4f(this.develop.uniforms.u_tone, recipe.whites, recipe.blacks, recipe.temperature, recipe.tint);
    const mixerActive = recipe.mixer.some((band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0);
    gl.uniform4f(
      this.develop.uniforms.u_color,
      recipe.vibrance / 100,
      recipe.saturation / 100,
      recipe.grayscale ? 1 : 0,
      mixerActive ? 1 : 0,
    );
    const mixer = new Float32Array(32);
    recipe.mixer.forEach((band, index) => {
      mixer[index * 4] = (band.hue / 100) * 45;
      mixer[index * 4 + 1] = band.saturation / 100;
      mixer[index * 4 + 2] = band.luminance / 100;
    });
    gl.uniform4fv(this.develop.uniforms.u_mixer, mixer);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Clarity needs a blurred luminance copy of the developed image.
    const useBlur = recipe.clarity !== 0;
    if (useBlur) {
      // Blur at a bounded resolution, with mip-filtered downsampling. The
      // normalized radius stays the same in previews and full-size exports.
      const scale = Math.min(1, 1024 / Math.max(this.width, this.height));
      const bw = Math.max(1, Math.round(this.width * scale));
      const bh = Math.max(1, Math.round(this.height * scale));
      this.blurX ??= createTarget(gl, bw, bh, this.floating);
      this.blurY ??= createTarget(gl, bw, bh, this.floating);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.bindTexture(0, this.rendered.texture, null);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(this.blur.program);
      gl.uniform1f(this.blur.uniforms.u_flip, 0);
      gl.uniform2f(this.blur.uniforms.u_blurSize, bw, bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurX.framebuffer);
      this.bindTexture(0, this.rendered.texture, this.blur.uniforms.u_input);
      gl.uniform2f(this.blur.uniforms.u_direction, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurY.framebuffer);
      this.bindTexture(0, this.blurX.texture, this.blur.uniforms.u_input);
      gl.uniform2f(this.blur.uniforms.u_direction, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Geometry should sample the current developed pixels, never stale mips
    // left over from an earlier draw with clarity enabled.
    gl.bindTexture(gl.TEXTURE_2D, this.rendered.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    // Finish: geometry, effects, compare, matte — straight to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.finish.program);
    gl.uniform1f(this.finish.uniforms.u_flip, 1);
    this.bindTexture(0, this.rendered.texture, this.finish.uniforms.u_rendered);
    this.bindTexture(1, this.blurY?.texture ?? this.rendered.texture, this.finish.uniforms.u_blurred);
    this.bindTexture(2, this.source, this.finish.uniforms.u_original);
    gl.uniformMatrix3fv(
      this.finish.uniforms.u_matrix,
      false,
      columnMajor(sourceMatrix(recipe.geometry, this.width, this.height)),
    );
    gl.uniform4f(this.finish.uniforms.u_effects, recipe.clarity, recipe.dehaze, recipe.vignette, useBlur ? 1 : 0);
    // Pixels left of the split show the original; anything below 0 disables it.
    const split = options.splitX === undefined ? -1 : options.splitX;
    gl.uniform4f(this.finish.uniforms.u_compare, options.original ? 1 : 0, split, 0, 0);
    const matte = options.matte;
    gl.uniform4f(this.finish.uniforms.u_matte, matte?.[0] ?? 0, matte?.[1] ?? 0, matte?.[2] ?? 0, matte ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { width, height };
  }

  /**
   * Free GPU resources. A canvas keeps one WebGL context for its lifetime and
   * a later renderer on the same element reuses it, so the context itself is
   * only lost when the caller owns the canvas (`loseContext`, e.g. export).
   */
  destroy({ loseContext = false }: { loseContext?: boolean } = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if ("removeEventListener" in this.canvas) this.canvas.removeEventListener("webglcontextlost", this.lostListener);
    this.releaseTargets();
    if (this.source) gl.deleteTexture(this.source);
    this.source = null;
    for (const { program } of [this.develop, this.blur, this.finish]) gl.deleteProgram(program);
    gl.deleteShader(this.vertex);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.positions);
    if (loseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private bindTexture(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  private releaseTargets() {
    const gl = this.gl;
    for (const target of [this.rendered, this.blurX, this.blurY]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.rendered = this.blurX = this.blurY = null;
  }
}
