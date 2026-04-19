/**
 * colorspaces.js  (Exercise 2)
 * ─────────────────────────────
 * Same conversion pipeline as Ex1, but here each space exposes its
 * individual channels so the user can choose which one drives height.
 *
 * Each GLSL_SPACES entry produces all components; the uniform
 * uChannel (0,1,2) selects which component becomes z = h(u,v).
 */

// ─────────────────────────────────────────────
// Shared GLSL helpers — identical to Ex1
// ─────────────────────────────────────────────
export const GLSL_HELPERS = /* glsl */`

  const vec3 D65 = vec3(0.95047, 1.00000, 1.08883);

  vec3 srgbToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));
  }

  vec3 linearToXYZ(vec3 lin) {
    mat3 M = mat3(
      0.4124564, 0.2126729, 0.0193339,
      0.3575761, 0.7151522, 0.1191920,
      0.1804375, 0.0721750, 0.9503041
    );
    return M * lin;
  }

  float labF(float t) {
    const float delta = 6.0 / 29.0;
    return (t > delta * delta * delta)
      ? pow(t, 1.0 / 3.0)
      : t / (3.0 * delta * delta) + 4.0 / 29.0;
  }

  vec3 xyzToLab(vec3 xyz) {
    vec3 n = xyz / D65;
    float L = 116.0 * labF(n.y) - 16.0;
    float a = 500.0 * (labF(n.x) - labF(n.y));
    float b = 200.0 * (labF(n.y) - labF(n.z));
    return vec3(L, a, b);
  }
`;

// ─────────────────────────────────────────────
// Per-space conversion → normalised vec3
// Returns values in [0,1]^3 for all 3 components.
// The vertex shader picks one component as height.
// ─────────────────────────────────────────────
export const GLSL_SPACES = {

  // 0 — RGB  (trivially normalised)
  RGB: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      return c;
    }
  `,

  // 1 — HSV
  //   H → [0,1] (÷360), S → [0,1], V → [0,1]
  HSV: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      float Cmax  = max(c.r, max(c.g, c.b));
      float Cmin  = min(c.r, min(c.g, c.b));
      float delta = Cmax - Cmin;
      float V = Cmax;
      float S = (Cmax < 0.0001) ? 0.0 : delta / Cmax;
      float H = 0.0;
      if (delta > 0.0001) {
        if      (Cmax == c.r) H = mod((c.g - c.b) / delta, 6.0);
        else if (Cmax == c.g) H = (c.b - c.r) / delta + 2.0;
        else                  H = (c.r - c.g) / delta + 4.0;
        H /= 6.0;
      }
      return vec3(H, S, V);
    }
  `,

  // 2 — CIE XYZ   (normalised by D65 white → [0,1])
  CIEXYZ: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      return linearToXYZ(srgbToLinear(c)) / D65;
    }
  `,

  // 3 — CIE xyY   x,y ∈ [0,1], Y ∈ [0,1]
  CIExyY: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      vec3 xyz = linearToXYZ(srgbToLinear(c));
      float sum = xyz.x + xyz.y + xyz.z;
      if (sum < 0.0001) return vec3(0.0);
      return vec3(xyz.x / sum, xyz.y / sum, xyz.y);
    }
  `,

  // 4 — CIELAB   L*∈[0,1], a*∈[0,1], b*∈[0,1]  (after normalisation)
  CIELAB: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      vec3 lab = xyzToLab(linearToXYZ(srgbToLinear(c)));
      return vec3(
        lab.x / 100.0,
        (lab.y + 128.0) / 255.0,
        (lab.z + 128.0) / 255.0
      );
    }
  `,

  // 5 — CIELCH   L*∈[0,1], C*∈[0,1], h∈[0,1]
  CIELCH: /* glsl */`
    vec3 spaceConvert(vec3 c) {
      vec3 lab = xyzToLab(linearToXYZ(srgbToLinear(c)));
      float L = lab.x / 100.0;
      float C = sqrt(lab.y * lab.y + lab.z * lab.z) / 133.0;
      float h = (atan(lab.z, lab.y) + 3.14159265) / 6.28318530; // [0,1]
      return vec3(L, C, h);
    }
  `,
};

// Metadata used by the UI to build channel buttons per space
export const SPACE_NAMES = ['RGB', 'HSV', 'CIEXYZ', 'CIExyY', 'CIELAB', 'CIELCH'];
export const SPACE_KEYS  = ['RGB', 'HSV', 'CIEXYZ', 'CIExyY', 'CIELAB', 'CIELCH'];

export const CHANNEL_NAMES = {
  RGB:    ['R — Red',       'G — Green',     'B — Blue'      ],
  HSV:    ['H — Hue',       'S — Saturation','V — Value'     ],
  CIEXYZ: ['X',             'Y — Luminance', 'Z'             ],
  CIExyY: ['x — chroma',   'y — chroma',    'Y — Luminance' ],
  CIELAB: ['L* — Lightness','a* — green↔red','b* — blue↔yel.'],
  CIELCH: ['L* — Lightness','C* — Chroma',   'h — Hue angle' ],
};
