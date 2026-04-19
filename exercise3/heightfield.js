/**
 * heightfield.js  (Exercise 3)
 * ─────────────────────────────
 * Extends Ex2's heightfield with Lambertian directional lighting.
 *
 * What's new vs Ex2
 * ─────────────────
 * VERTEX SHADER:
 *   • Passes vUV to the fragment shader (already done in Ex2).
 *   • Passes vHeight (the displaced height at this vertex).
 *   • Passes vWorldNormal — surface normal estimated from finite
 *     differences, computed HERE so it can be transformed into
 *     world space for lighting.
 *
 * FRAGMENT SHADER  ← main addition:
 *   • Implements the full Lambertian model from the spec:
 *       I = Ia·ka  +  Id·kd·max(0, N·L)
 *   • N is taken from vWorldNormal (interpolated across the triangle).
 *   • L comes from a uniform uLightDir (set by the UI compass).
 *   • Surface colour = original pixel RGB × I  (lit by real colour light).
 *
 * Normal estimation (§6.2 of the brief):
 *   The height h(u,v) is read from the texture at (u±ε, v) and (u, v±ε)
 *   using centred finite differences:
 *       ∂h/∂u ≈ [h(u+ε,v) − h(u−ε,v)] / 2ε
 *       ∂h/∂v ≈ [h(u,v+ε) − h(u,v−ε)] / 2ε
 *   Then N = normalize(−∂h/∂u, −∂h/∂v, 1).
 *   ε = texel size = 1 / gridResolution.
 *
 *   We compute this in the VERTEX shader so we can transform the normal
 *   through the normal matrix into view/world space correctly.
 *   The interpolated normal arrives in the fragment shader via a varying.
 */

import * as THREE from 'three';
import { GLSL_HELPERS, GLSL_SPACES, SPACE_KEYS } from './colorspaces.js';

// ─────────────────────────────────────────────
// Build combined conversion GLSL (identical pattern to Ex2)
// ─────────────────────────────────────────────
function buildConversionGLSL() {
  const renamed = SPACE_KEYS.map((key, i) =>
    GLSL_SPACES[key].replace(/spaceConvert/g, `space${i}`)
  );
  const dispatch = `
    vec3 spaceConvert(vec3 c) {
      ${SPACE_KEYS.map((_, i) => `if (uColorSpace == ${i}) return space${i}(c);`).join('\n      ')}
      return c;
    }
  `;
  return renamed.join('\n') + '\n' + dispatch;
}

// ─────────────────────────────────────────────
// Helper: extract the height component from a converted vec3
// (same ternary chain used in Ex2)
// ─────────────────────────────────────────────
const GLSL_PICK_HEIGHT = /* glsl */`
  float pickHeight(vec3 converted, int ch) {
    if (ch == 0) return converted.x;
    if (ch == 1) return converted.y;
    return converted.z;
  }
`;

