import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";

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
		command: ["bun", "run", "--cwd", "apps/server", "dev"],
		color: ANSI_COLORS.server,
		logFileName: "server.log",
		stdio: process.stdout,
	},
	{
		name: "web",
		command: ["bun", "run", "--cwd", "apps/web", "dev"],
		color: ANSI_COLORS.web,
		logFileName: "web.log",
		stdio: process.stdout,
	},
];

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
	stream: ReadableStream<Uint8Array> | null,
	spec: ProcessSpec,
	logStream: WriteStream,
) {
	if (!stream) {
		return;
	}

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let bufferedText = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			if (!value) {
				continue;
			}

			logStream.write(Buffer.from(value));
			bufferedText += decoder.decode(value, { stream: true });
			bufferedText = flushBufferedLines(spec, bufferedText);
		}
	} finally {
		bufferedText += decoder.decode();
		flushBufferedLines(spec, bufferedText, true);
		reader.releaseLock();
	}
}

async function main() {
	mkdirSync(logDirectory, { recursive: true });

	const activeChildren = new Map<ProcessName, Bun.Subprocess>();
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
		const child = Bun.spawn(spec.command, {
			cwd: workspaceRoot,
			env: process.env,
			stdin: "inherit",
			stdout: "pipe",
			stderr: "pipe",
		});

		activeChildren.set(spec.name, child);
		prefixLine(spec, `logging to ${logPath}`);

		const stdoutDone = pipeStream(child.stdout, spec, logStream);
		const stderrDone = pipeStream(child.stderr, spec, logStream);

		exitSignals.push(
			child.exited.then(async (exitCode) => {
				activeChildren.delete(spec.name);
				await Promise.allSettled([stdoutDone, stderrDone]);
				await new Promise<void>((resolve, reject) => {
					logStream.end((error:any) => {
						if (error) {
							reject(error);
							return;
						}

						resolve();
					});
				});
				return { name: spec.name, exitCode };
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

if (import.meta.main) {
	void main();
}