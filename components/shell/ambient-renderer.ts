// AI-038.7 — PAC ambient shader renderer.
//
// Decorative only. One fullscreen fragment shader, driven by elapsed time, drawn with native WebGL 1.0.
// No library, no React, no data: the only inputs are the canvas size and time. Browser primitives
// (frame scheduler, page visibility, size observation) are injected so the lifecycle can be tested
// without a browser.

/** The renderer draws at most ~30 frames per second; requestAnimationFrame stays the scheduler. */
export const AMBIENT_TARGET_FPS = 30;
export const AMBIENT_FRAME_INTERVAL_MS = 1000 / AMBIENT_TARGET_FPS;
// rAF timestamps jitter by a millisecond or two; without slack a 60 Hz display would draw at 20 FPS.
const FRAME_SLACK_MS = 2;
/** Drawing-buffer pixels per CSS pixel. A soft ambient field needs no Retina resolution. */
export const AMBIENT_MAX_DPR = 1;
/** Longest time step per frame: a stalled tab or a long task never makes the shape jump. */
export const AMBIENT_MAX_STEP_MS = 100;
export const AMBIENT_INTENSITY = 1;

// Fullscreen quad (two triangles as one strip), clip-space coordinates.
const QUAD = [-1, -1, 1, -1, -1, 1, 1, 1];

export const AMBIENT_VERTEX_SHADER = `attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// PAC luminous band. A slowly warped coordinate field carries one broad band of light through the
// middle-lower viewport (its centre line, thickness, crest and brightness all vary along x and over
// time) plus a deeper ocean / teal field above it. Every motion term is a low-frequency sine with its
// own unrelated rate, so the field deforms continuously and never shows a loop. Output is
// premultiplied and transparent where there is no light; the page's static base shows through.
export const AMBIENT_FRAGMENT_SHADER = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;

const vec3 OCEAN = vec3(0.043, 0.192, 0.314); // #0B3150
const vec3 STEEL = vec3(0.071, 0.231, 0.388); // #123B63
const vec3 TEAL = vec3(0.055, 0.455, 0.565);  // #0E7490
const vec3 CYAN = vec3(0.220, 0.741, 0.973);  // #38BDF8

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float t = uTime;

  // 1. Domain warp: the whole field bends and breathes; nothing translates as a rigid object.
  vec2 w = p;
  w.y += 0.085 * sin(p.x * 1.45 + t * 0.16) + 0.04 * sin(p.x * 3.1 - t * 0.23 + 1.3);
  w.x += 0.06 * sin(p.y * 2.3 - t * 0.13 + 0.7);

  // 2. Main band: centre line, half-width and brightness vary along the band and over time.
  float centre = -0.16 + 0.1 * sin(w.x * 1.1 + t * 0.11) + 0.05 * sin(w.x * 2.4 - t * 0.15 + 2.1) + 0.035 * sin(t * 0.061 + 0.4);
  float halfWidth = 0.16 + 0.07 * sin(w.x * 0.9 - t * 0.09 + 0.6) + 0.03 * sin(w.x * 2.1 + t * 0.12 + 1.9);
  float d = (w.y - centre) / halfWidth;
  float body = exp(-0.8 * d * d);
  float c = (d - 0.45) * 2.2;
  float crest = exp(-c * c);
  float halo = exp(-abs(d) * 0.7);
  float along = 0.72 + 0.28 * sin(w.x * 1.25 + t * 0.075 + 1.1);

  // 3. Deeper structure: a broad ocean / teal field above the band that swells and drifts.
  vec2 deepCentre = vec2(0.24 * aspect + 0.12 * sin(t * 0.047), 0.22 + 0.07 * sin(t * 0.058 + 1.0));
  vec2 deepRadius = vec2(0.66 + 0.09 * sin(t * 0.067), 0.36 + 0.06 * sin(t * 0.052 + 2.0));
  vec2 e = (w - deepCentre) / deepRadius;
  float deep = exp(-dot(e, e));

  vec3 light = STEEL * (0.13 * halo + 0.18 * body)
    + TEAL * (0.3 * body * along)
    + CYAN * (0.07 * crest * along)
    + OCEAN * (0.5 * deep)
    + TEAL * (0.05 * deep);
  light *= uIntensity;

  // Static sub-LSB dither: no banding in the very dark gradients (not animated, not grain).
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  light = max(light + (n - 0.5) / 255.0, 0.0);

  float alpha = clamp(max(max(light.r, light.g), light.b), 0.0, 1.0);
  gl_FragColor = vec4(min(light, vec3(alpha)), alpha);
}
`;

export type AmbientFailure = "no-webgl" | "shader-compile" | "program-link" | "setup";

export type AmbientHost = Readonly<{
  canvas: HTMLCanvasElement;
  /** Active shader time to continue from (the shape continues across remounts instead of restarting). */
  startElapsedMs: number;
  scheduler: Readonly<{ request(callback: (now: number) => void): number; cancel(handle: number): void }>;
  visibility: Readonly<{ isHidden(): boolean; subscribe(listener: () => void): () => void }>;
  /** Reports the canvas CSS size now and on every later change. */
  size: Readonly<{ subscribe(listener: (cssWidth: number, cssHeight: number) => void): () => void }>;
  onContextLost(): void;
}>;

export type AmbientRenderer = Readonly<{
  /** Stops the loop, detaches every listener and frees GL resources. Returns the active elapsed time. */
  dispose(): number;
}>;

