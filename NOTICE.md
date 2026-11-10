# Derivative attribution

This is an independently authored, cut-down source derivative of
[dsh-purge Community v1.6.86](https://github.com/kingcharleslzy-ai/dsh-purge),
which was itself based on the project by 小杨 / YuJunZhiXue.

Specifically, `lib/index.js` retains the upstream Cordis `systemPrompt.section`
and `llm/stream` hook design; `lib/refusal-retry.js` is adapted from the upstream
one-shot refusal detection and retry implementation. The broad refusal patterns,
overriding nudge and permissions/host patching code have been intentionally removed.

This project is *not* an official build, a full copy of the upstream 499-file
repository, or an endorsement by the upstream maintainers. Original license is MIT.
