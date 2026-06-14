type ConnectionSidebarFooterProps = {
	target: "local" | "remote";
	clientConnected: boolean;
	hostConnected: boolean;
	onBackToChat?: () => void;
	placement?: "top" | "bottom";
	bordered?: boolean;
	showConnectivity?: boolean;
	showBackToChat?: boolean;
};

function StatusDot({
	label,
	connected,
	tooltipPosition = "top",
}: {
	label: string;
	connected: boolean;
	tooltipPosition?: "top" | "bottom";
}) {
	const tooltipClassName = tooltipPosition === "bottom"
		? "top-full mt-2"
		: "bottom-full mb-2";

	return (
		<div className="group relative flex items-center justify-center cursor-pointer" title={`${label}: ${connected ? "Connected" : "Disconnected"}`} aria-label={`${label}: ${connected ? "Connected" : "Disconnected"}`}>
			{/* Ambient Pulse Ring */}
			{connected ? (
				<span className="absolute inline-flex h-3 w-3 animate-status-ping rounded-full bg-emerald-400/50" />
			) : (
				<span className="absolute inline-flex h-3 w-3 animate-status-ping rounded-full bg-amber-400/35" style={{ animationDuration: "3.5s" }} />
			)}
			{/* Glow & Core */}
			<span
				className={[
					"relative flex h-3 w-3 items-center justify-center rounded-full transition-all duration-300 group-hover:scale-110",
					connected 
						? "bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] ring-1 ring-emerald-500/20" 
						: "bg-gradient-to-br from-amber-400 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/20",
				].join(" ")}
				aria-hidden="true"
			>
				{/* Inner Reflection Core */}
				<span className="h-1 w-1 rounded-full bg-white/80 shadow-[0_0.5px_1px_rgba(0,0,0,0.15)]" />
			</span>
			{/* Tooltip */}
			<span className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-black/8 bg-white px-2.5 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#171717] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.06)] transition-all duration-150 group-hover:opacity-100 ${tooltipClassName} flex items-center gap-1.5`}>
				<span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`} />
				<span>{label}</span>
				<span className="font-sans font-medium lowercase text-[#525252]/60">•</span>
				<span className={connected ? "text-emerald-600" : "text-amber-600"}>{connected ? "Connected" : "Disconnected"}</span>
			</span>
			<span className="sr-only">{label}</span>
		</div>
	);
}

export function ConnectionSidebarFooter({
	target,
	clientConnected,
	hostConnected,
	onBackToChat,
	placement = "bottom",
	bordered = true,
	showConnectivity = true,
	showBackToChat = true,
}: ConnectionSidebarFooterProps) {
	const clientLabel = target === "remote" ? "Relay server" : "Server";
	const isTopPlacement = placement === "top";
	const containerClassName = isTopPlacement
		? `${bordered ? "border-b border-line " : ""}px-2 pt-1.5 pb-1.5`
		: `${bordered ? "border-t border-line " : ""}mt-auto px-2 pt-3 pb-2`;

	const bothConnected = clientConnected && hostConnected;
	const someConnected = clientConnected || hostConnected;

	const mouthColorClass = bothConnected
		? "text-emerald-500/30 group-hover/face:text-emerald-500/60"
		: someConnected
			? "text-amber-500/35 group-hover/face:text-amber-500/65"
			: "text-red-400/30 group-hover/face:text-red-400/60";

	return (
		<div className={containerClassName}>
			{showConnectivity ? (
				<div className={`flex items-center ${isTopPlacement ? "justify-center" : "justify-end"} px-1 py-1`}>
					<div className="group/face relative flex flex-col items-center pt-1 pb-1">
						<div className="flex items-center gap-4.5 pb-2.5">
							<StatusDot label={clientLabel} connected={clientConnected} tooltipPosition={isTopPlacement ? "bottom" : "top"} />
							<StatusDot label="Agent host" connected={hostConnected} tooltipPosition={isTopPlacement ? "bottom" : "top"} />
						</div>
						<svg
							width="20"
							height="6"
							viewBox="0 0 20 6"
							fill="none"
							className={`absolute bottom-0.5 transition-all duration-300 group-hover/face:scale-y-125 group-hover/face:translate-y-[1px] ${mouthColorClass}`}
						>
							<path d="M2 1C5.5 4.5 14.5 4.5 18 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
						</svg>
					</div>
				</div>
			) : null}
			{showBackToChat && onBackToChat ? (
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
