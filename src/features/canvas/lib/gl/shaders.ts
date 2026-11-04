// GLSL ES 3.00 sources for the develop pipeline. Textures hold sRGB-encoded
// pixels (row 0 = image top); the develop pass decodes to linear light,
// edits, and stores premultiplied, encoded RGB. Intermediate targets use half
// floats when available. Inspired by Aperture and RapidRAW's luminance edits.

// One triangle covering clip space; the buffer holds (-1,-1) (3,-1) (-1,3).
export const VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 a_position;
uniform float u_flip;
out vec2 v_uv;
void main() {
  vec2 uv = a_position * 0.5 + 0.5;
  v_uv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flip));
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
vec3 decode(vec3 c) {
  return mix(c / 12.92, pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4)), step(vec3(0.04045), c));
}
vec3 encode(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 withLuma(vec3 rgb, float target) {
  float l = luma(rgb);
  return l > 1.0e-7 ? rgb * (target / l) : vec3(target);
}
// Fit chroma around the neutral axis instead of clipping RGB channels
// independently (which changes hue and destroys colored highlight detail).
vec3 gamutMap(vec3 rgb) {
  float l = clamp(luma(rgb), 0.0, 1.0);
  vec3 chroma = rgb - vec3(luma(rgb));
  float scale = 1.0;
  for (int i = 0; i < 3; i++) {
    if (chroma[i] > 0.0) scale = min(scale, (1.0 - l) / chroma[i]);
    else if (chroma[i] < 0.0) scale = min(scale, -l / chroma[i]);
  }
  return clamp(vec3(l) + chroma * scale, 0.0, 1.0);
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const DEVELOP_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
// exposure (EV), contrast (-1..1), highlights, shadows (-100..100)
uniform vec4 u_light;
// whites, blacks, temperature, tint (-100..100)
uniform vec4 u_tone;
// vibrance (-1..1), saturation (-1..1), grayscale (0/1), mixer active (0/1)
uniform vec4 u_color;
// per band: hue shift (degrees), saturation (-1..1), luminance (-1..1)
uniform vec4 u_mixer[8];
${COMMON}
const float BAND_HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 315.0);

float bandInfluence(float hue, float center) {
  float d = abs(hue - center);
  d = min(d, 360.0 - d);
  return 1.0 - smoothstep(0.0, 45.0, d);
}

vec3 applyContrast(vec3 rgb, float con) {
  if (con == 0.0) return rgb;
  float l = luma(rgb);
  if (l <= 0.0 || l >= 1.0) return rgb;
  float p = encode(vec3(l)).r;
  float s = pow(2.0, con * 1.25);
  float curved = p < 0.5 ? 0.5 * pow(2.0 * p, s) : 1.0 - 0.5 * pow(2.0 * (1.0 - p), s);
  return withLuma(rgb, decode(vec3(curved)).r);
}

// Both branches have positive derivatives and meet the untouched range with
// slope 1. Sequential curves keep ramps ordered even at combined extremes.
float upperTone(float l, float pivot, float amount, float strength) {
  float x = max(l - pivot, 0.0);
  if (amount < 0.0) return min(l, pivot) + x / (1.0 - amount * strength * x);
  return l + amount * strength * x * x;
}
vec3 applyTone(vec3 rgb) {
  float l = luma(rgb);
  float x = clamp(l / 0.5, 0.0, 1.0);
  float shadows = u_light.w / 100.0;
  float strength = shadows > 0.0 ? 2.0 : 0.85;
  float target = l + 0.5 * shadows * strength * x * (1.0 - x) * (1.0 - x);
  target = upperTone(target, 0.18, u_light.z / 100.0, 1.5);
  target = upperTone(target, 0.6, u_tone.x / 100.0, 2.5);
  rgb = withLuma(rgb, target);
  float black = u_tone.y * 0.00045 * (1.0 - smoothstep(0.0, 0.25, target));
  // A luminance offset avoids clipping individual channels on a black cut.
  return black > 0.0 ? rgb + black : withLuma(rgb, max(0.0, target + black));
}

vec3 applyCreativeColor(vec3 rgb, float sat, float vib) {
  if (sat == 0.0 && vib == 0.0) return rgb;
  vec3 safe = max(rgb, vec3(0.0));
  float l = luma(safe);
  vec3 hsv = rgb2hsv(encode(safe));
  float vibFactor = 0.0;
  if (vib > 0.0) {
    float satWeight = pow(max(1.0 - hsv.y, 0.0), 1.25);
    float hue = hsv.x * 360.0;
    float skinDist = min(abs(hue - 25.0), 360.0 - abs(hue - 25.0));
    float isSkin = 1.0 - smoothstep(12.0, 38.0, skinDist);
    vibFactor = vib * satWeight * mix(1.0, 0.5, isSkin) * 1.5;
  } else if (vib < 0.0) {
    vibFactor = vib * smoothstep(0.05, 0.75, hsv.y);
  }
  float m = max(1.0 + sat, 0.0) * max(1.0 + vibFactor, 0.0);
  // Keep luminance and hue when increased chroma reaches the RGB boundary.
  vec3 result = mix(vec3(l), safe, m);
  float low = min(result.r, min(result.g, result.b));
  if (low < 0.0) result = mix(vec3(l), result, l / (l - low));
  return result;
}

vec3 applyMixer(vec3 rgb) {
  vec3 safe = max(rgb, vec3(0.0));
  vec3 hsv = rgb2hsv(encode(safe));
  float satMask = smoothstep(0.05, 0.2, hsv.y);
  float lumWeight = smoothstep(0.0, 1.0, hsv.y);
  if (satMask < 0.001 && lumWeight < 0.001) return safe;
  float hue = hsv.x * 360.0;
  float total = 0.0;
  float influence[8];
  for (int i = 0; i < 8; i++) {
    influence[i] = bandInfluence(hue, BAND_HUES[i]);
    total += influence[i];
  }
  total = max(total, 1.0e-4);
  float hueShift = 0.0;
  float satMul = 0.0;
  float lumAdj = 0.0;
  for (int i = 0; i < 8; i++) {
    float n = influence[i] / total;
    hueShift += u_mixer[i].x * n * satMask;
    satMul += u_mixer[i].y * n * satMask;
    lumAdj += u_mixer[i].z * 0.7 * n * lumWeight;
  }
  float l0 = luma(safe);
  float target = max(l0 * (1.0 + lumAdj), 0.0);
  float newSat = clamp(hsv.y * (1.0 + satMul), 0.0, 1.0);
  if (newSat < 1.0e-4) return vec3(target);
  vec3 shifted = decode(hsv2rgb(vec3(fract((hue + hueShift) / 360.0), newSat, hsv.z)));
  float l1 = luma(shifted);
  if (l1 < 1.0e-4) return vec3(target);
  return shifted * (target / l1);
}

vec3 toGray(vec3 rgb) {
  vec3 safe = max(rgb, vec3(0.0));
  float g = luma(safe);
  if (u_color.w > 0.5) {
    vec3 hsv = rgb2hsv(encode(safe));
    float gate = smoothstep(0.05, 0.4, hsv.y) * smoothstep(0.0, 0.1, hsv.y * hsv.z);
    if (gate > 0.0) {
      float hue = hsv.x * 360.0;
      float total = 0.0;
      float mixv = 0.0;
      for (int i = 0; i < 8; i++) {
        float w = bandInfluence(hue, BAND_HUES[i]);
        total += w;
        mixv += w * clamp(u_mixer[i].z, -1.0, 1.0);
      }
      if (total > 0.0) g *= exp2(mixv / total * gate * 1.5);
    }
  }
  return vec3(g);
}

void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 rgb = decode(src.rgb);
  float exposure = u_light.x;
  float temperature = u_tone.z;
  float tint = u_tone.w;
  rgb *= exp2(vec3(
    exposure + temperature * 0.006 + tint * 0.0015,
    exposure - tint * 0.003,
    exposure - temperature * 0.006 + tint * 0.0015));
  rgb = applyTone(rgb);
  rgb = applyContrast(rgb, u_light.y);
  if (u_color.z > 0.5) {
    rgb = toGray(rgb);
  } else {
    rgb = applyCreativeColor(rgb, u_color.y, u_color.x);
    if (u_color.w > 0.5) rgb = applyMixer(rgb);
  }
  fragColor = vec4(encode(rgb) * src.a, src.a);
}
`;

export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_direction;
uniform vec2 u_blurSize;
${COMMON}
void main() {
  // Dense Gaussian taps on a mip-filtered, bounded-size image: sparse taps
  // several source pixels apart produce repeated edges on full-size exports.
  float sigma = max(0.5, min(u_blurSize.x, u_blurSize.y) * 0.008);
  float radius = ceil(3.0 * sigma);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -25; i <= 25; i++) {
    if (abs(float(i)) > radius) continue;
    float weight = exp(-0.5 * float(i * i) / (sigma * sigma));
    vec2 offset = u_direction * float(i) / u_blurSize;
    sum += texture(u_input, v_uv + offset) * weight;
    total += weight;
  }
  // Carry coverage through both passes. Hidden RGB must not create a halo.
  fragColor = vec4(vec3(luma(sum.rgb)), sum.a) / total;
}
`;

