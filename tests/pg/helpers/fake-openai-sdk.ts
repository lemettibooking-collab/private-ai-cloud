/* eslint-disable @typescript-eslint/no-explicit-any -- fake SDK objects cross untyped adapter boundaries */
// Deterministic in-memory OpenAI SDK client for the M2.1 real-provider simulation. It sits BELOW
// the real OpenAI adapter (injected through the adapter's createClient seam), so the adapter's own
// mapping, validation and error classification are exercised. Nothing here can reach the network:
// every method is local and every unexpected path throws.
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";

export const fakeModel = Object.freeze({
  identity: Object.freeze({
    providerId: "provider-openai",
    providerKind: "openai",
    deploymentId: "deployment-openai-m2",
    providerModelId: "gpt-m2-alias",
    providerRequestModelId: "gpt-m2-pinned",
    providerModelVersion: "gpt-m2-pinned-2026-01-01",
  }),
  maxInputTokens: 2_000,
  maxOutputTokens: 16,
  // Test prices only (USD micros per million tokens); never a live price claim.
  inputCostUsdMicrosPerMillionTokens: 150_000,
  outputCostUsdMicrosPerMillionTokens: 600_000,
});

export const fakeUsage = Object.freeze({ inputTokens: 21, outputTokens: 3 });

// Same formula as the adapter: ceil((in * inPrice + out * outPrice) / 1e6).
export function expectedCostUsdMicros(inputTokens: number, outputTokens: number): number {
  const numerator = inputTokens * fakeModel.inputCostUsdMicrosPerMillionTokens
    + outputTokens * fakeModel.outputCostUsdMicrosPerMillionTokens;
  return Math.ceil(numerator / 1_000_000);
}

export function completedResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: fakeModel.identity.providerModelVersion,
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK" }] }],
    usage: {
      input_tokens: fakeUsage.inputTokens,
      output_tokens: fakeUsage.outputTokens,
      total_tokens: fakeUsage.inputTokens + fakeUsage.outputTokens,
    },
    ...overrides,
  };
}

// A terminal refusal that OpenAI bills: outcome failed, finish_reason content_filter, real usage.
export function refusalResponse() {
  return completedResponse({
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "I can't help with that." }] }],
  });
}

const headers = () => new Headers();
export const sdkErrors = Object.freeze({
  timeout: () => new APIConnectionTimeoutError({ message: "fake-timeout" }),
  connection: () => new APIConnectionError({ message: "fake-connection" }),
  server500: () => APIError.generate(500, {}, "fake-500", headers()),
  server503: () => APIError.generate(503, {}, "fake-503", headers()),
  unknown: () => new Error("fake-unknown-error"),
  badRequest400: () => APIError.generate(400, {}, "fake-400", headers()),
  auth401: () => APIError.generate(401, {}, "fake-401", headers()),
  permission403: () => APIError.generate(403, {}, "fake-403", headers()),
  notFound404: () => APIError.generate(404, {}, "fake-404", headers()),
  unprocessable422: () => APIError.generate(422, {}, "fake-422", headers()),
  rateLimit429: () => APIError.generate(429, {}, "fake-429", headers()),
});

export type FakeGeneration = Readonly<{ response?: unknown; error?: () => unknown }>;

export function fakeOpenAISdk(options: Readonly<{
  inputTokenCount?: number;
  countError?: () => unknown;
  // Simulates a slow remote token count (real wall-clock time; the provider-start fence reads it).
  countDelayMs?: number;
  generations?: readonly FakeGeneration[];
}> = {}) {
  const calls = { clientOptions: [] as any[], counts: 0, creates: 0, createInputs: [] as any[], unexpected: 0 };
  const generations = [...(options.generations ?? [{ response: completedResponse() }])];
  const createClient = (clientOptions: any) => {
    calls.clientOptions.push({ ...clientOptions });
    return {
      responses: {
        async create(input: any) {
          calls.creates += 1;
          calls.createInputs.push(structuredClone(input));
          const next = generations.shift();
          if (!next) { calls.unexpected += 1; throw new Error("fake SDK: unexpected additional generation"); }
          if (next.error) throw next.error();
          return structuredClone(next.response);
        },
        inputTokens: {
          async count() {
            calls.counts += 1;
            if (options.countDelayMs) await new Promise((resolve) => setTimeout(resolve, options.countDelayMs));
            if (options.countError) throw options.countError();
            return { object: "response.input_tokens", input_tokens: options.inputTokenCount ?? fakeUsage.inputTokens };
          },
        },
      },
      models: {
        async retrieve() { calls.unexpected += 1; throw new Error("fake SDK: models.retrieve is not expected"); },
      },
    };
  };
  return { createClient, calls };
}
