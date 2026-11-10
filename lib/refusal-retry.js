/**
 * Derived from dsh-purge Community 1.6.86 lib/refusal-retry.js (MIT).
 * Bounded response re-evaluation: buffer the beginning of one llm/stream,
 * detect a refusal-form response, retry exactly once with a clarified system
 * request. Unlike upstream, does not override policy or assume authorization.
 */

export const REFUSAL_PATTERNS = Object.freeze([
  /^\s*(?:抱歉|对不起)[，,。\s]*(?:我)?(?:不能|无法|不可以)(?:帮(?:助|你)|协助|提供|满足|支持|直接给出|参与|按照要求)/i,
  /^\s*(?:很遗憾|不好意思)[，,。\s]*(?:我)?(?:不能|无法)/i,
  /^\s*(?:作为|身为)(?:一个)?(?:AI|人工智能|语言模型)[，,。\s]*(?:我)?(?:不能|无法)/i,
  /^\s*(?:I\s+(?:can't|cannot|won't|am unable to)|I'm sorry, but I (?:can't|cannot|won't))\s+(?:help|assist|provide|comply)/i,
  /^\s*(?:I\s+must\s+decline|I\s+can't\s+(?:help|assist|provide))/i,
  /^\s*我(?:不能|无法)(?:帮(?:助|你)|协助|提供|满足|直接给出)/i,
]);

export function refusalMatchIndex(text = "") {
  const head = String(text).trimStart().slice(0, 600);
  // Don't mistake a substantial analysis *about* refusal for a refusal.
  if (head.length > 300 && /提示词注入|越狱|拒答机制|refusal|jailbreak/i.test(head)) return -1;
  return REFUSAL_PATTERNS.findIndex((re) => re.test(head));
}

export function looksLikeRefusal(text = "") { return refusalMatchIndex(text) >= 0; }

export const RETRY_NUDGE = `\n\n[Second-pass answer review]
The previous draft may have misclassified this request. Reconsider the user's actual intent rather than relying on broad trigger words. For normal, permitted requests (including frank discussion of consenting adults, dating, attraction, relationships, and concrete technical troubleshooting), answer directly with specific reasoning and practical examples instead of generic refusal language. Do not overstate risks, invent restrictions, or repeat boilerplate. If a genuine safety, privacy, legal or tool-permission restriction applies, keep it intact and explain the precise relevant limitation. Never claim a request is authorized without evidence, never bypass access controls, and do not invoke tools without the required permissions.
`;

function addToSystem(options, nudge) {
  if (!options || !Array.isArray(options.messages)) return null;
  const index = options.messages.findIndex(m => m && m.role === "system");
  if (index < 0) return null;
  const system = options.messages[index];
  let content;
  if (typeof system.content === "string") content = system.content + nudge;
  else if (Array.isArray(system.content)) {
    const blocks = system.content.map(b => b?.type === "text" && typeof b.text === "string"
      ? {...b, text: b.text + nudge} : b);
    if (!blocks.some(b => b?.type === "text")) blocks.push({type:"text",text:nudge});
    content = blocks;
  } else return null;
  const messages = [...options.messages];
  messages[index] = {...system, content};
  return {...options, messages};
}

export async function* streamWithRefusalRetry(streamFactory, options, {
  nudge = RETRY_NUDGE, onRetry = () => {}, maxBufferChars = 450,
} = {}) {
  // The host can provide a signal; don't retry cancelled turns.
  const first = streamFactory(options);
  const iterator = first[Symbol.asyncIterator]();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await iterator.return?.(); } catch { /* cancel only */ }
  };
  const buffered = [];
  let prefix = "";
  let toolOrReasoning = false;
  let completed = false;
  const limit = Math.max(100, Math.min(1200, Number(maxBufferChars) || 450));
  try {
    while (!completed) {
      const s = await iterator.next();
      if (s.done) break;
      const c = s.value;
      buffered.push(c);
      if (c?.type === "text-delta") prefix += String(c.text || "");
      if (c?.type === "tool-call" || c?.type === "tool-call-delta" || c?.type === "reasoning-delta") {
        toolOrReasoning = true; completed = true;
      }
      if (prefix.length >= limit || c?.type === "finish") completed = true;
    }
    const retryOptions = toolOrReasoning || options?.signal?.aborted || !looksLikeRefusal(prefix)
      ? null : addToSystem(options, nudge);
    if (retryOptions) {
      await close();
      onRetry({pattern:refusalMatchIndex(prefix), chars:prefix.length});
      // One retry ONLY. Even a second refusal is returned as-is.
      yield* streamFactory(retryOptions);
      return;
    }
    for (const chunk of buffered) yield chunk;
    while (true) {
      const s = await iterator.next();
      if (s.done) break;
      yield s.value;
    }
  } finally { await close(); }
}
