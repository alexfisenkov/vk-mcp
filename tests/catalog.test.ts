import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, findMethod, type Method, type Parameter } from '../src/catalog/index.js';
import { validate } from '../src/policy/validation.js';
import { createRuntime } from '../src/vk/runtime.js';

function value(p:Parameter):unknown {
 if(p.enum?.length)return p.enum[0];
 const type=Array.isArray(p.type)?p.type[0]:p.type;
 if(type==='integer'||type==='number')return Math.max(p.minimum??1,1);
 if(type==='boolean')return true;
 if(type==='array')return [value({name:'item',...(p.items as Parameter)})];
 return 'synthetic'.repeat(Math.ceil(Number(p.minLength??1)/9));
}
function params(method:Method):Record<string,unknown> {
 const input:Record<string,unknown>={};
 for(const p of method.parameters)if(p.required)input[p.name]=value(p);
 input[method.scope]=method.scope==='owner_id'?-123:123;
 if(method.name==='video.delete')input.target_id=input.owner_id;
 if(method.name==='messages.edit')input.message='synthetic';
 return input;
}

test('the reviewed catalog is broad, unique, typed and explicitly community scoped',()=>{
 assert.equal(catalog.length,102); // 100 pinned API methods + two fixed media flows.
 assert.equal(new Set(catalog.map(method=>method.name)).size,catalog.length);
 for(const method of catalog){
  assert.equal(method.liveVerified,false);
  assert.ok(method.tokenTypes.includes(method.token),`${method.name} primary token matches supported types`);
  assert.ok(method.parameters.find(p=>p.name===method.scope&&p.type==='integer'&&p.required),method.name);
  assert.equal(validate(method,params(method),[123]).ok,true,method.name);
  assert.equal(validate(method,{...params(method),[method.scope]:method.scope==='owner_id'?-999:999},[123]).ok,false,method.name);
  assert.equal(validate(method,{...params(method),[method.scope]:method.scope==='owner_id'?123:-123},[123]).ok,false,method.name);
  const noScope=params(method);delete noScope[method.scope];
  assert.equal(validate(method,noScope,[123]).ok,false,method.name);
 }
});

test('message edits support attachment-only content but reject no edit content',()=>{
 const method=findMethod('messages.edit')!;
 const base={group_id:123,peer_id:7,cmid:2};
 assert.equal(validate(method,{...base,attachment:'photo-123_9'},[123]).ok,true);
 assert.equal(validate(method,{...base,message:'synthetic'},[123]).ok,true);
 assert.equal(validate(method,base,[123]).ok,false);
 assert.equal(validate(method,{...base,message:'  ',attachment:''},[123]).ok,false);
});

test('new method families reject scope overrides, unlisted params and credential injection',()=>{
 for(const name of ['wall.delete','groups.ban','messages.delete','photos.delete','video.delete','board.deleteTopic','polls.edit','stories.delete','market.delete','docs.delete']){
  const method=findMethod(name)!;
  for(const extra of [{access_token:'synthetic'},{v:'5.1'},{execute:'bad'},{random_id:1},{domain:'elsewhere'},{target_id:-999},{unknown:'bad'}])
   assert.equal(validate(method,{...params(method),...extra},[123]).ok,false,`${name} ${Object.keys(extra)[0]}`);
  for(const p of method.parameters.filter(p=>p.required&&p.name!==method.scope)){
   const without=params(method);delete without[p.name];
   assert.equal(validate(method,without,[123]).ok,false,`${name} requires ${p.name}`);
  }
 }
});

test('deletion and moderation targets cannot be optional, zero, compound or cross-owner',()=>{
 for(const [name,target] of [
  ['wall.delete','post_id'],['wall.deleteComment','comment_id'],['photos.delete','photo_id'],
  ['video.delete','video_id'],['board.deleteTopic','topic_id'],['polls.edit','poll_id'],
  ['stories.delete','story_id'],['market.delete','item_id'],['docs.delete','doc_id'],
  ['groups.ban','owner_id'],['groups.unban','owner_id']
 ]){
  const method=findMethod(name!)!;
  for(const invalid of [undefined,0,-999,'-999_1',1.5,Number.MAX_SAFE_INTEGER+1]){
   const input={...params(method),[target!]:invalid};if(invalid===undefined)delete input[target!];
   assert.equal(validate(method,input,[123]).ok,false,`${name} ${String(invalid)}`);
  }
 }
});

