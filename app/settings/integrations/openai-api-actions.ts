"use server";
import { redirect } from "next/navigation";
import { configureOpenAIApiAccess, disconnectOpenAIApiAccess, saveOpenAIApiAccess } from "@/lib/composition/openai-api-access.server";

function limits(form: FormData) {
  const integer = (key: string) => { const v = form.get(key); return typeof v === "string" && /^[1-9][0-9]{0,9}$/u.test(v) ? Number(v) : null; };
  return { model: form.get("model"), maxContextBytes: integer("maxContextBytes"), maxInputTokens: integer("maxInputTokens"), maxOutputTokens: integer("maxOutputTokens"),
    maxInvocationCostUsdMicros: integer("maxInvocationCostUsdMicros"), dailyBudgetUsdMicros: integer("dailyBudgetUsdMicros") };
}
export async function connectOpenAIApiAction(form: FormData): Promise<void> {
  // Never echo FormData, return the key, bind it into client props or retain it in action state.
  const key = form.get("apiKey"); const policy = limits(form); form.delete("apiKey");
  const result = await saveOpenAIApiAccess(key, policy);
  redirect(`/settings/integrations?openai_api=${result}`);
}
export async function configureOpenAIApiAction(form: FormData): Promise<void> {
  const result = await configureOpenAIApiAccess(limits(form));
  redirect(`/settings/integrations?openai_api=${result}`);
}
export async function disconnectOpenAIApiAction(): Promise<void> {
  const result = await disconnectOpenAIApiAccess();
  redirect(`/settings/integrations?openai_api=${result}`);
}
