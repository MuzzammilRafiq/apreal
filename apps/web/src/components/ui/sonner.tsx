import type { CSSProperties } from "react"
import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { cn } from "@/lib/utils"

const Toaster = ({ ...props }: ToasterProps) => {
	return (
		<Sonner
			theme="light"
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "#ffffff",
					"--normal-text": "var(--color-ink)",
					"--normal-border": "var(--color-line)",
					"--border-radius": "0.875rem",
				} as CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: cn(
						"group toast gap-3 rounded-[14px] border px-4 py-3 shadow-lg",
						"bg-white text-neutral-950 border-neutral-200",
					),
					title: "text-[13px] font-medium leading-5",
					description: "text-[12px] leading-5 text-neutral-700",
					content: "gap-1",
					icon: "text-current",
					closeButton: cn(
						"border-neutral-300 bg-white text-neutral-500",
						"transition-colors hover:bg-neutral-100 hover:text-neutral-900",
					),
					actionButton: cn(
						"bg-neutral-900 text-white transition-colors hover:bg-neutral-800",
					),
					cancelButton: cn(
						"bg-neutral-100 text-neutral-900 transition-colors hover:bg-neutral-200",
					),
					success: "border-emerald-200 bg-emerald-50 text-emerald-950",
					info: "border-neutral-200 bg-neutral-100 text-neutral-900",
					warning: "border-amber-200 bg-amber-50 text-amber-950",
					error: "border-red-200 bg-red-50 text-red-950",
				},
			}}
			{...props}
		/>
	)
}

export { Toaster }
