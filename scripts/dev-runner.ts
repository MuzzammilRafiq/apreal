import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type ProcessName = "server" | "web";

type ProcessSpec = {
	name: ProcessName;
	command: string[];
	color: string;
	logFileName: string;
	stdio: NodeJS.WriteStream;
};

const ANSI_RESET = "\u001B[0m";
const ANSI_COLORS: Record<ProcessName, string> = {
	server: "\u001B[36m",
	web: "\u001B[33m",
};

const workspaceRoot = process.cwd();
const logDirectory = join(workspaceRoot, "dev", "logs");

const processSpecs: ProcessSpec[] = [
	{
		name: "server",
		command: ["pnpm", "--dir", "apps/server", "dev"],
		color: ANSI_COLORS.server,
		logFileName: "server.log",
		stdio: process.stdout,
	},
	{
		name: "web",
		command: ["pnpm", "--dir", "apps/web", "dev"],
		color: ANSI_COLORS.web,
		logFileName: "web.log",
		stdio: process.stdout,
	},
];

function isDirectExecution(moduleUrl: string) {
	const entryPoint = process.argv[1];
	return typeof entryPoint === "string" && fileURLToPath(moduleUrl) === entryPoint;
}

function prefixLine(spec: ProcessSpec, line: string) {
	const suffix = line.length > 0 ? ` ${line}` : "";
	spec.stdio.write(`${spec.color}[${spec.name}]${ANSI_RESET}${suffix}\n`);
}

function flushBufferedLines(spec: ProcessSpec, bufferedText: string, flushPartial = false): string {
	const segments = bufferedText.split(/\r\n|\n|\r/g);
	const remainder = flushPartial ? "" : (segments.pop() ?? "");

	for (const segment of segments) {
		prefixLine(spec, segment);
	}

	if (flushPartial && remainder.length > 0) {
		prefixLine(spec, remainder);
	}

	return remainder;
}

async function pipeStream(
	stream: NodeJS.ReadableStream | null,
	spec: ProcessSpec,
	logStream: WriteStream,
) {
	if (!stream) {
		return;
	}

	let bufferedText = "";

	await new Promise<void>((resolve, reject) => {
		stream.on("data", (chunk: Buffer | string) => {
			logStream.write(chunk);
			bufferedText += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			bufferedText = flushBufferedLines(spec, bufferedText);
		});

		stream.once("end", () => {
			flushBufferedLines(spec, bufferedText, true);
			resolve();
		});

		stream.once("error", reject);
	});
}

async function main() {
	mkdirSync(logDirectory, { recursive: true });

	const activeChildren = new Map<ProcessName, ChildProcess>();
	const exitSignals: Array<Promise<{ name: ProcessName; exitCode: number }>> = [];
	let shuttingDown = false;

	function stopAll() {
		for (const child of activeChildren.values()) {
			try {
				child.kill();
			} catch {
				// Ignore process shutdown races.
			}
		}
	}

	for (const spec of processSpecs) {
		const logPath = join(logDirectory, spec.logFileName);
		const logStream = createWriteStream(logPath, { flags: "a" });
		const [command, ...args] = spec.command;
		if (!command) {
			throw new Error(`Missing command for ${spec.name}`);
		}

		const child: ChildProcess = spawn(command, args, {
			cwd: workspaceRoot,
			env: process.env,
			stdio: ["inherit", "pipe", "pipe"],
		});

		activeChildren.set(spec.name, child);
		prefixLine(spec, `logging to ${logPath}`);

		const stdoutDone = pipeStream(child.stdout, spec, logStream);
		const stderrDone = pipeStream(child.stderr, spec, logStream);

		exitSignals.push(
			new Promise<{ name: ProcessName; exitCode: number }>((resolve, reject) => {
				child.once("error", reject);
				child.once("close", async (exitCode: number | null) => {
				activeChildren.delete(spec.name);
				await Promise.allSettled([stdoutDone, stderrDone]);
				await new Promise<void>((resolve, reject) => {
					logStream.end((error: Error | null | undefined) => {
						if (error) {
							reject(error);
							return;
						}

						resolve();
					});
				});
					resolve({ name: spec.name, exitCode: exitCode ?? 1 });
				});
			}),
		);
	}

	const handleSignal = () => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		stopAll();
	};

	process.on("SIGINT", handleSignal);
	process.on("SIGTERM", handleSignal);

	const firstExit = await Promise.race(exitSignals);
	if (!shuttingDown) {
		shuttingDown = true;
		process.stderr.write(
			`${ANSI_COLORS.server}[dev]${ANSI_RESET} ${firstExit.name} exited with code ${firstExit.exitCode}; stopping remaining process.\n`,
		);
		stopAll();
	}

	const exitResults = await Promise.all(exitSignals);
	const failingExit = exitResults.find((result) => result.exitCode !== 0);
	process.exit(failingExit?.exitCode ?? firstExit.exitCode);
}

if (isDirectExecution(import.meta.url)) {
	void main();
}