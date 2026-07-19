import { GitFork } from "lucide-react";
import { AccountAuthButton } from "./AccountAuthButton";
import { Spinner } from "./ui/spinner";

const features = [
	{
		title: "Local by default",
		description: "Your agent runs on your Mac, where your tools and files already live.",
	},
	{
		title: "Available anywhere",
		description: "Pick up a conversation from another browser or your phone.",
	},
	{
		title: "Use your provider",
		description: "Connect a supported AI subscription or bring your own API key.",
	},
];

export function AuthGate({ pending }: { pending: boolean }) {
	return (
		<main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-white px-6 py-12 text-[#171717]">
			{pending ? (
				<div className="flex items-center justify-center">
					<Spinner className="size-5 text-slate-400" />
				</div>
			) : (
				<div className="relative z-10 w-full max-w-5xl">
					<div className="mx-auto flex max-w-2xl flex-col items-center text-center">
						<p className="mb-6 font-mono text-[0.68rem] font-medium uppercase tracking-[0.24em] text-neutral-500">
							Your agent. Your machine.
						</p>
						<h1 className="auth-gate-wordmark relative w-fit" data-shadow="APREAL" aria-label="Apreal">
							APREAL
						</h1>
						<p className="mt-8 max-w-xl text-balance text-base leading-7 text-neutral-600 sm:text-lg">
							A local-first AI agent that works on your Mac and stays within reach from any browser, even your phone.
						</p>

						<div className="mt-9 w-full max-w-md">
							<AccountAuthButton
								showAuthBaseUrl={false}
								buttonClassName="flex w-full items-center justify-center rounded-md bg-black px-4 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
							/>
						</div>

						<a
							href="https://github.com/MuzzammilRafiq/apreal"
							target="_blank"
							rel="noreferrer"
							className="mt-4 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
						>
							<GitFork aria-hidden="true" className="size-4" />
							View Apreal on GitHub
						</a>
					</div>

					<div className="mx-auto mt-14 grid max-w-4xl border-y border-neutral-200 sm:grid-cols-3">
						{features.map((feature, index) => (
							<div
								key={feature.title}
								className={`px-5 py-5 text-center sm:text-left ${index > 0 ? "border-t border-neutral-200 sm:border-l sm:border-t-0" : ""}`}
							>
								<p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-900">
									{feature.title}
								</p>
								<p className="mt-2 text-sm leading-6 text-neutral-500">{feature.description}</p>
							</div>
						))}
					</div>
				</div>
			)}
		</main>
	);
}
