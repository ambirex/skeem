import { requestResponsesStep } from "./responses-compatible.mjs";

const DEFAULT_BASE_URL = "https://nano-gpt.com/api/v1";
const DEFAULT_MODELS_URL = "https://nano-gpt.com/api/v1/models?detailed=true";

export async function createNanoGptProvider(options) {
  if (!options.model) {
    throw new Error('The nano-gpt provider requires --model <model-id>.');
  }

  const apiKey = process.env.NANO_GPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("The nano-gpt provider requires NANO_GPT_API_KEY in the environment.");
  }

  const baseUrl = options.baseUrl ?? process.env.NANO_GPT_BASE_URL ?? DEFAULT_BASE_URL;
  const modelsUrl = options.modelsUrl ?? process.env.NANO_GPT_MODELS_URL ?? DEFAULT_MODELS_URL;
  const maxOutputTokens = options.maxOutputTokens ?? 600;
  const modelInfo = await fetchNanoGptModelInfo({
    apiKey,
    model: options.model,
    modelsUrl,
  });

  return {
    name: "nano-gpt",
    metadata: {
      model: options.model,
      baseUrl,
      modelsUrl,
      maxOutputTokens,
      capabilities: modelInfo?.capabilities ?? null,
      contextLength: modelInfo?.context_length ?? null,
      maxModelOutputTokens: modelInfo?.max_output_tokens ?? null,
      subscription: modelInfo?.subscription ?? null,
      pricing: modelInfo?.pricing ?? null,
    },
    async nextStep(input) {
      return requestResponsesStep({
        providerName: "Nano-GPT",
        baseUrl,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
        },
        model: options.model,
        messages: input.messages,
        maxOutputTokens,
        reasoningEffort: modelInfo?.capabilities?.reasoning ? options.reasoningEffort : undefined,
      });
    },
  };
}

export async function fetchNanoGptModelInfo(input) {
  const response = await fetch(input.modelsUrl, {
    headers: {
      Accept: "application/json",
      ...(input.apiKey
        ? {
            Authorization: `Bearer ${input.apiKey}`,
            "x-api-key": input.apiKey,
          }
        : {}),
    },
  });

  const body = await response.json().catch(async () => ({
    error: {
      message: await response.text(),
    },
  }));

  if (!response.ok) {
    const errorMessage = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(`Nano-GPT models request failed: ${errorMessage}`);
  }

  const models = Array.isArray(body?.data) ? body.data : [];
  const match = models.find((entry) => entry?.id === input.model);
  if (!match) {
    const available = models.slice(0, 25).map((entry) => entry?.id).filter(Boolean);
    throw new Error(`Nano-GPT model "${input.model}" was not found. Sample available models: ${available.join(", ")}`);
  }

  return match;
}
