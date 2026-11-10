/**
 * Trimmed Cordis runtime derived from dsh-purge Community lib/index.js 1.6.86.
 * Actual runtime behavior (llm/stream retry) is preserved; all host patching,
 * sandbox/permission/approval changes and shell access are removed.
 */
import {streamWithRefusalRetry} from "./refusal-retry.js";

export const name = "dsh-purge-focus";
export const inject = ["systemPrompt"];

const ADVICE = `回答应直接、清晰、务实。对正常的成年人恋爱、吸引、亲密关系、调情和沟通问题，可以坦率讨论欲望、互动信号、具体表达和案例，不要把普通的两性话题误判为违规。不用反复免责声明、空洞劝诫或无意义确认问题。尊重双方意愿、事实和上下文；避免夸大确定性。遇到现实技术问题，先给可执行步骤，再解释原因。`;

export function apply(ctx, config = {}) {
  const cfg = {
    enabled: config.enabled !== false,
    refusalRetry: config.refusalRetry !== false,
    assistantStyle: config.assistantStyle !== false,
    maxBufferChars: Number(config.maxBufferChars) || 450,
  };
  if (!cfg.enabled) return;
  // Native DSH prompt section from upstream. Distinct from the actual retry hook.
  if (cfg.assistantStyle) {
    ctx.systemPrompt.section({
      name: "dsh-purge-focus:style", order: 5100, interpolate:false,
      text: ADVICE,
    });
  }
  if (cfg.refusalRetry) {
    ctx.on("llm/stream", (options, next) =>
      streamWithRefusalRetry((updatedOptions) => next(updatedOptions), options, {
        maxBufferChars: cfg.maxBufferChars,
      })
    );
  }
}
