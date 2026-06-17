import { cn } from "@/lib/utils";
import React, {
	Children,
	Suspense,
	isValidElement,
	memo,
	use,
	useMemo,
	type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { HighlighterCore } from "shiki/core";

type ChatMarkdownProps = {
	text: string;
	isStreaming?: boolean;
	className?: string;
	lineBreaks?: boolean;
};

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const FENCE_TITLE_ATTR_REGEX = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i;
const FENCE_FILENAME_TOKEN_REGEX = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/;
const highlightedCodeCache = new Map<string, Promise<string | null>>();
let highlighterPromise: Promise<HighlighterCore> | null = null;
const SUPPORTED_LANGUAGES = new Set([
	"bash",
	"css",
	"diff",
	"html",
	"javascript",
	"js",
	"json",
	"jsx",
	"markdown",
	"md",
	"python",
	"py",
	"sh",
	"shell",
	"shellscript",
	"sql",
	"tsx",
	"typescript",
	"ts",
	"yaml",
	"yml",
]);

const CHAT_MARKDOWN_SANITIZE_SCHEMA = {
	...defaultSchema,
	attributes: {
		...defaultSchema.attributes,
		code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta"],
	},
} satisfies Parameters<typeof rehypeSanitize>[0];

type MarkdownAstNode = {
	type?: string;
	meta?: unknown;
	data?: {
		hProperties?: Record<string, unknown>;
	};
	children?: MarkdownAstNode[];
};

function remarkPreserveCodeMeta() {
	return (tree: MarkdownAstNode) => {
		const visit = (node: MarkdownAstNode) => {
			if (node.type === "code" && typeof node.meta === "string" && node.meta.trim().length > 0) {
				node.data = {
					...node.data,
					hProperties: {
						...node.data?.hProperties,
						dataCodeMeta: node.meta.trim(),
					},
				};
			}

			node.children?.forEach(visit);
		};

		visit(tree);
	};
}

function nodeToPlainText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map((child) => nodeToPlainText(child)).join("");
	}

	if (isValidElement<{ children?: ReactNode }>(node)) {
		return nodeToPlainText(node.props.children);
	}

	return "";
}

function extractCodeBlock(children: ReactNode): { className: string | undefined; code: string } | null {
	const childNodes = Children.toArray(children);
	if (childNodes.length !== 1) {
		return null;
	}

	const onlyChild = childNodes[0];
	if (
		!isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
		onlyChild.type !== "code"
	) {
		return null;
	}

	return {
		className: onlyChild.props.className,
		code: nodeToPlainText(onlyChild.props.children).replace(/\n$/, ""),
	};
}

function extractFenceLanguage(className: string | undefined): string {
	const raw = className?.match(CODE_FENCE_LANGUAGE_REGEX)?.[1] ?? "text";
	return raw === "gitignore" ? "ini" : raw;
}

function extractFenceTitle(meta: string | undefined): string | null {
	if (!meta) {
		return null;
	}

	const attrMatch = FENCE_TITLE_ATTR_REGEX.exec(meta);
	const attrTitle = attrMatch?.[1] ?? attrMatch?.[2] ?? attrMatch?.[3];
	if (attrTitle) {
		return attrTitle;
	}

	return meta.split(/\s+/).find((candidate) => FENCE_FILENAME_TOKEN_REGEX.test(candidate)) ?? null;
}

function extractPreCodeMeta(node: unknown): string | undefined {
	const children = (
		node as
			| {
					children?: Array<{
						type?: string;
						tagName?: string;
						data?: { meta?: unknown };
						properties?: { dataCodeMeta?: unknown };
					}>;
			  }
			| undefined
	)?.children;
	const codeNode = children?.find((child) => child?.type === "element" && child.tagName === "code");
	const meta = codeNode?.properties?.dataCodeMeta ?? codeNode?.data?.meta;
	return typeof meta === "string" && meta.trim().length > 0 ? meta.trim() : undefined;
}

function normalizeHighlightLanguage(language: string): string | null {
	const normalized = language.toLowerCase();
	if (normalized === "text" || normalized === "txt" || normalized === "plain") {
		return null;
	}

	if (SUPPORTED_LANGUAGES.has(normalized)) {
		return normalized;
	}

	return null;
}

async function highlightCode(code: string, language: string): Promise<string | null> {
	highlighterPromise ??= loadHighlighter();
	const highlighter: HighlighterCore = await highlighterPromise;
	return highlighter.codeToHtml(code, {
		lang: language,
		theme: "github-light",
	});
}

