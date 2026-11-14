/** Public projection only. Credentials and internal filesystem paths never belong here. */
export type OpenAIApiLimits = Readonly<{
  model: string;
  maxContextBytes: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxInvocationCostUsdMicros: number;
  dailyBudgetUsdMicros: number;
}>;
export type OpenAIApiAccessView = Readonly<{
  state: "not_connected" | "connected" | "configuration_invalid" | "temporarily_unavailable";
  limits: OpenAIApiLimits | null;
  /** Configuring a key never grants execution authority. */
  executionAvailable: false;
}>;