test('messages use a community credential and bounded conversation-local selectors only',()=>{
 for(const method of catalog.filter(method=>method.name.startsWith('messages.')))assert.deepEqual(method.tokenTypes,['group'],method.name);
 for(const name of ['messages.edit','messages.delete','messages.getByConversationMessageId']){
  const method=findMethod(name)!;
  for(const extra of [{message_ids:[1]},{message_id:1},{peer_ids:[1,2]},{cmids:['-999_1']}])
   assert.equal(validate(method,{...params(method),...extra},[123]).ok,false,name);
 }
 const method=findMethod('messages.delete')!;
 for(const cmids of [[],[0],[-1],['1'],Array(101).fill(1)])assert.equal(validate(method,{...params(method),cmids},[123]).ok,false);
 assert.equal(validate(method,{group_id:123,peer_id:7,cmids:[1,2],delete_for_all:true},[123]).ok,true);
});

test('video deletion cannot fall back to the user collection or another target owner',()=>{
 const method=findMethod('video.delete')!;
 for(const target_id of [undefined,123,-999])assert.equal(validate(method,{owner_id:-123,video_id:7,target_id},[123]).ok,false);
 assert.equal(validate(method,{owner_id:-123,video_id:7,target_id:-123},[123]).ok,true);
 for(const name of ['video.deleteAlbum','video.editAlbum'])assert.equal(findMethod(name)?.scope,'group_id');
});

test('unsafe global, credential-returning and raw upload methods are absent',()=>{
 for(const name of ['execute','wall.repost','wall.getById','groups.get','groups.getCallbackServers','groups.getCallbackConfirmationCode','groups.getLongPollServer','messages.getLongPollServer','messages.getById','messages.sendReaction','photos.getById','video.getLongPollServer','stories.getById','market.getById','docs.getById','docs.getUploadServer','photos.getUploadServer','photos.getWallUploadServer','photos.save','video.save'])
  assert.equal(findMethod(name),undefined,name);
 for(const method of catalog)assert.ok(!method.parameters.some(p=>['access_token','secret_key','v','execute','random_id'].includes(p.name)),method.name);
});

test('every new mutation remains inaccessible from the read path and requires a consumed plan',async()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'vk-catalog-'));let calls=0;
 const runtime=createRuntime({communities:[123],tokens:{group:{'123':'synthetic-group'},user:'synthetic-user',service:'synthetic-service'},writesEnabled:true,stateDir,transport:async()=>{calls++;return {status:'ok'};}});
 try{
  for(const method of catalog.filter(method=>method.mode==='write'))assert.equal((await runtime.read(method.name,params(method))).status,'rejected',method.name);
  const plan=await runtime.plan('wall.delete',{owner_id:-123,post_id:7});
  assert.equal(plan.status,'planned');
  assert.equal((await runtime.execute(String(plan.planId),String(plan.confirmation))).status,'approval_required');
  assert.equal(calls,0);
 }finally{rmSync(stateDir,{recursive:true});}
});

test('catalog generator rejects unknown flags and source bytes that do not match pinned SHA256',()=>{
 const script=fileURLToPath(new URL('../scripts/build-catalog.mjs',import.meta.url));
 assert.equal(spawnSync(process.execPath,[script,'--unknown'],{encoding:'utf8'}).status,1);
 const sourceDir=mkdtempSync(join(tmpdir(),'vk-schema-'));
 try{
  // The manifest starts with board. A valid-looking but untrusted source must
  // fail before it can alter the checked-in catalog.
  writeFileSync(join(sourceDir,'board.json'),JSON.stringify({methods:[]}));
  const before=readFileSync(new URL('../src/catalog/methods.json',import.meta.url),'utf8');
  const result=spawnSync(process.execPath,[script,'--source-dir',sourceDir],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Pinned source hash mismatch: board/u);
  assert.equal(readFileSync(new URL('../src/catalog/methods.json',import.meta.url),'utf8'),before);
 }finally{rmSync(sourceDir,{recursive:true});}
});