// ─────────────────────────────────────────────
// VERTEX SHADER
// Key additions over Ex2:
//   • Samples four neighbours (u±ε, v±ε) to estimate ∂h/∂u, ∂h/∂v
//   • Builds the unnormalised surface normal in object space
//   • Transforms it into world space via normalMatrix
//   • Passes vWorldNormal to the fragment shader
// ─────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */`
  precision highp float;

  uniform sampler2D uTexture;
  uniform int       uColorSpace;
  uniform int       uChannel;
  uniform float     uHeightScale;
  uniform float     uTexelSize;    // 1.0 / gridResolution  (= ε)

  varying vec2  vUV;
  varying vec3  vColor;
  varying float vHeight;
  varying vec3  vWorldNormal;   // ← NEW: interpolated for Lambertian

  ${GLSL_HELPERS}
  ${buildConversionGLSL()}
  ${GLSL_PICK_HEIGHT}

  // Read height at arbitrary UV (clamp to edge)
  float heightAt(vec2 uv2) {
    vec2 clamped = clamp(uv2, vec2(0.0), vec2(1.0));
    vec4 px = texture2D(uTexture, clamped);
    return pickHeight(spaceConvert(px.rgb), uChannel);
  }

  void main() {
    vUV   = uv;
    vec4 pixel = texture2D(uTexture, uv);
    vColor = pixel.rgb;

    // Height at this vertex
    float h = heightAt(uv);
    vHeight  = h;

    // ── Finite-difference normal estimation (§6.2) ──
    float eps = uTexelSize;

    float dHdu = (heightAt(uv + vec2(eps, 0.0)) - heightAt(uv - vec2(eps, 0.0))) / (2.0 * eps);
    float dHdv = (heightAt(uv + vec2(0.0, eps)) - heightAt(uv - vec2(0.0, eps))) / (2.0 * eps);

    // Scale derivatives by uHeightScale so the normal matches the displaced surface
    dHdu *= uHeightScale;
    dHdv *= uHeightScale;

    // Object-space normal: N = normalize(-dH/du, -dH/dv, 1)
    // PlaneGeometry lies in XY plane, Z = up after displacement
    vec3 objectNormal = normalize(vec3(-dHdu, -dHdv, 1.0));

    // Transform to world space using Three.js built-in normalMatrix
    // normalMatrix = transpose(inverse(modelViewMatrix)) — correct for non-uniform scale
    vWorldNormal = normalize(normalMatrix * objectNormal);

    // Displaced position
    vec3 displaced = position + vec3(0.0, 0.0, h * uHeightScale);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

// ─────────────────────────────────────────────
// FRAGMENT SHADER — Lambertian model (§6.1 + §6.3)
//
//   I = Ia·ka  +  Id·kd·max(0, N·L)
//
// uLightDir is already normalised on the CPU side.
// The surface colour (kd material) = original pixel RGB.
// ─────────────────────────────────────────────
const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  uniform vec3  uLightDir;    // unit vector toward light, in VIEW space
  uniform vec3  uLightColor;  // Id
  uniform float uKd;          // diffuse reflectance coefficient
  uniform float uKa;          // ambient reflectance coefficient
  uniform vec3  uAmbientColor;// Ia (white by default)

  varying vec2  vUV;
  varying vec3  vColor;
  varying float vHeight;
  varying vec3  vWorldNormal;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);

    // Lambertian diffuse term
    float NdotL = max(0.0, dot(N, L));

    // Full lighting equation with ambient
    vec3 ambient  = uAmbientColor * uKa * vColor;
    vec3 diffuse  = uLightColor   * uKd * NdotL * vColor;

    vec3 litColor = ambient + diffuse;

    gl_FragColor  = vec4(litColor, 1.0);
  }
`;

// ─────────────────────────────────────────────
// Wireframe shader — simple dim overlay
// (uses same vertex shader so displacement matches)
// ─────────────────────────────────────────────
const WIRE_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  varying vec3  vColor;
  varying vec3  vWorldNormal;
  uniform vec3  uLightDir;
  uniform float uKa;

  void main() {
    // Wire edges get a faint ambient-only tint so they don't overpower the surface
    gl_FragColor = vec4(vColor * uKa * 1.5, 0.5);
  }
`;

// ─────────────────────────────────────────────
// HeightField class
// ─────────────────────────────────────────────
export class HeightField {
  constructor() {
    this.solidMesh   = null;
    this.wireMesh    = null;
    this._material   = null;
    this._wireMat    = null;
    this._geometry   = null;
    this._texture    = null;
    this._gridSize   = 128;
    this._scene      = null;
    this._surfaceMode = 0;
  }

