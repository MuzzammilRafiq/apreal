export function getSessionCardClassName(isActive: boolean): string {
	return [
		"group relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors duration-150",
		isActive
			? "ui-nav-item-active text-(--color-brand-ink)"
			: "ui-nav-item text-slate-600",
	].join(" ");
}
