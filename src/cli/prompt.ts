import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";

export class Prompt {
  private rl: Interface;

  constructor() {
    this.rl = createInterface({ input: stdin, output: stdout });
  }

  async text(
    question: string,
    opts: { default?: string; required?: boolean } = {},
  ): Promise<string> {
    const suffix = opts.default ? ` [${opts.default}]` : "";
    for (;;) {
      const answer = (await this.rl.question(`${question}${suffix}: `)).trim();
      if (answer) return answer;
      if (opts.default !== undefined) return opts.default;
      if (!opts.required) return "";
      stdout.write("  (required)\n");
    }
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? "Y/n" : "y/N";
    const answer = (await this.rl.question(`${question} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer.startsWith("y");
  }

  close(): void {
    this.rl.close();
  }
}
