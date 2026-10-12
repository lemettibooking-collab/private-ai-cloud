// AI-038.7 ambient shader renderer: behavioral lifecycle tests with a fake WebGL context, frame
// scheduler, page visibility and size source (no browser, no GPU). The renderer must fall back
// without throwing, draw at ~30 FPS at 1 device pixel per CSS pixel, pause in hidden tabs without a
// time jump, stop on context loss and release everything on dispose.
import assert from "node:assert/strict";
import test from "node:test";

const ambient = (await import(new URL("../components/shell/ambient-renderer.ts", import.meta.url).href)) as typeof import("../components/shell/ambient-renderer");

type Fail = Partial<{ getContext: "null" | "throw"; lostAtStart: boolean; compile: "vertex" | "fragment"; createShader: "null" | "throw"; link: boolean; buffer: boolean }>;

function harness(fail: Fail = {}, startElapsedMs = 0) {
  const VERTEX = 0x8b31;
  const FRAGMENT = 0x8b30;
  let lost = Boolean(fail.lostAtStart);
  const created = { shaders: 0, programs: 0, buffers: 0 };
  const deleted = { shaders: 0, programs: 0, buffers: 0 };
  const uniformNames = new Set<string>();
  const times: number[] = [];
  let resolution: number[] = [];
  let draws = 0;
  const gl = {
    VERTEX_SHADER: VERTEX, FRAGMENT_SHADER: FRAGMENT, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4, FLOAT: 0x1406, TRIANGLE_STRIP: 5,
    isContextLost: () => lost,
    createShader: (type: number) => {
      if (fail.createShader === "throw") throw new Error("driver");
      if (fail.createShader === "null") return null;
      created.shaders += 1;
      return { type };
    },
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: (shader: { type: number }) => !((fail.compile === "vertex" && shader.type === VERTEX) || (fail.compile === "fragment" && shader.type === FRAGMENT)),
    createProgram: () => { created.programs += 1; return {}; },
    attachShader: () => {},
    bindAttribLocation: () => {},
    linkProgram: () => {},
    getProgramParameter: () => !fail.link,
    createBuffer: () => { if (fail.buffer) return null; created.buffers += 1; return {}; },
    bindBuffer: () => {},
    bufferData: () => {},
    useProgram: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform1f: (location: { name: string }, value: number) => { uniformNames.add(location.name); if (location.name === "uTime") times.push(value); },
    uniform2f: (location: { name: string }, x: number, y: number) => { uniformNames.add(location.name); resolution = [x, y]; },
    viewport: () => {},
    drawArrays: () => { draws += 1; },
    deleteShader: () => { deleted.shaders += 1; },
    deleteProgram: () => { deleted.programs += 1; },
    deleteBuffer: () => { deleted.buffers += 1; },
  };
  const listeners = new Map<string, Set<() => void>>();
  let allocations = 0;
  let width = 300;
  let height = 150;
  let contextAttributes: WebGLContextAttributes | undefined;
  const canvas = {
    getContext: (type: string, attributes: WebGLContextAttributes) => {
      assert.equal(type, "webgl", "WebGL 1 is enough");
      contextAttributes = attributes;
      if (fail.getContext === "throw") throw new Error("blocked");
      return fail.getContext === "null" ? null : gl;
    },
    get width() { return width; },
    set width(value: number) { width = value; allocations += 1; },
    get height() { return height; },
    set height(value: number) { height = value; allocations += 1; },
    addEventListener: (type: string, listener: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
  };
  // Frame scheduler: rAF-like, driven by the test.
  const frames = new Map<number, (now: number) => void>();
  let nextHandle = 1;
  let requests = 0;
  const cancelled: number[] = [];
  let hidden = false;
  const visibilityListeners = new Set<() => void>();
  let sizeListener: ((width: number, height: number) => void) | null = null;
  let sizeSubscriptions = 0;
  let contextLostCalls = 0;
  const result = ambient.startAmbientShader({
    canvas: canvas as unknown as HTMLCanvasElement,
    startElapsedMs,
    scheduler: {
      request: (callback) => { requests += 1; const handle = nextHandle++; frames.set(handle, callback); return handle; },
      cancel: (handle) => { cancelled.push(handle); frames.delete(handle); },
    },
    visibility: {
      isHidden: () => hidden,
      subscribe: (listener) => { visibilityListeners.add(listener); return () => visibilityListeners.delete(listener); },
    },
    size: {
      subscribe: (listener) => { sizeSubscriptions += 1; sizeListener = listener; listener(1440, 900); return () => { sizeListener = null; }; },
    },
    onContextLost: () => { contextLostCalls += 1; },
  });
  // Advance the display clock: one rAF callback per refresh interval.
  let clock = 1000;
  const run = (milliseconds: number, hz = 60) => {
    const step = 1000 / hz;
    for (let elapsed = 0; elapsed < milliseconds - 1e-9; elapsed += step) {
      clock += step;
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(clock);
    }
  };
  return {
    result, gl, canvas, created, deleted, uniformNames, times, frames, cancelled, listeners, visibilityListeners,
    get resolution() { return resolution; }, get draws() { return draws; }, get allocations() { return allocations; },
    get contextAttributes() { return contextAttributes; }, get requests() { return requests; }, get sizeSubscriptions() { return sizeSubscriptions; },
    get sizeListener() { return sizeListener; }, get contextLostCalls() { return contextLostCalls; },
    get clock() { return clock; }, set clock(value: number) { clock = value; },
    run,
    setHidden(value: boolean) { hidden = value; for (const listener of [...visibilityListeners]) listener(); },
    loseContext() { lost = true; for (const listener of [...(listeners.get("webglcontextlost") ?? [])]) listener(); },
  };
}

const renderer = (h: ReturnType<typeof harness>) => {
  assert.equal(h.result.ok, true);
  if (!h.result.ok) throw new Error("unreachable");
  return h.result.renderer;
};

test("D / E. no WebGL or any GL failure → { ok: false } with no throw, no loop, no listeners and nothing leaked", () => {
  const cases: Array<[Fail, string]> = [
    [{ getContext: "null" }, "no-webgl"],
    [{ getContext: "throw" }, "no-webgl"],
    [{ lostAtStart: true }, "no-webgl"],
    [{ createShader: "null" }, "shader-compile"],
    [{ createShader: "throw" }, "setup"],
    [{ compile: "vertex" }, "shader-compile"],
    [{ compile: "fragment" }, "shader-compile"],
    [{ link: true }, "program-link"],
    [{ buffer: true }, "setup"],
  ];
  for (const [fail, reason] of cases) {
    const h = harness(fail);
    assert.deepEqual({ ...h.result }, { ok: false, reason }, JSON.stringify(fail));
    assert.equal(h.requests, 0, "no animation loop");
    assert.equal(h.sizeSubscriptions, 0, "no size observation");
    assert.equal(h.visibilityListeners.size, 0, "no visibility listener");
    assert.equal(h.listeners.get("webglcontextlost")?.size ?? 0, 0, "no context listener");
    assert.equal(h.draws, 0);
    if (!fail.lostAtStart) {
      assert.deepEqual(h.deleted, h.created, `${JSON.stringify(fail)}: every created GL object is released`);
    }
  }
});

test("context attributes: software-only WebGL is refused, no MSAA, no depth / stencil, no preserved buffer", () => {
  const h = harness();
  assert.deepEqual(h.contextAttributes, {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: true,
  });
  renderer(h).dispose();
});

test("H. ~30 FPS cap: requestAnimationFrame keeps scheduling, frames are skipped at 60 / 120 / 144 Hz", () => {
  for (const hz of [60, 120, 144]) {
    const h = harness();
    const before = h.draws; // the initial resize paints once
    h.run(2000, hz);
    const drawn = h.draws - before;
    assert.ok(drawn >= 56 && drawn <= 62, `${hz} Hz: ${drawn} draws in 2 s`);
    assert.ok(h.requests >= Math.floor(2 * hz) - 1, "rAF stays the scheduler");
    renderer(h).dispose();
  }
});

test("I. DPR 1: the drawing buffer is the CSS size; it is reallocated only when the size really changes", () => {
  const h = harness();
  assert.deepEqual([h.canvas.width, h.canvas.height], [1440, 900]);
  assert.deepEqual(h.resolution, [1440, 900]);
  const allocations = h.allocations;
  h.sizeListener!(1440, 900);
  h.run(500);
  assert.equal(h.allocations, allocations, "same size → no reallocation, not per frame");
  h.sizeListener!(1919.6, 1080.2);
  assert.deepEqual([h.canvas.width, h.canvas.height], [1920, 1080], "rounded CSS pixels, never × devicePixelRatio");
  assert.deepEqual(h.resolution, [1920, 1080]);
  assert.equal(h.allocations, allocations + 2);
  renderer(h).dispose();
});

test("time: continues from startElapsedMs, advances with real time, and a long stall never jumps the shape", () => {
  const h = harness({}, 12_345);
  assert.equal(h.times[0], 12.345, "the shape continues where the previous page left it");
  h.run(1000);
  const afterOneSecond = h.times.at(-1)!;
  assert.ok(Math.abs(afterOneSecond - 12.345 - 1) < 0.05, `≈1 s of shader time per second (${afterOneSecond})`);
  // A 5 s main-thread stall: the next frame advances at most AMBIENT_MAX_STEP_MS (uTime is written on
  // drawn frames only, so the previous drawn value may lag elapsed time by one skipped 60 Hz tick).
  h.clock += 5000;
  h.run(1000 / 60);
  const jump = h.times.at(-1)! - afterOneSecond;
  assert.ok(jump > 0 && jump <= (ambient.AMBIENT_MAX_STEP_MS + 1000 / 60) / 1000 + 1e-9, `stall advanced the shape by ${jump} s, not 5 s`);
  renderer(h).dispose();
});

test("G. visibility: a hidden tab cancels the loop; returning resumes exactly where it paused (no accumulated delta)", () => {
  const h = harness();
  h.run(1000);
  const drawsBefore = h.draws;
  const timeBefore = h.times.at(-1)!;
  h.setHidden(true);
  assert.equal(h.frames.size, 0, "pending frame cancelled");
  h.clock += 10 * 60 * 1000; // ten minutes in a background tab
  h.run(1000);
  assert.equal(h.draws, drawsBefore, "nothing drawn while hidden");
  h.setHidden(false);
  assert.equal(h.frames.size, 1, "loop resumes");
  h.run(1000 / 60);
  // Exactly the paused time, give or take the one skipped (undrawn) tick before hiding.
  assert.ok(Math.abs(h.times.at(-1)! - timeBefore) <= 1 / 60 + 1e-9, `first visible frame continues from the paused time (Δ ${h.times.at(-1)! - timeBefore} s, not 600 s)`);
  h.run(1000);
  assert.ok(h.times.at(-1)! - timeBefore < 1.05, "then advances by real time only");
  renderer(h).dispose();
});

test("L. context loss: the loop stops at once, the host is told once, and nothing is drawn afterwards", () => {
  const h = harness();
  h.run(500);
  const draws = h.draws;
  h.loseContext();
  assert.equal(h.contextLostCalls, 1);
  assert.equal(h.frames.size, 0, "pending frame cancelled");
  h.run(1000);
  h.setHidden(true);
  h.setHidden(false);
  h.run(1000);
  h.sizeListener?.(800, 600);
  assert.equal(h.draws, draws, "no further draws, no restart");
  h.loseContext();
  assert.equal(h.contextLostCalls, 1, "reported once");
  const r = renderer(h);
  r.dispose();
  assert.deepEqual(h.deleted, { shaders: 0, programs: 0, buffers: 0 }, "resources died with the context; no GL calls on a lost context");
});

test("M. dispose: cancels the frame, detaches size / visibility / context listeners, frees GL objects, is idempotent", () => {
  const h = harness({}, 500);
  h.run(1000);
  assert.equal(h.frames.size, 1);
  const r = renderer(h);
  const elapsed = r.dispose();
  assert.ok(Math.abs(elapsed - 1500) < 50, "returns the active elapsed time for the next mount");
  assert.equal(h.frames.size, 0, "no hanging animation frame");
  assert.equal(h.sizeListener, null, "size observation disconnected");
  assert.equal(h.visibilityListeners.size, 0, "visibility listener removed");
  assert.equal(h.listeners.get("webglcontextlost")?.size ?? 0, 0, "context listener removed");
  assert.deepEqual(h.deleted, { shaders: 2, programs: 1, buffers: 1 });
  const draws = h.draws;
  h.run(1000);
  assert.equal(h.draws, draws, "nothing runs after dispose");
  assert.equal(r.dispose(), elapsed, "second dispose is a no-op");
  assert.deepEqual(h.deleted, { shaders: 2, programs: 1, buffers: 1 });
});

test("K. only size and time reach the shader: uResolution, uTime, uIntensity — nothing else is ever set", () => {
  const h = harness();
  h.run(1000);
  h.sizeListener!(1728, 1117);
  assert.deepEqual([...h.uniformNames].sort(), ["uIntensity", "uResolution", "uTime"]);
  renderer(h).dispose();
  assert.equal(ambient.AMBIENT_INTENSITY, 1, "a fixed visual constant, not a data signal");
});
