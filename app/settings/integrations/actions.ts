"use server";

// AI-039.2 ChatGPT plan integration Server Actions (Owner of THIS request, re-verified server-side).
// Connect redirects to the official authorization URL; the others change only the local integration
// credential store. None performs inference, and none touches PAC authentication, tasks, plans or runs.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { disconnectChatGPT, refreshChatGPTModels, selectChatGPTModel, startChatGPTConnection } from "@/lib/composition/chatgpt-integration.server";

const settingsRoute = "/settings/integrations";

export async function connectChatGPTAction(): Promise<void> {
  const host = (await headers()).get("host") ?? "";
  const result = await startChatGPTConnection(`http://${host}`);
  if (result.status === "redirect") redirect(result.url);
  redirect(`${settingsRoute}?chatgpt=${result.status === "unauthenticated" ? "unauthenticated" : "start_failed"}`);
}

export async function disconnectChatGPTAction(): Promise<void> {
  const result = await disconnectChatGPT();
  const notice = result.status === "disconnected"
    ? result.remoteRevocation === "unconfirmed" ? "disconnected_unconfirmed" : "disconnected"
    : "action_failed";
  redirect(`${settingsRoute}?chatgpt=${notice}`);
}

export async function refreshChatGPTModelsAction(): Promise<void> {
  const result = await refreshChatGPTModels();
  redirect(`${settingsRoute}?chatgpt=${result === "updated" ? "models_updated" : result === "reauthorization_required" ? "reauthorization_required" : "action_failed"}`);
}

export async function selectChatGPTModelAction(form: FormData): Promise<void> {
  const values = form.getAll("model");
  const result = values.length === 1 ? await selectChatGPTModel(values[0]) : "invalid";
  redirect(`${settingsRoute}?chatgpt=${result === "selected" ? "model_selected" : "action_failed"}`);
}
