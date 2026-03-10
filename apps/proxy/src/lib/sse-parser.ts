export interface SSEResult {
  usage: OpenAIUsage | null;
  model: string | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Create a TransformStream that passes SSE bytes through unmodified
 * while extracting the usage object and response model from the stream.
 *
 * Uses a single TextDecoder with { stream: true } for multi-byte UTF-8 safety.
 * Line-buffered: only processes complete \n-terminated lines.
 */
export function createSSEParser(upstreamBody: ReadableStream<Uint8Array>): {
  readable: ReadableStream<Uint8Array>;
  resultPromise: Promise<SSEResult>;
} {
  let resolveResult: (value: SSEResult) => void;
  const resultPromise = new Promise<SSEResult>((resolve) => {
    resolveResult = resolve;
  });

  let capturedUsage: OpenAIUsage | null = null;
  let capturedModel: string | null = null;
  let lineBuffer = "";
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      const text = decoder.decode(chunk, { stream: true });
      lineBuffer += text;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;

      for (const line of lines) {
        processLine(line);
      }
    },

    flush(controller) {
      const remaining = decoder.decode(new Uint8Array(), { stream: false });
      lineBuffer += remaining;

      if (lineBuffer.trim()) {
        processLine(lineBuffer);
      }

      resolveResult({
        usage: capturedUsage,
        model: capturedModel,
      });
    },

    cancel() {
      resolveResult({
        usage: null,
        model: capturedModel,
      });
    },
  });

  function processLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) return;
    if (trimmed.startsWith(":")) return;

    if (!trimmed.startsWith("data:")) return;

    let payload = trimmed.slice(5);
    if (payload.startsWith(" ")) {
      payload = payload.slice(1);
    }
    payload = payload.trim();

    if (payload === "[DONE]") return;

    try {
      const parsed = JSON.parse(payload);

      if (!capturedModel && parsed.model) {
        capturedModel = parsed.model;
      }

      if (parsed.usage && typeof parsed.usage === "object") {
        capturedUsage = parsed.usage;
      }
    } catch {
      // Malformed JSON — skip silently
    }
  }

  const readable = upstreamBody.pipeThrough(transform);

  return { readable, resultPromise };
}
