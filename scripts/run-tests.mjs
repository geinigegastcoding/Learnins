import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const files = process.argv.slice(2);
const tests = files.length ? files : readdirSync("tests").filter((name) => /\.test\.tsx?$/.test(name)).map((name) => path.join("tests", name));
const child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--test", "--test-concurrency=2", ...tests], {
	stdio: "inherit",
	env: { ...process.env, NODE_ENV: "test" },
});
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