export type AmbientStart =
  | Readonly<{ ok: true; renderer: AmbientRenderer }>
  | Readonly<{ ok: false; reason: AmbientFailure }>;

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
  // Software-only WebGL would burn CPU for a decoration: keep the CSS fallback instead.
  failIfMajorPerformanceCaveat: true,
};

/**
 * Starts the ambient shader on `canvas`. Never throws: any missing capability or GL error returns
 * `{ ok: false }` with every partially created resource released, and the caller keeps the CSS
 * fallback.
 */
export function startAmbientShader(host: AmbientHost): AmbientStart {
  let context: WebGLRenderingContext | null = null;
  try {
    context = host.canvas.getContext("webgl", CONTEXT_ATTRIBUTES);
  } catch {
    context = null;
  }
  if (!context || context.isContextLost()) return { ok: false, reason: "no-webgl" };
  const gl = context;

  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const release = () => {
    try {
      if (!gl.isContextLost()) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        for (const shader of shaders) gl.deleteShader(shader);
      }
    } catch {
      // Resources die with the context anyway.
    }
    buffer = null;
    program = null;
    shaders.length = 0;
  };

  let failure: AmbientFailure | null = null;
  let resolutionLocation: WebGLUniformLocation | null = null;
  let timeLocation: WebGLUniformLocation | null = null;
  try {
    for (const [type, text] of [[gl.VERTEX_SHADER, AMBIENT_VERTEX_SHADER], [gl.FRAGMENT_SHADER, AMBIENT_FRAGMENT_SHADER]] as const) {
      const shader = gl.createShader(type);
      if (!shader) {
        failure = "shader-compile";
        break;
      }
      shaders.push(shader);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        failure = "shader-compile";
        break;
      }
    }
    if (!failure) {
      program = gl.createProgram();
      if (!program) {
        failure = "program-link";
      } else {
        for (const shader of shaders) gl.attachShader(program, shader);
        gl.bindAttribLocation(program, 0, "aPosition");
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) failure = "program-link";
      }
    }
    if (!failure && program) {
      buffer = gl.createBuffer();
      if (!buffer) {
        failure = "setup";
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD), gl.STATIC_DRAW);
        gl.useProgram(program);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        resolutionLocation = gl.getUniformLocation(program, "uResolution");
        timeLocation = gl.getUniformLocation(program, "uTime");
        gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), AMBIENT_INTENSITY);
      }
    }
  } catch {
    failure = "setup";
  }
  if (failure) {
    release();
    return { ok: false, reason: failure };
  }

  let elapsedMs = Math.max(0, host.startElapsedMs);
  let frame: number | null = null;
  let lastTick: number | null = null;
  let lastDraw: number | null = null;
  let width = 0;
  let height = 0;
  let stopped = false;
  let disposed = false;

  const draw = () => {
    if (width === 0 || height === 0) return;
    gl.uniform1f(timeLocation, elapsedMs / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const halt = () => {
    if (frame !== null) host.scheduler.cancel(frame);
    frame = null;
    // The next visible frame starts a fresh step, so time resumes where it paused.
    lastTick = null;
    lastDraw = null;
  };
  const tick = (now: number) => {
    frame = null;
    if (stopped || host.visibility.isHidden()) {
      halt();
      return;
    }
    if (lastTick !== null) elapsedMs += Math.min(Math.max(now - lastTick, 0), AMBIENT_MAX_STEP_MS);
    lastTick = now;
    if (lastDraw === null || now - lastDraw >= AMBIENT_FRAME_INTERVAL_MS - FRAME_SLACK_MS) {
      lastDraw = now;
      draw();
    }
    frame = host.scheduler.request(tick);
  };
  const schedule = () => {
    if (frame === null && !stopped && !host.visibility.isHidden()) frame = host.scheduler.request(tick);
  };
  const resize = (cssWidth: number, cssHeight: number) => {
    const nextWidth = Math.max(1, Math.round(cssWidth * AMBIENT_MAX_DPR));
    const nextHeight = Math.max(1, Math.round(cssHeight * AMBIENT_MAX_DPR));
    if (stopped || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth;
    height = nextHeight;
    host.canvas.width = nextWidth;
    host.canvas.height = nextHeight;
    gl.viewport(0, 0, nextWidth, nextHeight);
    gl.uniform2f(resolutionLocation, nextWidth, nextHeight);
    // Resizing clears the drawing buffer: repaint at once, even between capped frames.
    if (!host.visibility.isHidden()) draw();
  };
  const onVisibilityChange = () => {
    if (host.visibility.isHidden()) halt();
    else schedule();
  };
  const onContextLost = () => {
    if (stopped) return;
    stopped = true;
    halt();
    host.onContextLost();
  };

  host.canvas.addEventListener("webglcontextlost", onContextLost);
  const unsubscribeSize = host.size.subscribe(resize);
  const unsubscribeVisibility = host.visibility.subscribe(onVisibilityChange);
  schedule();

  return {
    ok: true,
    renderer: {
      dispose() {
        if (!disposed) {
          disposed = true;
          stopped = true;
          halt();
          host.canvas.removeEventListener("webglcontextlost", onContextLost);
          unsubscribeSize();
          unsubscribeVisibility();
          release();
        }
        return elapsedMs;
      },
    },
  };
}
