type ConnectionSidebarFooterProps = {
	target: "local" | "remote";
	clientConnected: boolean;
	hostConnected: boolean;
	onBackToChat?: () => void;
};

function StatusRow({
	label,
	connected,
}: {
	label: string;
	connected: boolean;
}) {
	const toneClassName = connected
		? "text-emerald-950"
		: "text-orange-950";

	return (
		<div className={`flex items-center justify-between gap-3 border-b border-black/8 py-2.5 last:border-b-0 ${toneClassName}`}>
			<div className="min-w-0">
				<p className="font-mono text-[0.72rem] font-extrabold uppercase tracking-[0.16em]">
					{label}
				</p>
			</div>
			<span className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-orange-400"}`} aria-hidden="true" />
		</div>
	);
}

export function ConnectionSidebarFooter({
	target,
	clientConnected,
	hostConnected,
	onBackToChat,
}: ConnectionSidebarFooterProps) {
	const clientLabel = target === "remote" ? "Relay server" : "Server";

	return (
		<div className="mt-auto border-t border-line px-2 pt-3 pb-2">
			<div className="px-1">
				<StatusRow label={clientLabel} connected={clientConnected} />
				<StatusRow label="Agent host" connected={hostConnected} />
			</div>
			{onBackToChat ? (
				<button
					type="button"
					className="mt-3 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium text-slate-900 transition-colors duration-150 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 cursor-pointer"
					onClick={onBackToChat}
				>
					<svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
					Back to chat
				</button>
			) : null}
		</div>
	);
}
