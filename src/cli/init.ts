import { stdin } from "node:process";

export function chooseMode(isTty: boolean): "wizard" | "plain" {
  return isTty ? "wizard" : "plain";
}

export async function runInit(cwd = process.cwd()): Promise<number> {
  if (chooseMode(Boolean(stdin.isTTY)) === "plain") {
    const { runPlainInit } = await import("./init-plain.js");
    return runPlainInit(cwd);
  }

  const { runWizard } = await import("./wizard/run.js");
  try {
    return await runWizard(cwd);
  } catch (err) {
    // Ctrl+C inside a prompt throws rather than exiting; that is a normal quit.
    if ((err as { name?: string }).name === "ExitPromptError") {
      console.log("\nCancelled. Nothing was written.");
      return 130;
    }
    throw err;
  }
}
