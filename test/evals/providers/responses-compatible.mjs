import { parseProviderStepText } from "./shared.mjs";

export async function requestResponsesStep(options) {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify({
      model: options.model,
      input: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_output_tokens: options.maxOutputTokens,
      ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
      ...(options.extraBody ?? {}),
    }),
  });

  const body = await response.json().catch(async () => ({
    error: {
      message: await response.text(),
    },
  }));

  if (!response.ok) {
    const errorMessage = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(`${options.providerName} provider request failed: ${errorMessage}`);
  }

  return parseProviderStepText(extractResponsesText(body));
}

export function extractResponsesText(body) {
  if (typeof body.output_text === "string" && body.output_text.trim().length > 0) {
    return body.output_text;
  }

  const parts = [];
  for (const output of body.output ?? []) {
    if (output?.type !== "message" || !Array.isArray(output.content)) {
      continue;
    }

    for (const content of output.content) {
      if (typeof content?.text === "string" && (content.type === "output_text" || content.type === "text")) {
        parts.push(content.text);
      }
    }
  }

  if (parts.length > 0) {
    return parts.join("\n");
  }

  throw new Error(`Responses API payload did not include text output:\n${JSON.stringify(body, null, 2)}`);
}
