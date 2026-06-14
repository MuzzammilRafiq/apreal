import { AccountAuthButton } from "./AccountAuthButton";

export function AuthGate({ pending }: { pending: boolean }) {
	return (
		<main className="auth-gate-grid relative flex min-h-svh items-center justify-center overflow-hidden bg-[#f4f4f1] px-6 py-10 text-[#171717]">
			<div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-black/4 to-transparent" />
			<div className="pointer-events-none absolute left-1/2 top-1/2 h-136 w-136 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/5" />
			{pending ? (
				<p className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
					Checking account...
				</p>
			) : (
				<div className="relative z-10 w-full max-w-4xl p-4">
					{/* <div className="mx-auto flex max-w-3xl flex-col items-center text-center"> */}
						<h1 className="auth-gate-wordmark relative w-fit mx-auto" data-shadow="APREAL">
							APREAL
						</h1>
					{/* </div> */}

					<div className="mx-auto mt-10 w-full max-w-md">
						<AccountAuthButton
							showSignedInDetails={false}
							showAuthBaseUrl={false}
							wrapperClassName=""
							buttonClassName="flex w-full items-center justify-center rounded-md bg-black px-4 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
						/>
					</div>
				</div>
			)}
		</main>
	);
}