async function loadHighlighter(): Promise<HighlighterCore> {
	const [
		{ createHighlighterCore },
		{ createJavaScriptRegexEngine },
		{ default: githubLight },
		{ default: bash },
		{ default: css },
		{ default: diff },
		{ default: html },
		{ default: javascript },
		{ default: json },
		{ default: jsx },
		{ default: markdown },
		{ default: python },
		{ default: shellscript },
		{ default: sql },
		{ default: tsx },
		{ default: typescript },
		{ default: yaml },
	] = await Promise.all([
		import("shiki/core"),
		import("shiki/engine/javascript"),
		import("shiki/themes/github-light.mjs"),
		import("shiki/langs/bash.mjs"),
		import("shiki/langs/css.mjs"),
		import("shiki/langs/diff.mjs"),
		import("shiki/langs/html.mjs"),
		import("shiki/langs/javascript.mjs"),
		import("shiki/langs/json.mjs"),
		import("shiki/langs/jsx.mjs"),
		import("shiki/langs/markdown.mjs"),
		import("shiki/langs/python.mjs"),
		import("shiki/langs/shellscript.mjs"),
		import("shiki/langs/sql.mjs"),
		import("shiki/langs/tsx.mjs"),
		import("shiki/langs/typescript.mjs"),
		import("shiki/langs/yaml.mjs"),
	]);

	return createHighlighterCore({
		themes: [githubLight],
		langs: [
			...bash,
			...css,
			...diff,
			...html,
			...javascript,
			...json,
			...jsx,
			...markdown,
			...python,
			...shellscript,
			...sql,
			...tsx,
			...typescript,
			...yaml,
		],
		engine: createJavaScriptRegexEngine(),
	});
}

function getHighlightedCode(code: string, language: string): Promise<string | null> {
	const cacheKey = `${language}:${code}`;
	const cached = highlightedCodeCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const highlightLanguage = normalizeHighlightLanguage(language);
	if (!highlightLanguage) {
		const promise = Promise.resolve(null);
		highlightedCodeCache.set(cacheKey, promise);
		return promise;
	}

	const promise = highlightCode(code, highlightLanguage).catch(() => null);
	highlightedCodeCache.set(cacheKey, promise);
	return promise;
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
	const highlightedHtml = use(getHighlightedCode(code, language));

	if (!highlightedHtml) {
		return (
			<pre>
				<code>{code}</code>
			</pre>
		);
	}

	return <div className="markdown-code-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
}

function MarkdownCodeBlock({
	code,
	language,
	title,
}: {
	code: string;
	language: string;
	title: string | null;
}) {
	const label = title ?? language;

	return (
		<div className="markdown-code-block" data-language={language}>
			<div className="markdown-code-header">
				<span>{label}</span>
			</div>
			<Suspense
				fallback={
					<pre>
						<code>{code}</code>
					</pre>
				}
			>
				<HighlightedCode code={code} language={language} />
			</Suspense>
		</div>
	);
}

function MarkdownTable(props: React.ComponentProps<"table">) {
	return (
		<div className="markdown-table-container" tabIndex={0}>
			<table {...props} />
		</div>
	);
}

const markdownComponents: Components = {
	a({ href, children, ...props }) {
		const isExternal = href ? /^https?:\/\//i.test(href) : false;
		return (
			<a
				{...props}
				href={href}
				target={isExternal ? "_blank" : undefined}
				rel={isExternal ? "noopener noreferrer" : undefined}
			>
				{children}
			</a>
		);
	},
	table({ node: _node, ...props }) {
		return <MarkdownTable {...props} />;
	},
	pre({ node, children, ...props }) {
		const codeBlock = extractCodeBlock(children);
		if (!codeBlock) {
			return <pre {...props}>{children}</pre>;
		}

		const language = extractFenceLanguage(codeBlock.className);
		const title = extractFenceTitle(extractPreCodeMeta(node));
		return <MarkdownCodeBlock code={codeBlock.code} language={language} title={title} />;
	},
};

function closeOpenCodeFence(text: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let openFence: string | null = null;

	for (const line of lines) {
		const match = line.match(/^\s*(`{3,}|~{3,})/);
		if (!match?.[1]) {
			continue;
		}

		const fence = match[1];
		if (!openFence) {
			openFence = fence;
			continue;
		}

		if (fence.startsWith(openFence.charAt(0))) {
			openFence = null;
		}
	}

	return openFence ? `${text}\n${openFence}` : text;
}

function ChatMarkdown({ text, isStreaming = false, className, lineBreaks = true }: ChatMarkdownProps) {
	const renderedText = useMemo(() => (isStreaming ? closeOpenCodeFence(text) : text), [isStreaming, text]);

	return (
		<div className={cn("markdown-content w-full min-w-0 text-[0.95rem] leading-[1.7] text-ink", className)}>
			<ReactMarkdown
				remarkPlugins={lineBreaks ? [remarkGfm, remarkBreaks, remarkPreserveCodeMeta] : [remarkGfm, remarkPreserveCodeMeta]}
				rehypePlugins={[rehypeRaw, [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA]]}
				components={markdownComponents}
			>
				{renderedText}
			</ReactMarkdown>
		</div>
	);
}

export default memo(ChatMarkdown);