export const FINISH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_rendered;
uniform sampler2D u_blurred;
uniform sampler2D u_original;
uniform mat3 u_matrix;
// clarity, dehaze, vignette (-100..100), blur available (0/1)
uniform vec4 u_effects;
// show original (0/1), split position in output UV (< 0 disables)
uniform vec4 u_compare;
// matte color and whether to flatten alpha onto it
uniform vec4 u_matte;
${COMMON}
// Source uploads are straight alpha. Interpolate associated color for compare
// too, so rotated transparent edges match the developed image.
vec4 originalAt(vec2 uv) {
  ivec2 size = textureSize(u_original, 0);
  vec2 pixel = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(pixel));
  vec2 f = fract(pixel);
  vec4 result = vec4(0.0);
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec4 value = texelFetch(u_original, clamp(base + ivec2(x, y), ivec2(0), size - 1), 0);
      float weight = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
      result += vec4(value.rgb * value.a, value.a) * weight;
    }
  }
  return result;
}
void main() {
  vec3 q = u_matrix * vec3(v_uv, 1.0);
  vec2 suv = q.xy / q.z;
  if (q.z <= 0.05 || any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) {
    fragColor = u_matte.a > 0.5 ? vec4(u_matte.rgb, 1.0) : vec4(0.0);
    return;
  }
  bool original = u_compare.x > 0.5 || v_uv.x < u_compare.y;
  vec4 src = original ? originalAt(suv) : texture(u_rendered, suv);
  vec3 rgb = src.a > 1.0e-7 ? src.rgb / src.a : vec3(0.0);
  if (!original) {
    if (u_effects.w > 0.5 && u_effects.x != 0.0) {
      vec4 blurred = texture(u_blurred, suv);
      float base = blurred.a > 1.0e-7 ? blurred.r / blurred.a : luma(rgb);
      float l = luma(rgb);
      float detail = l - base;
      // Protect strong edges and extreme tones; scale luminance instead of
      // adding gray to every channel (which desaturates colored texture).
      float edgeGate = exp(-0.5 * detail * detail / (0.12 * 0.12));
      float gate = 4.0 * clamp(l, 0.0, 1.0) * (1.0 - clamp(l, 0.0, 1.0));
      rgb = withLuma(rgb, max(0.0, l + detail * u_effects.x * 0.012 * gate * edgeGate));
    }
    if (u_effects.y > 0.0) {
      float transmission = max(0.2, 1.0 - u_effects.y * 0.008 * min(rgb.r, min(rgb.g, rgb.b)));
      rgb = 1.0 + (rgb - 1.0) / transmission;
    } else if (u_effects.y < 0.0) {
      rgb = mix(rgb, vec3(1.0), -u_effects.y * 0.0035);
    }
    rgb = decode(rgb);
    vec2 delta = (v_uv - 0.5) * 2.0;
    float amount = abs(u_effects.z) * 0.01 * smoothstep(0.2, 1.6, dot(delta, delta));
    if (u_effects.z < 0.0) rgb *= exp2(-amount * 2.0);
    else rgb = mix(rgb, vec3(1.0), amount);
    rgb = encode(gamutMap(rgb));
  }
  if (u_matte.a > 0.5) {
    fragColor = vec4(mix(u_matte.rgb, rgb, src.a), 1.0);
  } else {
    fragColor = vec4(rgb, src.a);
  }
}
`;
