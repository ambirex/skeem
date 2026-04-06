export function parseProviderStepText(text) {
  const candidate = extractJsonCandidate(text);
  let parsed;

  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Provider response was not valid JSON:\n${text}\n${error}`);
  }

  return validateProviderStep(parsed);
}

export function validateProviderStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error("Provider step must be a JSON object.");
  }

  if (step.type === "command" || step.type === undefined) {
    if (typeof step.command !== "string" || step.command.trim().length === 0) {
      throw new Error('Command steps must include a non-empty "command" string.');
    }

    return {
      type: "command",
      command: step.command.trim(),
      ...(step.stdin !== undefined ? { stdin: step.stdin } : {}),
    };
  }

  if (step.type === "answer") {
    if (typeof step.text !== "string" || step.text.trim().length === 0) {
      throw new Error('Answer steps must include a non-empty "text" string.');
    }

    return {
      type: "answer",
      text: step.text.trim(),
    };
  }

  throw new Error(`Unsupported provider step type: ${step.type}`);
}

export async function readJsonFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new Error("Expected JSON input on stdin.");
  }
  return JSON.parse(raw);
}

function extractJsonCandidate(text) {
  const trimmed = String(text).trim();
  if (!trimmed) {
    throw new Error("Provider returned an empty response.");
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1];
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error(`Provider response did not contain a JSON object:\n${text}`);
}
