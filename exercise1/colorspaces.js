/**
 * colorspaces.js
 * ──────────────
 * Exports GLSL function strings for each of the 6 target color spaces.
 * Each function takes a vec3 sRGB color (components in [0,1]) and
 * returns a vec3 that can be used directly as a 3D point position.
 *
 * All outputs are normalised to approximately [0,1]^3 so the cloud
 * always fits inside a unit cube — makes camera setup trivial.
 */

// ─────────────────────────────────────────────
// Shared helpers (injected once at the top of every shader)
// ─────────────────────────────────────────────
export const GLSL_HELPERS = /* glsl */`

  // D65 reference white
  const vec3 D65 = vec3(0.95047, 1.00000, 1.08883);

  // sRGB → Linear RGB  (IEC 61966-2-1)
  vec3 srgbToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));   // component-wise branch
  }

  // Linear RGB → CIE XYZ  (D65, sRGB primaries)
  vec3 linearToXYZ(vec3 lin) {
    mat3 M = mat3(
      0.4124564, 0.2126729, 0.0193339,  // column 0  (R contribution)
      0.3575761, 0.7151522, 0.1191920,  // column 1  (G contribution)
      0.1804375, 0.0721750, 0.9503041   // column 2  (B contribution)
    );
    // GLSL mat3 constructor is COLUMN-MAJOR, so the layout above is correct:
    // M * v  →  col0*v.r + col1*v.g + col2*v.b
    return M * lin;
  }

  // LAB helper f(t)
  float labF(float t) {
    const float delta = 6.0 / 29.0;
    return (t > delta * delta * delta)
      ? pow(t, 1.0 / 3.0)
      : t / (3.0 * delta * delta) + 4.0 / 29.0;
  }

  // CIE XYZ → CIELAB
  vec3 xyzToLab(vec3 xyz) {
    vec3 n = xyz / D65;                 // normalise by white point
    float L = 116.0 * labF(n.y) - 16.0;
    float a = 500.0 * (labF(n.x) - labF(n.y));
    float b = 200.0 * (labF(n.y) - labF(n.z));
    return vec3(L, a, b);
  }
`;

// ─────────────────────────────────────────────
// Per-space conversion functions + normalisation
// ─────────────────────────────────────────────

/**
 * Each function signature:
 *   vec3 toColorSpace(vec3 srgb)  →  normalised position in [0,1]^3
 *
 * The JS strings are injected into the vertex shader source.
 */

export const GLSL_SPACES = {

  // 0 — RGB  (trivial: already in [0,1])
  RGB: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      return c;           // R→X, G→Y, B→Z
    }
  `,

  // 1 — HSV  (cylindrical → unroll to Cartesian for 3D display)
  //   H ∈ [0°,360°], S ∈ [0,1], V ∈ [0,1]
  //   Map to Cartesian: x = S·cos(H), y = S·sin(H), z = V
  //   Then shift x,y to [0,1]: x' = (x+1)/2, y' = (y+1)/2
  HSV: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      float Cmax = max(c.r, max(c.g, c.b));
      float Cmin = min(c.r, min(c.g, c.b));
      float delta = Cmax - Cmin;

      float V = Cmax;
      float S = (Cmax < 0.0001) ? 0.0 : delta / Cmax;

      float H = 0.0;
      if (delta > 0.0001) {
        if (Cmax == c.r)      H = mod((c.g - c.b) / delta,       6.0);
        else if (Cmax == c.g) H = (c.b - c.r) / delta + 2.0;
        else                  H = (c.r - c.g) / delta + 4.0;
        H = H / 6.0;          // normalise to [0,1]
      }

      float angle = H * 6.28318530718;   // radians
      float x = S * cos(angle);          // [-1,1]
      float y = S * sin(angle);          // [-1,1]

      return vec3((x + 1.0) * 0.5, (y + 1.0) * 0.5, V);
    }
  `,

  // 2 — CIE XYZ
  //   Typical sRGB gamut: X∈[0,0.95], Y∈[0,1], Z∈[0,1.09]
  //   Normalise by D65 white so values stay near [0,1]
  CIEXYZ: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      vec3 xyz = linearToXYZ(srgbToLinear(c));
      return xyz / D65;       // normalise to white point → [0,1] range
    }
  `,

  // 3 — CIE xyY
  //   x,y ∈ [0,1] (chromaticity — real-world gamut occupies ~[0,0.8])
  //   Y ∈ [0,1] (luminance)
  CIExyY: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      vec3 xyz = linearToXYZ(srgbToLinear(c));
      float sum = xyz.x + xyz.y + xyz.z;
      if (sum < 0.0001) return vec3(0.0);
      float x = xyz.x / sum;
      float y = xyz.y / sum;
      float Y = xyz.y;        // already in [0,1] for sRGB
      return vec3(x, y, Y);
    }
  `,

  // 4 — CIELAB
  //   L* ∈ [0,100]  → normalise to [0,1]
  //   a* ∈ [-128,127]  → normalise: (a*+128)/255
  //   b* ∈ [-128,127]  → normalise: (b*+128)/255
  CIELAB: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      vec3 lab = xyzToLab(linearToXYZ(srgbToLinear(c)));
      return vec3(
        lab.x / 100.0,
        (lab.y + 128.0) / 255.0,
        (lab.z + 128.0) / 255.0
      );
    }
  `,

  // 5 — CIELCH  (cylindrical LAB)
  //   L* ∈ [0,100]  → [0,1]
  //   C* ∈ [0,~181] → normalise to [0,1] (max theoretical for sRGB ≈ 133)
  //   h  ∈ [0,2π]   → Cartesian: x = C_norm·cos(h), y = C_norm·sin(h)
  //   Layout: x=(cos+1)/2, y=(sin+1)/2, z=L_norm
  CIELCH: /* glsl */`
    vec3 toColorSpace(vec3 c) {
      vec3 lab = xyzToLab(linearToXYZ(srgbToLinear(c)));
      float L  = lab.x / 100.0;
      float C  = sqrt(lab.y * lab.y + lab.z * lab.z) / 133.0;  // normalise
      float h  = atan(lab.z, lab.y);                             // radians
      float x  = C * cos(h);  // [-1,1]
      float y  = C * sin(h);  // [-1,1]
      return vec3((x + 1.0) * 0.5, (y + 1.0) * 0.5, L);
    }
  `,
};

// Ordered list matching the uniform integer (0-5)
export const SPACE_NAMES = ['RGB', 'HSV', 'CIEXYZ', 'CIExyY', 'CIELAB', 'CIELCH'];
export const SPACE_KEYS  = ['RGB', 'HSV', 'CIEXYZ', 'CIExyY', 'CIELAB', 'CIELCH'];
