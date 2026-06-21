"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
	return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({
	className,
	children,
	showCloseButton = true,
	align = "center",
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
	showCloseButton?: boolean
}) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-60 grid w-72 max-w-[calc(100vw-1.5rem)] gap-4 rounded-2xl border border-black/10 bg-background p-5 text-foreground shadow-2xl outline-none origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
					className
				)}
				{...props}
			>
				{children}
				{showCloseButton ? (
					<PopoverPrimitive.Close
						className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
						aria-label="Close"
					>
						<XIcon className="size-4" aria-hidden="true" />
					</PopoverPrimitive.Close>
				) : null}
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	)
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
