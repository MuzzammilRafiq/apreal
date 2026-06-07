import { authBaseUrl, authClient } from "../auth/auth-client";
import { AccountAuthButton } from "./AccountAuthButton";

declare const __APREAL_WEB_TARGET__: "local" | "remote";

export function SettingsAccountSection({ active }: { active: boolean }) {
	const { data: session, isPending } = authClient.useSession();
	const user = session?.user;
	const userImage = typeof (user as { image?: unknown } | undefined)?.image === "string"
		? (user as { image?: string | null }).image ?? null
		: null;
	const userLabel = user?.name || user?.email || "Signed in";
	const userInitial = userLabel.trim().charAt(0).toUpperCase() || "A";

	if (!active) {
		return null;
	}

	return (
		<section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
			<div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
				<div className="flex min-w-0 items-start gap-4">
					<div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 text-lg font-bold text-slate-700 shadow-sm">
						{userImage ? (
							<img
								src={userImage}
								alt={user?.name ? `${user.name} profile` : "Google account profile"}
								className="h-full w-full object-cover"
								referrerPolicy="no-referrer"
							/>
						) : (
							<span>{userInitial}</span>
						)}
					</div>
					<div className="min-w-0">
						<p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
							Google account
						</p>
						<h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
							{isPending ? "Checking account..." : user ? userLabel : "Not signed in"}
						</h2>
						{user?.email ? <p className="mt-1 text-sm font-medium text-slate-600">{user.email}</p> : null}
						<p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
							This account authorizes the {__APREAL_WEB_TARGET__ === "remote" ? "remote relay session" : "local browser session"}.
						</p>
						<p className="mt-2 max-w-full truncate font-mono text-[0.72rem] text-slate-500" title={authBaseUrl}>
							Auth: {authBaseUrl}
						</p>
					</div>
				</div>
				<div className="w-full min-[760px]:w-56">
					<AccountAuthButton showSignedInDetails={false} tone="light" />
				</div>
			</div>
		</section>
	);
}
