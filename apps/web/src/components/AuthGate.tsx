import { AccountAuthButton } from "./AccountAuthButton";
import { Spinner } from "./ui/spinner";

export function AuthGate({ pending }: { pending: boolean }) {
	return (
		<main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-white px-6 py-10 text-[#171717]">
			{pending ? (
				<div className="flex items-center justify-center">
					<Spinner className="size-5 text-slate-400" />
				</div>
			) : (
				<div className="relative z-10 w-full max-w-4xl p-4">
					{/* <div className="mx-auto flex max-w-3xl flex-col items-center text-center"> */}
						<h1 className="auth-gate-wordmark relative w-fit mx-auto" data-shadow="APREAL">
							APREAL
						</h1>
					{/* </div> */}

					<div className="mx-auto mt-10 w-full max-w-md">
						<AccountAuthButton
							showAuthBaseUrl={false}
							buttonClassName="flex w-full items-center justify-center rounded-md bg-black px-4 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
						/>
					</div>
				</div>
			)}
		</main>
	);
}
