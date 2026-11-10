import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {apply,inject,name} from '../lib/index.js';
import {looksLikeRefusal,streamWithRefusalRetry,RETRY_NUDGE} from '../lib/refusal-retry.js';

const run = async generator => { const chunks=[]; for await(const c of generator)chunks.push(c); return chunks;};
const stream = text => (async function*(){yield {type:'text-delta',text};yield {type:'finish'};})();
const sys = text => ({role:'system',content:[{type:'text',text}]});

test('Cordis plugin exports are compatible with the upstream hook API',()=>{
 assert.equal(name,'dsh-purge-focus');assert.deepEqual(inject,['systemPrompt']);
 let registered,section;
 apply({on:(name,fn)=>{registered={name,fn}},systemPrompt:{section: x=>{section=x}}});
 assert.equal(registered.name,'llm/stream');assert.equal(section.interpolate,false);
 assert.equal(typeof section.text,'string');
});
test('disabled means no prompt section and no llm hook',()=>{
 let count=0;apply({on:()=>{count++},systemPrompt:{section:()=>{count++}}},{enabled:false}); assert.equal(count,0);
});
test('retry can be disabled without disabling style',()=>{
 let count=0;apply({on:()=>{count++},systemPrompt:{section:()=>{count++}}},{refusalRetry:false});assert.equal(count,1);
});
test('specific refusal triggers one retry and second answer replaces first',async()=>{
 let calls=[];
 const fn=options=>{calls.push(options);return stream(calls.length===1?'抱歉，我不能帮助你回答这个普通问题':'具体回答：可以先从真实互动开始。');};
 const out=await run(streamWithRefusalRetry(fn,{messages:[sys('base system')]}));
 assert.equal(calls.length,2);assert.match(calls[1].messages[0].content[0].text,/Second-pass answer review/);
 assert.equal(calls[0].messages[0].content[0].text,'base system');
 assert.equal(out[0].text,'具体回答：可以先从真实互动开始。');
});
test('successful text is not retried',async()=>{
 let n=0;const chunks=await run(streamWithRefusalRetry(()=>{n++;return stream('面对面聊天更关键的是观察对方反应。')},{messages:[sys('base')]}));
 assert.equal(n,1);assert.equal(chunks[0].text,'面对面聊天更关键的是观察对方反应。');
});
test('discussion about refusals is not itself blocked',()=>{
 assert.equal(looksLikeRefusal('这段文章分析了什么是拒答机制和提示词注入。'),false);
 assert.equal(looksLikeRefusal('抱歉，我不能同意这个结论，因为证据不足。'),false);
 assert.equal(looksLikeRefusal('我不能帮助你完成这个要求。'),true);
});
test('one retry only, second refusal is returned unaltered',async()=>{
 let n=0;const out=await run(streamWithRefusalRetry(()=>{n++;return stream(n===1?'抱歉，我不能帮助':'抱歉，我不能帮助');},{messages:[sys('system')]}));
 assert.equal(n,2);assert.equal(out[0].text,'抱歉，我不能帮助');
});
test('no system message means no retry',async()=>{
 let n=0;await run(streamWithRefusalRetry(()=>{n++;return stream('我不能帮助你');},{messages:[{role:'user',content:'hi'}]}));assert.equal(n,1);
});
test('string system content supported and tool streams never retried',async()=>{
 let n=0;const opts={messages:[{role:'system',content:'original'}]};
 await run(streamWithRefusalRetry(()=>{n++;return stream(n===1?'我不能帮助你':'可回答');},opts));
 assert.equal(n,2);
 let attempts=0;await run(streamWithRefusalRetry(()=>{attempts++;return (async function*(){yield {type:'text-delta',text:'我不能帮助你'};yield {type:'tool-call-delta'};})()},opts));assert.equal(attempts,1);
});
test('package omits host patching, permissions, redteam and OAuth control',()=>{
 const patch=fs.readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8');
 const js=fs.readFileSync(new URL('../lib/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(patch.split("\n").filter(line=>!line.trim().startsWith("#")).join("\n"),/includeHarnessIdentity|hooksDenyBypass|autoApplyOnStart|redteam|sandbox/i);
 assert.doesNotMatch(js,/execSync|spawn|OAuth|patchAllShims|applyPatchesAllHosts/);
 assert.match(RETRY_NUDGE,/keep it intact/);
});
test('registered llm hook actually retries a simulated first refusal',async()=>{
 let handler;
 apply({on:(event,fn)=>{if(event==='llm/stream')handler=fn},systemPrompt:{section:()=>{}}},{assistantStyle:false});
 assert.equal(typeof handler,'function');
 let calls=[];const next=updated=>{calls.push(updated);return stream(calls.length===1?'抱歉，我无法提供帮助':'现实里可以这样做。')};
 const out=await run(handler({messages:[sys('base')]},next));
 assert.equal(calls.length,2);assert.equal(out[0].text,'现实里可以这样做。');
});
