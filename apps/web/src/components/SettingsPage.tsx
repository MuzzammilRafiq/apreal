import { useState } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";

type SettingsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	statusError: string | null;
	isSubmitting: boolean;
	submissionMessage: string | null;
	submissionError: string | null;
	onBack: () => void;
	onRefresh: () => void;
	onSubmitPairingCode: (pairingCode: string) => void;
};

function renderStatusPill(label: string, tone: "neutral" | "success" | "danger") {
	const toneClassName = tone === "success"
		? "border-accent-line bg-accent-soft text-accent"
		: tone === "danger"
			? "border-danger-line bg-danger-soft text-danger"
			: "border-line bg-ink-soft text-muted";

	return (
		<span className={`inline-flex border px-2.5 py-1 font-mono text-[0.69rem] uppercase tracking-[0.12em] ${toneClassName}`}>
			{label}
		</span>
	);
}

function getRelayTone(value: boolean): "success" | "danger" {
	return value ? "success" : "danger";
}

export function SettingsPage({
	adminStatus,
	statusError,
	isSubmitting,
	submissionMessage,
	submissionError,
	onBack,
	onRefresh,
	onSubmitPairingCode,
}: SettingsPageProps) {
	const [pairingCode, setPairingCode] = useState("");

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSubmitPairingCode(pairingCode);
	};

	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 py-6 min-[860px]:px-8">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
					<div>
						<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">Server settings</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Local server control</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
							The browser talks to the local server directly. Relay actions stay here as explicit server controls.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onRefresh}
						>
							Refresh status
						</button>
						<button
							type="button"
							className="border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onBack}
						>
							Back to chat
						</button>
					</div>
				</header>

				<div className="grid flex-1 gap-5 py-6 min-[961px]:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
					<section className="space-y-5">
						<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Server runtime</p>
									<h2 className="mt-2 text-xl font-semibold">Current process</h2>
								</div>
								{adminStatus ? renderStatusPill("Online", "success") : renderStatusPill("Offline", "danger")}
							</div>

							{statusError ? (
								<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-3 text-sm leading-6 text-danger">
									{statusError}
								</p>
							) : null}

							<dl className="mt-5 grid gap-4 text-sm leading-6 min-[700px]:grid-cols-2">
								<div className="border border-line bg-surface-strong px-4 py-4">
									<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Port</dt>
									<dd className="mt-2 text-base font-medium text-ink">{adminStatus?.port ?? "Unavailable"}</dd>
								</div>
								<div className="border border-line bg-surface-strong px-4 py-4">
									<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Agent id</dt>
									<dd className="mt-2 break-all text-base font-medium text-ink">{adminStatus?.agentId ?? "Not registered"}</dd>
								</div>
								<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
									<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Workspace</dt>
									<dd className="mt-2 break-all text-sm text-ink">{adminStatus?.cwd ?? "Unavailable"}</dd>
								</div>
								<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
									<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Web UI assets</dt>
									<dd className="mt-2 text-sm text-ink">
										{adminStatus?.webUiReady ? "Ready" : "Missing build output"}
										{adminStatus?.webUiPath ? ` · ${adminStatus.webUiPath}` : ""}
									</dd>
								</div>
							</dl>
						</div>

						<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Relay</p>
									<h2 className="mt-2 text-xl font-semibold">Pairing and transport</h2>
								</div>
								{renderStatusPill(adminStatus?.relayReady ? "Paired" : "Needs auth", getRelayTone(Boolean(adminStatus?.relayReady)))}
							</div>

							<div className="mt-5 grid gap-4 min-[700px]:grid-cols-2">
								<div className="border border-line bg-surface-strong px-4 py-4">
									<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay auth</p>
									<p className="mt-2 text-base font-medium text-ink">{adminStatus?.relayReady ? "Available" : "Not ready"}</p>
								</div>
								<div className="border border-line bg-surface-strong px-4 py-4">
									<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay transport</p>
									<p className="mt-2 text-base font-medium text-ink">
										{adminStatus?.relayTransportConnected ? "Connected" : "Idle or reconnecting"}
									</p>
								</div>
								<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
									<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay URL</p>
									<p className="mt-2 break-all text-sm text-ink">{adminStatus?.relayUrl ?? "Unavailable"}</p>
								</div>
								{adminStatus?.relayStartupError ? (
									<div className="border border-danger-line bg-danger-soft px-4 py-4 min-[700px]:col-span-2">
										<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-danger">Startup error</p>
										<p className="mt-2 text-sm leading-6 text-danger">{adminStatus.relayStartupError}</p>
									</div>
								) : null}
							</div>
						</div>
					</section>

					<aside className="space-y-5">
						<form className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]" onSubmit={handleSubmit}>
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Reauthenticate</p>
							<h2 className="mt-2 text-xl font-semibold">Enter a new pairing code</h2>
							<p className="mt-2 text-sm leading-6 text-muted">
								Generate a code from the relay-facing client, then submit it here to update the server without touching the terminal.
							</p>

							<label className="mt-5 block">
								<span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Pairing code</span>
								<input
									type="text"
									value={pairingCode}
									onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
									placeholder="ABC123"
									className="mt-2 w-full border border-line bg-surface-strong px-3 py-3 font-mono text-base tracking-[0.18em] text-ink outline-none transition focus:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
									autoComplete="off"
									autoCapitalize="characters"
									spellCheck={false}
								/>
							</label>

							<button
								type="submit"
								className="mt-4 w-full border border-ink bg-ink px-4 py-3 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
								disabled={isSubmitting || pairingCode.trim().length === 0}
							>
								{isSubmitting ? "Updating relay pairing..." : "Reauthenticate relay"}
							</button>

							{submissionMessage ? (
								<p className="mt-4 border border-accent-line bg-accent-soft px-3 py-3 text-sm leading-6 text-accent">
									{submissionMessage}
								</p>
							) : null}
							{submissionError ? (
								<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-3 text-sm leading-6 text-danger">
									{submissionError}
								</p>
							) : null}
						</form>

						<div className="border border-line bg-sidebar-bg px-5 py-5 text-sidebar-ink shadow-[0_12px_40px_rgba(23,21,18,0.12)]">
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-sidebar-muted">Next surface</p>
							<h2 className="mt-2 text-xl font-semibold">Reserved for logs</h2>
							<p className="mt-3 text-sm leading-6 text-sidebar-muted">
								This panel is intentionally held open for future server logs so settings and operations can stay in the same local UI.
							</p>
						</div>
					</aside>
				</div>
			</div>
		</main>
	);
}