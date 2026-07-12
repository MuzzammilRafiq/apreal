import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const SERVER_LOCK_FILENAME = "server.pid";

export type ProcessLock = Readonly<{
	path: string;
	pid: number;
	release: () => Promise<void>;
}>;

export function isProcessRunning(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
	}
}

export async function readLockedPid(runDirectory: string): Promise<number | null> {
	try {
		const value = (await readFile(join(runDirectory, SERVER_LOCK_FILENAME), "utf8")).trim();
		const pid = Number(value);
		return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

export async function acquireProcessLock(runDirectory: string): Promise<ProcessLock> {
	await mkdir(runDirectory, { recursive: true, mode: 0o700 });
	const lockPath = join(runDirectory, SERVER_LOCK_FILENAME);

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(lockPath, "wx", 0o600);
			await handle.writeFile(`${process.pid}\n`);
			await handle.close();
			let released = false;
			return {
				path: lockPath,
				pid: process.pid,
				release: async () => {
					if (released) return;
					released = true;
					if (await readLockedPid(runDirectory) === process.pid) await rm(lockPath, { force: true });
				},
			};
		} catch (error) {
			if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
			const existingPid = await readLockedPid(runDirectory);
			if (existingPid !== null && isProcessRunning(existingPid)) {
				throw new Error(`Apreal is already running for this home (PID ${existingPid})`);
			}
			await rm(lockPath, { force: true });
		}
	}

	throw new Error(`Unable to acquire Apreal process lock at ${lockPath}`);
}
