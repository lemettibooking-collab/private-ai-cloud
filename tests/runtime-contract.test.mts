import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type RuntimeContractPackage = {
  packageManager?: string;
  engines?: {
    node?: string;
    npm?: string;
  };
  scripts?: Record<string, string>;
};

const expectedScripts = {
  dev: "next dev",
  build: "next build",
  start: "next start",
  lint: "eslint",
  typecheck: "tsc --noEmit --incremental false",
  test: "node --test tests/runtime-contract.test.mts",
} as const;

function validateRuntimeContract(packageJson: RuntimeContractPackage): string[] {
  const errors: string[] = [];

  if (packageJson.packageManager !== "npm@11.8.0") {
    errors.push("packageManager must be npm@11.8.0");
  }

  if (packageJson.engines?.node !== "24.13.x") {
    errors.push("Node.js engine must be pinned to 24.13.x");
  }

  if (packageJson.engines?.npm !== "11.8.x") {
    errors.push("npm engine must be pinned to 11.8.x");
  }

  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      errors.push(`script ${name} must be ${command}`);
    }
  }

  return errors;
}

test("runtime and verification metadata matches the supported contract", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as RuntimeContractPackage;

  assert.deepEqual(validateRuntimeContract(packageJson), []);
  assert.match(process.versions.node, /^24\.13\./);
  assert.match(process.env.npm_config_user_agent ?? "", /^npm\/11\.8\.0(?:\s|$)/);
});
