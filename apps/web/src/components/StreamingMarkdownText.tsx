import ChatMarkdown from "./ChatMarkdown";

type StreamingMarkdownTextProps = {
	content: string;
	pending: boolean;
};

export function StreamingMarkdownText({ content, pending }: StreamingMarkdownTextProps) {
	if (!content.trim()) {
		return null;
	}

	return (
		<ChatMarkdown
			text={content}
			isStreaming={pending}
			className={[
				"selection:bg-black/10 selection:text-black",
				pending ? "opacity-80" : "",
			].join(" ")}
		/>
	);
}
