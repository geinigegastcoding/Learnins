import { realpathSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import net from "node:net";
import electron from "electron";

const root = process.cwd();
const realModules = realpathSync(path.join(root, "node_modules"));
const relative = path.relative(root, realModules);
const env = { ...process.env };
if (!env.LH_TURBOPACK_ROOT && (relative.startsWith("..") || path.isAbsolute(relative))) {
	let common = root;
	while (path.relative(common, realModules).startsWith("..")) {
		const parent = path.dirname(common);
		if (parent === common) break;
		common = parent;
	}
	env.LH_TURBOPACK_ROOT = common;
}
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const devUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "inherit", env });
let desktop;
let finished = false;
function stop(code = 0) {
	if (finished) return;
	finished = true;
	desktop?.kill();
	// Windows kills only the CLI process by default; Next starts a child server.
	if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
	else server.kill();
	process.exitCode = code;
}
server.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
	let ready = false;
	for (let attempt = 0; attempt < 120 && !finished; attempt++) {
		try { const response = await fetch(`${devUrl}/brands/xai.svg`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } }
		catch { /* The server may still be starting. */ }
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	if (!ready) throw new Error("The development server did not become ready.");
	const desktopEnv = { ...env, LH_DEV_URL: devUrl };
	delete desktopEnv.ELECTRON_RUN_AS_NODE;
	desktop = spawn(electron, ["."], { stdio: "inherit", env: desktopEnv });
	desktop.on("exit", (code) => stop(code ?? 0));
	desktop.on("error", (error) => { console.error(error); stop(1); });
} catch (error) {
	console.error(error);
	stop(1);
}
