/**
 * Demo: Propose a "shell_command" action and wait for approval.
 *
 * Simulates an agent that wants to execute a shell command on the host.
 * This is the "scariest" action type — it makes AgentSeam's value
 * proposition immediately obvious.
 *
 * The demo runs a safe command (echo + date) so nothing destructive happens.
 *
 * Usage:
 *   1. Start the AgentSeam app:        pnpm dev
 *   2. Run this script in another terminal:
 *      pnpm tsx packages/sdk/examples/demo-shell-command.ts
 *   3. Open http://localhost:3000/app/inbox and approve the action.
 *   4. Watch this terminal — the command will execute after approval.
 *
 * Environment variables:
 *   AGENTSEAM_URL     Base URL of your AgentSeam instance (default: http://localhost:3000)
 *   AGENTSEAM_API_KEY Your API key from the Settings page
 */

import { execSync } from "node:child_process";
import { AgentSeam, RejectedError, TimeoutError } from "../src/index.js";

const baseUrl = process.env.AGENTSEAM_URL ?? "http://localhost:3000";
const apiKey = process.env.AGENTSEAM_API_KEY ?? "";

if (!apiKey) {
  console.error(
    "Set AGENTSEAM_API_KEY to a valid key from your Settings page.",
  );
  process.exit(1);
}

const seam = new AgentSeam({ baseUrl, apiKey });

const command =
  process.platform === "win32"
    ? "echo Hello from AgentSeam && date /t"
    : 'echo "Hello from AgentSeam" && date';

const workingDirectory = process.cwd();

async function executeShellCommand() {
  console.log(`  [shell] Running: ${command}`);
  console.log(`  [shell] Working directory: ${workingDirectory}`);

  const stdout = execSync(command, { encoding: "utf-8" }).trim();

  console.log(`  [shell] Output:\n${stdout.split("\n").map((l) => `    ${l}`).join("\n")}`);
  return { exitCode: 0, stdout };
}

async function main() {
  console.log("Proposing shell_command action...");
  console.log(`  Dashboard: ${baseUrl}/app/inbox`);
  console.log("  Waiting for approval (polls every 3s, timeout 5min)...\n");

  try {
    const result = await seam.proposeAndWait({
      agentId: "demo-agent",
      actionType: "shell_command",
      payload: {
        command,
        workingDirectory,
        description: "Print a greeting and the current date",
      },
      execute: executeShellCommand,
      pollIntervalMs: 3_000,
      timeoutMs: 5 * 60 * 1_000,
      onPoll: (action) => {
        console.log(`  [poll] status: ${action.status}`);
      },
    });

    console.log("\nAction approved and executed!");
    console.log("Result:", result);
  } catch (err) {
    if (err instanceof RejectedError) {
      console.log(`\nAction was ${err.actionStatus}. Command NOT executed.`);
    } else if (err instanceof TimeoutError) {
      console.log("\nTimed out waiting for a decision. Command NOT executed.");
    } else {
      throw err;
    }
  }
}

main();
