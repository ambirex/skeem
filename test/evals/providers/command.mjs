import { spawnSync } from "node:child_process";

import { parseProviderStepText } from "./shared.mjs";

export function createCommandProvider(options) {
  if (!options.command) {
    throw new Error('The command provider requires --provider-command "<shell command>".');
  }

  return {
    name: "command",
    metadata: {
      command: options.command,
    },
    async nextStep(input) {
      const payload = {
        case: {
          id: input.caseDefinition.id,
          title: input.caseDefinition.title,
          category: input.caseDefinition.category,
          goal: input.caseDefinition.goal,
          prompt: input.caseDefinition.prompt,
          allowed_commands: input.caseDefinition.allowed_commands ?? [],
        },
        workspaceDir: input.runContext.workspaceDir,
        artifacts: input.runContext.artifacts,
        seed: input.runContext.seed,
        stepIndex: input.stepIndex,
        messages: input.messages,
        execution: input.execution,
      };

      const result = spawnSync(process.env.SHELL || "zsh", ["-lc", options.command], {
        cwd: options.cwd ?? input.runContext.workspaceDir,
        env: input.runContext.env,
        input: `${JSON.stringify(payload, null, 2)}\n`,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(`Command provider failed:\n${result.stderr || result.stdout}`);
      }

      return parseProviderStepText(result.stdout);
    },
  };
}
