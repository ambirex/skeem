import { requestResponsesStep } from "./responses-compatible.mjs";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createOpenAIProvider(options) {
  if (!options.model) {
    throw new Error('The OpenAI provider requires --model <responses-model>.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("The OpenAI provider requires OPENAI_API_KEY in the environment.");
  }

  const baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
  const maxOutputTokens = options.maxOutputTokens ?? 600;

  return {
    name: "openai",
    metadata: {
      model: options.model,
      baseUrl,
      maxOutputTokens,
    },
    async nextStep(input) {
      return requestResponsesStep({
        providerName: "OpenAI",
        baseUrl,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        model: options.model,
        messages: input.messages,
        maxOutputTokens,
        reasoningEffort: options.reasoningEffort,
      });
    },
  };
}
