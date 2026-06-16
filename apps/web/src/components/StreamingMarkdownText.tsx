import { Fragment } from "react";
import { MessageResponse } from "./ai-elements/message";

type StreamingRenderBlock = {
	id: string;
	content: string;
	mode: "markdown" | "plain";
	status: "committed" | "active";
};

function trimTrailingBlankLines(value: string): string {
	return value.replace(/\n+$/g, "");
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n/g, "\n");
}

function buildStreamingRenderBlocks(content: string): StreamingRenderBlock[] {
	const normalized = normalizeLineEndings(content);
	if (!normalized) {
		return [];
	}

	const lines = normalized.split("\n");
	const committedBlocks: string[] = [];
	const currentLines: string[] = [];
	let inFence = false;

	for (const line of lines) {
		currentLines.push(line);
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
		}

		if (!inFence && line.trim().length === 0) {
			const block = trimTrailingBlankLines(currentLines.join("\n"));
			if (block.trim().length > 0) {
				committedBlocks.push(block);
			}
			currentLines.length = 0;
		}
	}

	const activeBlock = trimTrailingBlankLines(currentLines.join("\n"));
	const blocks: StreamingRenderBlock[] = committedBlocks.map((block, index) => ({
		id: `committed-${index}`,
		content: block,
		mode: "markdown",
		status: "committed",
	}));

	if (activeBlock.trim().length > 0) {
		blocks.push({
			id: `active-${committedBlocks.length}`,
			content: activeBlock,
			mode: "plain",
			status: "active",
		});
	}

	return blocks;
}

type StreamingMarkdownTextProps = {
	content: string;
	pending: boolean;
};

export function StreamingMarkdownText({ content, pending }: StreamingMarkdownTextProps) {
	if (!pending) {
		return (
			<MessageResponse className="markdown-content w-full wrap-break-word text-[0.95rem] leading-[1.7] text-ink selection:bg-black/10 selection:text-black">
				{content}
			</MessageResponse>
		);
	}

	const blocks = buildStreamingRenderBlocks(content);
	if (blocks.length === 0) {
		return null;
	}

	return (
		<div className="flex w-full flex-col gap-3">
			{blocks.map((block) => (
				<Fragment key={block.id}>
					{block.mode === "markdown" ? (
						<MessageResponse className="markdown-content w-full wrap-break-word text-[0.95rem] leading-[1.7] text-ink selection:bg-black/10 selection:text-black opacity-75">
							{block.content}
						</MessageResponse>
					) : (
						<pre className="w-full overflow-x-auto whitespace-pre-wrap wrap-break-word text-[0.95rem] leading-[1.7] text-ink opacity-75">
							{block.content}
						</pre>
					)}
				</Fragment>
			))}
		</div>
	);
}
