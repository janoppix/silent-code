import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("npx", ["tsx", "scripts/build.ts"], { cwd: process.cwd() });
}