  /**
   * Build the heightfield from an ImageData object.
   * @param {ImageData} imageData
   * @param {THREE.Scene} scene
   * @param {number} gridSize
   */
  build(imageData, scene, gridSize = 128) {
    this._scene    = scene;
    this._gridSize = gridSize;

    if (this.solidMesh) { scene.remove(this.solidMesh); }
    if (this.wireMesh)  { scene.remove(this.wireMesh);  }
    if (this._geometry) { this._geometry.dispose(); }
    if (this._texture)  { this._texture.dispose(); }

    // ── Texture ──
    const texData   = new Uint8Array(imageData.data.buffer);
    this._texture   = new THREE.DataTexture(texData, imageData.width, imageData.height, THREE.RGBAFormat);
    this._texture.needsUpdate = true;

    // ── Geometry ──
    this._geometry = new THREE.PlaneGeometry(1, 1, gridSize, gridSize);

    // ── Shared uniforms (solid + wire share the same object) ──
    this._uniforms = {
      uTexture:      { value: this._texture },
      uColorSpace:   { value: 0 },
      uChannel:      { value: 0 },
      uHeightScale:  { value: 0.4 },
      uTexelSize:    { value: 1.0 / gridSize },

      // Lighting
      uLightDir:     { value: new THREE.Vector3(0.57, 0.57, 0.57) },  // 45° diagonal
      uLightColor:   { value: new THREE.Vector3(1, 1, 1) },
      uKd:           { value: 0.9 },
      uKa:           { value: 0.12 },
      uAmbientColor: { value: new THREE.Vector3(1, 1, 1) },
    };

    // ── Solid material ──
    this._material = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms:       this._uniforms,
      side:           THREE.DoubleSide,
    });

    this.solidMesh = new THREE.Mesh(this._geometry, this._material);

    // ── Wireframe overlay ──
    const wireGeo   = new THREE.WireframeGeometry(this._geometry);
    this._wireMat   = new THREE.ShaderMaterial({
      vertexShader:   VERTEX_SHADER,
      fragmentShader: WIRE_FRAGMENT_SHADER,
      uniforms:       this._uniforms,   // shared → lighting stays in sync
      transparent:    true,
      depthTest:      true,
    });
    this.wireMesh = new THREE.LineSegments(wireGeo, this._wireMat);

    scene.add(this.solidMesh);
    scene.add(this.wireMesh);
    this._applySurfaceMode(this._surfaceMode);
  }

  // ── Geometry rebuild (grid resolution change) ──────────────────────────
  rebuildGeometry(gridSize) {
    if (!this._scene || !this._texture) return;

    if (this.solidMesh) this._scene.remove(this.solidMesh);
    if (this.wireMesh)  this._scene.remove(this.wireMesh);
    if (this._geometry) this._geometry.dispose();

    this._gridSize = gridSize;
    this._uniforms.uTexelSize.value = 1.0 / gridSize;

    const geo = new THREE.PlaneGeometry(1, 1, gridSize, gridSize);
    this._geometry = geo;

    this.solidMesh = new THREE.Mesh(geo, this._material);

    const wireGeo  = new THREE.WireframeGeometry(geo);
    this.wireMesh  = new THREE.LineSegments(wireGeo, this._wireMat);

    this._scene.add(this.solidMesh);
    this._scene.add(this.wireMesh);
    this._applySurfaceMode(this._surfaceMode);
  }

  // ── Setters ───────────────────────────────────────────────────────────

  setColorSpace(idx)   { if (this._uniforms) this._uniforms.uColorSpace.value  = idx; }
  setChannel(idx)      { if (this._uniforms) this._uniforms.uChannel.value     = idx; }
  setHeightScale(v)    { if (this._uniforms) this._uniforms.uHeightScale.value = v;   }

  setSurfaceMode(mode) {
    this._surfaceMode = mode;
    this._applySurfaceMode(mode);
  }

  _applySurfaceMode(mode) {
    if (this.solidMesh) this.solidMesh.visible = (mode === 0 || mode === 2);
    if (this.wireMesh)  this.wireMesh.visible  = (mode === 1 || mode === 2);
  }

  /**
   * Update light direction from spherical coords.
   * @param {number} elevDeg  — elevation above horizon (0°=horizon, 90°=straight up)
   * @param {number} azimDeg  — azimuth (0°=+X, 90°=+Y, counter-clockwise)
   */
  setLightDirection(elevDeg, azimDeg) {
    if (!this._uniforms) return;
    const elev = (elevDeg * Math.PI) / 180;
    const azim = (azimDeg * Math.PI) / 180;
    // Convert spherical → Cartesian
    const x = Math.cos(elev) * Math.cos(azim);
    const y = Math.cos(elev) * Math.sin(azim);
    const z = Math.sin(elev);
    this._uniforms.uLightDir.value.set(x, y, z).normalize();
  }

  setLightColor(hexString) {
    if (!this._uniforms) return;
    const c = new THREE.Color(hexString);
    this._uniforms.uLightColor.value.set(c.r, c.g, c.b);
  }

  setKd(v) { if (this._uniforms) this._uniforms.uKd.value = v; }
  setKa(v) { if (this._uniforms) this._uniforms.uKa.value = v; }

  get gridSize() { return this._gridSize; }
}
