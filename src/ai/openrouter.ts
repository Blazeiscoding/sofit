import { fetch } from 'expo/fetch';

const BASE = 'https://openrouter.ai/api/v1';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export class OpenRouterError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

type StreamOptions = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
};

/** One streamed completion. Returns the full text and any tool calls the model made. */
async function streamCompletion(opts: StreamOptions): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'HTTP-Referer': 'https://github.com/sofit-app',
      'X-Title': 'SoFit',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools?.length ? opts.tools : undefined,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let message = `OpenRouter error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      message = err.error?.message ?? message;
    } catch {
      // keep status message
    }
    throw new OpenRouterError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const calls: ToolCall[] = [];

  const handleLine = (line: string) => {
    // SSE comments such as ": OPENROUTER PROCESSING" keep the connection alive.
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data) as {
      error?: { message?: string };
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
    };
    if (chunk.error) throw new OpenRouterError(500, chunk.error.message ?? 'Stream error');
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      opts.onText?.(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const call = (calls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.function.name += tc.function.name;
      if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());
  return { content, toolCalls: calls.filter(Boolean) };
}

type AgentOptions = Omit<StreamOptions, 'tools'> & {
  tools: ToolDefinition[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  onToolCall?: (name: string) => void;
  maxRounds?: number;
};

/** Chat with tool use: keeps calling tools until the model answers in plain text. */
export async function runAgent(opts: AgentOptions): Promise<string> {
  const messages = [...opts.messages];
  const rounds = opts.maxRounds ?? 6;
  for (let round = 0; round < rounds; round++) {
    const { content, toolCalls } = await streamCompletion({ ...opts, messages });
    if (!toolCalls.length) return content;
    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      opts.onToolCall?.(call.function.name);
      let result: unknown;
      try {
        const args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        result = await opts.runTool(call.function.name, args);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  // Out of tool rounds: ask for a final answer without tools.
  const { content } = await streamCompletion({ ...opts, messages, tools: [] });
  return content;
}

export type ModelInfo = { id: string; name: string; contextLength: number; promptPrice: number };

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new OpenRouterError(res.status, 'Could not load models');
  const json = (await res.json()) as {
    data: { id: string; name: string; context_length: number; pricing?: { prompt?: string }; supported_parameters?: string[] }[];
  };
  return json.data
    .filter((m) => !m.id.endsWith(':batch') && (m.supported_parameters?.includes('tools') ?? true))
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      promptPrice: Number(m.pricing?.prompt ?? 0) * 1_000_000,
    }));
}
