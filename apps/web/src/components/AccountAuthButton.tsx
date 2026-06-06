import { useEffect, useRef, useState } from "react";
import { authBaseUrl, authClient } from "../auth/auth-client";
import { clearLocalBrowserAuthSession, ensureLocalBrowserAuthSession } from "../local-auth";

declare const __APREAL_WEB_TARGET__: "local" | "remote";

type AccountAuthButtonProps = {
	onAfterAction?: () => void;
};

export function AccountAuthButton({ onAfterAction }: AccountAuthButtonProps) {
	const { data: session, isPending } = authClient.useSession();
	const [relayLinkError, setRelayLinkError] = useState<string | null>(null);
	const [relayLinking, setRelayLinking] = useState(false);
	const linkedUserRef = useRef<string | null>(null);
	const user = session?.user;

	useEffect(() => {
		if (!user?.id) {
			linkedUserRef.current = null;
		}
	}, [user?.id]);

	useEffect(() => {
		if (__APREAL_WEB_TARGET__ !== "local" || isPending || !user?.id) {
			return;
		}

		if (linkedUserRef.current === user.id) {
			return;
		}

		let cancelled = false;
		linkedUserRef.current = user.id;
		setRelayLinking(true);
		setRelayLinkError(null);
		void ensureLocalBrowserAuthSession()
			.catch((error) => {
				if (!cancelled) {
					linkedUserRef.current = null;
					setRelayLinkError(error instanceof Error ? error.message : "Failed to link the local relay agent.");
				}
			})
			.finally(() => {
				if (!cancelled) {
					setRelayLinking(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [isPending, user?.id]);

	const handleSignIn = async () => {
		await authClient.signIn.social({
			provider: "google",
			callbackURL: window.location.href,
		});
		onAfterAction?.();
	};

	const handleSignOut = async () => {
		if (__APREAL_WEB_TARGET__ === "local") {
			try {
				await clearLocalBrowserAuthSession();
			} catch {
				// Clearing the local browser session is best-effort before remote sign-out.
			}
			linkedUserRef.current = null;
		}
		await authClient.signOut();
		onAfterAction?.();
	};

	if (isPending) {
		return (
			<div className="rounded-md border border-white/8 bg-white/3 px-3 py-2.5 text-[0.78rem] font-medium text-[#9ca3af]">
				Checking account...
			</div>
		);
	}

	if (!user) {
		return (
			<div className="rounded-md border border-white/8 bg-white/3 p-2.5">
				<button
					type="button"
					className="flex w-full items-center justify-center rounded-md bg-white px-3 py-2 text-[0.8rem] font-semibold text-black transition-colors duration-150 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
					onClick={() => {
						void handleSignIn();
					}}
				>
					Sign in with Google
				</button>
				<p className="mt-2 truncate font-mono text-[0.62rem] text-[#737373]" title={authBaseUrl}>
					Auth: {authBaseUrl}
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-md border border-white/8 bg-white/3 p-2.5">
			<div className="min-w-0">
				<p className="truncate text-[0.82rem] font-semibold text-white">{user.name || user.email || "Signed in"}</p>
				{user.email ? <p className="truncate text-[0.7rem] font-medium text-[#9ca3af]">{user.email}</p> : null}
				{__APREAL_WEB_TARGET__ === "local" && relayLinking ? (
					<p className="mt-1 truncate text-[0.68rem] font-medium text-[#9ca3af]">Linking local relay...</p>
				) : null}
				{__APREAL_WEB_TARGET__ === "local" && relayLinkError ? (
					<p className="mt-1 text-[0.68rem] font-medium leading-4 text-[#fca5a5]">{relayLinkError}</p>
				) : null}
			</div>
			<button
				type="button"
				className="mt-2 flex w-full items-center justify-center rounded-md border border-white/10 bg-white/4 px-3 py-2 text-[0.75rem] font-semibold text-[#b5b5b5] transition-colors duration-150 hover:border-white/16 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
				onClick={() => {
					void handleSignOut();
				}}
			>
				Sign out
			</button>
		</div>
	);
}
