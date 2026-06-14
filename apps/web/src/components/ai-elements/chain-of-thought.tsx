"use client";

import { cn } from "@/lib/utils";
import { Brain, ChevronDown, CircleDashed, LoaderCircle, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type StepStatus = "complete" | "active" | "pending";

type ChainOfThoughtContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null);

function useChainOfThought() {
	const context = useContext(ChainOfThoughtContext);

	if (!context) {
		throw new Error("ChainOfThought components must be used within ChainOfThought.");
	}

	return context;
}

export type ChainOfThoughtProps = HTMLAttributes<HTMLDivElement> & {
	defaultOpen?: boolean;
};

export function ChainOfThought({ children, className, defaultOpen = false, ...props }: ChainOfThoughtProps) {
	const [open, setOpen] = useState(defaultOpen);
	const value = useMemo(() => ({ open, setOpen }), [open]);

	return (
		<ChainOfThoughtContext.Provider value={value}>
			<div
				className={cn(
					"w-full rounded-md  px-2 py-1 transition-colors duration-150",
					value.open ? "bg-black/2" : "",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		</ChainOfThoughtContext.Provider>
	);
}

export type ChainOfThoughtHeaderProps = HTMLAttributes<HTMLButtonElement> & {
	label?: string;
};

export function ChainOfThoughtHeader({
	label = "Toggle chain of thought",
	className,
	...props
}: ChainOfThoughtHeaderProps) {
	const { open, setOpen } = useChainOfThought();

	return (
		<button
			type="button"
			className={cn(
				"flex h-7 w-7 shrink-0 items-center justify-center text-[#4b5563] transition-colors duration-150 hover:text-[var(--color-ink)]",
				className,
			)}
			onClick={() => setOpen(!open)}
			aria-expanded={open}
			{...props}
		>
			<span className="flex h-6 w-6 shrink-0 items-center justify-center">
				<ChevronDown className={cn("h-5 w-5 transform-gpu transition-transform duration-200", open ? "rotate-180" : "rotate-0")} />
			</span>
			<span className="sr-only">{label}</span>
		</button>
	);
}

export type ChainOfThoughtContentProps = HTMLAttributes<HTMLDivElement>;

export function ChainOfThoughtContent({ children, className, ...props }: ChainOfThoughtContentProps) {
	const { open } = useChainOfThought();

	if (!open) {
		return null;
	}

	return (
		<div className={cn("flex flex-col gap-1.5 py-1", className)} {...props}>
			{children}
		</div>
	);
}

function getStepStatusClasses(status: StepStatus) {
	switch (status) {
		case "active":
			return {
				badge: "text-[var(--color-brand-ink)]",
				label: "In Progress",
				icon: LoaderCircle,
				iconClassName: "animate-spin",
			};
		case "pending":
			return {
				badge: "text-[#4b5563]",
				label: "Pending",
				icon: CircleDashed,
				iconClassName: "",
			};
		default:
			return {
				badge: "text-[#4b5563]",
				label: "Complete",
				icon: Brain,
				iconClassName: "",
			};
	}
}

export type ChainOfThoughtStepProps = HTMLAttributes<HTMLDivElement> & {
	icon: LucideIcon;
	label: string;
	description?: string;
	status?: StepStatus;
	showStatus?: boolean;
	meta?: ReactNode;
	children?: ReactNode;
};

export function ChainOfThoughtStep({
	icon: Icon,
	label,
	description,
	status = "complete",
	showStatus = status !== "complete",
	meta,
	children,
	className,
	...props
}: ChainOfThoughtStepProps) {
	const statusPresentation = getStepStatusClasses(status);
	const StatusIcon = statusPresentation.icon;

	return (
		<section className={cn("py-1 ", className)} {...props}>
			<div className="flex items-start gap-2 ">
				<span className="mt-[0.2rem] flex h-4 w-4 shrink-0 items-center justify-center text-[#4b5563]">
					<Icon className="h-3.5 w-3.5" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
						<p className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[#4b5563]">{label}</p>
						{showStatus ? (
							<span
								className={cn(
									"inline-flex items-center gap-1 font-mono text-[0.58rem] font-semibold uppercase tracking-[0.08em]",
									statusPresentation.badge,
								)}
							>
								<StatusIcon className={cn("h-3 w-3", statusPresentation.iconClassName)} />
								{statusPresentation.label}
							</span>
						) : null}
						{meta}
					</div>
					{description ? (
						<p className="text-[0.78rem] leading-5 text-[#3f3f46]">{description}</p>
					) : null}
					{children ? <div className="mt-0.5">{children}</div> : null}
				</div>
			</div>
		</section>
	);
}
