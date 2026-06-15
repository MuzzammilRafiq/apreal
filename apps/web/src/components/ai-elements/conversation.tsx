"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <div
    className={cn("relative flex-1 overflow-y-auto overscroll-contain", className)}
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string | null;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-4 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="flex items-center justify-center text-foreground">{icon}</div>}
        <div className="space-y-2">
          <h3 className="font-semibold text-xl tracking-tight text-black min-[861px]:text-2xl">{title}</h3>
          {description && (
            <p className="max-w-md text-base leading-7 text-slate-600">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);
