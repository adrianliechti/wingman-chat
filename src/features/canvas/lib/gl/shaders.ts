// GLSL ES 3.00 sources for the develop pipeline. Textures hold sRGB-encoded
// 8-bit pixels (row 0 = image top); the develop pass decodes to linear light,
// edits, and encodes again. Tone and color math follows Aperture's
// adjustments.wgsl and RapidRAW's shader.wgsl (contrast curve, vibrance, HSL).

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
  vec3 safe = max(rgb, vec3(0.0));
  vec3 p = clamp(pow(safe, vec3(1.0 / 2.2)), 0.0, 1.0);
  float s = pow(2.0, con * 1.25);
  vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - p), vec3(s));
  vec3 lo = 0.5 * pow(2.0 * p, vec3(s));
  vec3 curved = pow(mix(hi, lo, step(p, vec3(0.5))), vec3(2.2));
  return mix(curved, rgb, smoothstep(vec3(1.0), vec3(1.01), safe));
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
  return max(mix(vec3(l), safe, m), vec3(0.0));
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
  float l = luma(rgb);
  float gain = exp2(
    u_light.w * 0.015 * (1.0 - smoothstep(0.0, 0.5, l)) +
    u_light.z * 0.01 * smoothstep(0.18, 1.0, l) +
    u_tone.x * 0.012 * smoothstep(0.6, 1.2, l));
  float black = u_tone.y * 0.00045 * (1.0 - smoothstep(0.0, 0.25, l));
  rgb = max(vec3(0.0), rgb * gain + black);
  rgb = applyContrast(rgb, u_light.y);
  if (u_color.z > 0.5) {
    rgb = toGray(rgb);
  } else {
    rgb = applyCreativeColor(rgb, u_color.y, u_color.x);
    if (u_color.w > 0.5) rgb = applyMixer(rgb);
  }
  fragColor = vec4(clamp(encode(rgb), 0.0, 1.0), src.a);
}
`;

export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_direction;
${COMMON}
void main() {
  vec2 size = vec2(textureSize(u_input, 0));
  float stepPx = max(1.0, min(size.x, size.y) * 0.004);
  float w[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
  vec3 rgb = texture(u_input, v_uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = u_direction * float(i) * stepPx / size;
    rgb += (texture(u_input, v_uv + o).rgb + texture(u_input, v_uv - o).rgb) * w[i];
  }
  fragColor = vec4(vec3(luma(rgb)), 1.0);
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
void main() {
  vec3 q = u_matrix * vec3(v_uv, 1.0);
  vec2 suv = q.xy / q.z;
  if (q.z <= 0.05 || any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) {
    fragColor = u_matte.a > 0.5 ? vec4(u_matte.rgb, 1.0) : vec4(0.0);
    return;
  }
  bool original = u_compare.x > 0.5 || v_uv.x < u_compare.y;
  vec4 src = original ? texture(u_original, suv) : texture(u_rendered, suv);
  vec3 rgb = src.rgb;
  if (!original) {
    if (u_effects.w > 0.5 && u_effects.x != 0.0) {
      float base = texture(u_blurred, suv).r;
      float l = luma(rgb);
      rgb = clamp(rgb + (l - base) * u_effects.x * 0.015 * 4.0 * l * (1.0 - l), 0.0, 1.0);
    }
    if (u_effects.y > 0.0) {
      float transmission = max(0.2, 1.0 - u_effects.y * 0.008 * min(rgb.r, min(rgb.g, rgb.b)));
      rgb = clamp(1.0 + (rgb - 1.0) / transmission, 0.0, 1.0);
    } else if (u_effects.y < 0.0) {
      rgb = mix(rgb, vec3(1.0), -u_effects.y * 0.0035);
    }
    vec2 delta = (v_uv - 0.5) * 2.0;
    float amount = abs(u_effects.z) * 0.01 * smoothstep(0.2, 1.6, dot(delta, delta));
    if (u_effects.z < 0.0) rgb *= exp2(-amount * 2.0);
    else rgb = mix(rgb, vec3(1.0), amount);
  }
  if (u_matte.a > 0.5) {
    fragColor = vec4(mix(u_matte.rgb, rgb, src.a), 1.0);
  } else {
    fragColor = vec4(rgb, src.a);
  }
}
`;
