export type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'assistant-1',
    role: 'assistant',
    content: `## Welcome

Try asking for:

- a travel itinerary
- a short study plan
- a code sample
`,
  },
];

export function buildMockAssistantReply(prompt: string, variant: number) {
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
  const promptPreview = normalizedPrompt.length > 72 ? `${normalizedPrompt.slice(0, 69)}...` : normalizedPrompt;
  const safePrompt = promptPreview || 'your idea';
  const mockReplies = [
    `### Quick take

Here is a concise answer about **${safePrompt}**.

- Keep the reply concise
- Make the next step obvious
- Preserve clean markdown formatting

\`\`\`tsx
<ChatMessageBubble role="assistant" markdown />
\`\`\``,
    `## Suggested structure

If you are exploring _${safePrompt}_, a strong first response might include:

1. a short summary
2. a few action items
3. one example block
`,
    `### Sample response

You can treat **${safePrompt}** as the topic for the next assistant turn.

[Expo Router docs](https://docs.expo.dev/router/introduction)

\`\`\`ts
const mode = 'assistant';
const markdown = true;
\`\`\``,
  ];

  return mockReplies[variant % mockReplies.length];
}
