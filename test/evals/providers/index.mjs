import { createCommandProvider } from "./command.mjs";
import { createNanoGptProvider } from "./nano-gpt.mjs";
import { createOpenAIProvider } from "./openai.mjs";

export async function createEvalProvider(options) {
  switch (options.provider) {
    case "command":
      return createCommandProvider(options);
    case "nano-gpt":
      return createNanoGptProvider(options);
    case "openai":
      return createOpenAIProvider(options);
    default:
      throw new Error(`Unsupported provider "${options.provider}". Supported providers: command, openai, nano-gpt.`);
  }
}
