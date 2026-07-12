import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAprealRuntime } from "./config.ts";
import { isProcessRunning, readLockedPid } from "./process-lock.ts";

function releaseRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function version(): Promise<string> {
	return (await readFile(join(releaseRoot(), "VERSION"), "utf8")).trim();
}

async function status(): Promise<number> {
	const runtime = loadAprealRuntime();
	const pid = await readLockedPid(runtime.paths.run);
	if (pid !== null && isProcessRunning(pid)) {
		console.log(`Apreal is running (PID ${pid}, home ${runtime.home})`);
		return 0;
	}
	console.log(`Apreal is not running (home ${runtime.home})`);
	return 1;
}

async function start(args: readonly string[]): Promise<number> {
	if (args.includes("--foreground") === false) {
		console.log("Apreal currently starts in the foreground. Closing this terminal will stop it.");
	}
	const serverEntry = join(releaseRoot(), "server", "apreal-server.mjs");
	const runtime = loadAprealRuntime(args);
	await mkdir(runtime.paths.logs, { recursive: true, mode: 0o700 });
	const logStream = createWriteStream(join(runtime.paths.logs, "server.log"), { flags: "a", mode: 0o600 });
	const child = spawn(process.execPath, [serverEntry, ...args.filter((arg) => arg !== "--foreground")], {
		stdio: ["inherit", "pipe", "pipe"],
	});
	child.stdout?.pipe(process.stdout);
	child.stdout?.pipe(logStream, { end: false });
	child.stderr?.pipe(process.stderr);
	child.stderr?.pipe(logStream, { end: false });
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => child.kill(signal));
	}
	return await new Promise<number>((resolveExit) => {
		child.once("error", (error) => {
			console.error(`Unable to start Apreal: ${error.message}`);
			resolveExit(1);
		});
		child.once("exit", (code, signal) => {
			logStream.end();
			resolveExit(code ?? (signal ? 1 : 0));
		});
	});
}

async function stop(): Promise<number> {
	const runtime = loadAprealRuntime();
	const pid = await readLockedPid(runtime.paths.run);
	if (pid === null || !isProcessRunning(pid)) {
		console.log(`Apreal is not running (home ${runtime.home})`);
		return 1;
	}
	process.kill(pid, "SIGTERM");
	console.log(`Stopping Apreal (PID ${pid})`);
	return 0;
}

async function logs(): Promise<number> {
	const runtime = loadAprealRuntime();
	const logPath = join(runtime.paths.logs, "server.log");
	try {
		process.stdout.write(await readFile(logPath, "utf8"));
		return 0;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			console.log(`No server log exists yet at ${logPath}`);
			return 1;
		}
		throw error;
	}
}

function usage(): void {
	console.log("Usage: apreal <start|stop|status|logs|version> [--home PATH] [--foreground]");
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
	const [command, ...args] = argv;
	if (command === "version" || command === "--version" || command === "-v") {
		console.log(await version());
		return 0;
	}
	if (command === "status") return status();
	if (command === "start") return start(args);
	if (command === "stop") return stop();
	if (command === "logs") return logs();
	usage();
	return command ? 2 : 0;
}

void runCli().then((code) => {
	process.exitCode = code;
}).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
