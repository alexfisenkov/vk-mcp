import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, matchesApprovalReceipt, verifyApprovalFile } from '../src/vk/runtime.js';
const make = (extra:Record<string,unknown>={}) => {const stateDir=mkdtempSync(join(tmpdir(),'vk-core-'));return {runtime:createRuntime({communities:[],tokens:{},writesEnabled:false,stateDir,...extra}), stateDir};};
test('unconfigured methods are honest and catalog remains usable',async()=>{const {runtime:r,stateDir}=make();try{assert.equal((await r.read('wall.get',{owner_id:-123})).status,'not_configured');assert.ok(r.search('wall').length>0);assert.equal(r.describe('execute'),undefined);assert.equal(r.status().configured,false);}finally{rmSync(stateDir,{recursive:true});}});
test('scope, parameter, reserved-token and write gates fail closed',async()=>{const {runtime:r,stateDir}=make({communities:[123],tokens:{group:{'123':'secret'}}});try{for(const p of [{owner_id:123},{owner_id:-124},{owner_id:-123,access_token:'evil'},{owner_id:-123,v:'5.1'},{owner_id:-123,unknown:'bad'}])assert.equal((await r.read('wall.get',p)).status,'rejected');assert.equal((await r.read('wall.post',{owner_id:-123,message:'x'})).status,'rejected');assert.equal((await r.plan('wall.post',{owner_id:-123,message:'x'})).status,'writes_disabled');}finally{rmSync(stateDir,{recursive:true});}});
test('plan confirmation is exact, single-use and persists across restart',async()=>{const {runtime:r,stateDir}=make({communities:[123],tokens:{group:{'123':'secret'}},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>({status:'unknown'})});try{const p=await r.plan('messages.send',{group_id:123,peer_id:2000000001,message:'synthetic'});assert.equal(p.status,'planned');if(p.status!=='planned')return;assert.equal((await r.execute(p.planId,'wrong')).status,'rejected');assert.equal((await r.execute(p.planId,p.confirmation)).status,'unknown');const again=createRuntime({communities:[123],tokens:{group:{'123':'secret'}},writesEnabled:true,stateDir});assert.equal((await again.execute(p.planId,p.confirmation)).status,'already_consumed');}finally{rmSync(stateDir,{recursive:true});}});
test('token routing respects official types and messages never fall back to personal user',async()=>{
 const calls:Array<{method:string;params:Record<string,unknown>;token:string}>=[];
 const {runtime:r,stateDir}=make({communities:[123],tokens:{group:{'123':'group-synthetic'},user:'user-synthetic',service:'service-synthetic'},transport:async(method:string,params:Record<string,unknown>,token:string)=>{calls.push({method,params,token});return {status:'ok',data:{count:0}};}});
 try{assert.equal((await r.read('wall.get',{owner_id:-123})).status,'ok');assert.equal(calls[0]?.token,'user-synthetic');assert.deepEqual(calls[0]?.params,{owner_id:-123});assert.equal((await r.read('messages.getHistory',{group_id:123,peer_id:7})).status,'ok');assert.equal(calls[1]?.token,'group-synthetic');const userOnly=createRuntime({communities:[123],tokens:{user:'user-synthetic'},writesEnabled:false,stateDir});assert.equal((await userOnly.read('messages.getHistory',{group_id:123,peer_id:7})).status,'not_configured');}finally{rmSync(stateDir,{recursive:true});}
});
test('missing fields and destructive/unknown methods never reach transport',async()=>{
 let calls=0;const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'synthetic'},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>{calls++;return {status:'ok'};}});
 try{assert.equal((await r.plan('wall.edit',{owner_id:-123,message:'x'})).status,'rejected');assert.equal((await r.plan('wall.delete',{owner_id:-123,post_id:7})).status,'rejected');assert.equal((await r.read('execute',{code:'return API.users.get();'})).status,'rejected');assert.equal(calls,0);}finally{rmSync(stateDir,{recursive:true});}
});
test('plan binds exact parameters, configuration and expiry; journal contains no payload',async()=>{
 const {readFileSync,writeFileSync}=await import('node:fs');
 const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'token-synthetic'},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>({status:'ok',data:{post_id:99}})});
 try{const p=await r.plan('wall.post',{owner_id:-123,message:'PRIVATE_SYNTHETIC_TEXT'});assert.equal(p.status,'planned');const planId=String(p.planId),confirmation=String(p.confirmation);const file=join(stateDir,`${planId}.json`);const raw=JSON.parse(readFileSync(file,'utf8'));raw.params.message='tampered';writeFileSync(file,JSON.stringify(raw));assert.equal((await r.execute(planId,confirmation)).status,'rejected');raw.params.message='PRIVATE_SYNTHETIC_TEXT';raw.expiresAt=Date.now()-1;writeFileSync(file,JSON.stringify(raw));assert.equal((await r.execute(planId,confirmation)).status,'expired');const log=readFileSync(join(stateDir,'journal.jsonl'),'utf8');assert.ok(!log.includes('PRIVATE_SYNTHETIC_TEXT'));assert.ok(!log.includes('token-synthetic'));}finally{rmSync(stateDir,{recursive:true});}
});
test('concurrent executes issue one mutation and keep stable random_id',async()=>{
 const calls:Record<string,unknown>[]=[];
 const {runtime:r,stateDir}=make({communities:[123],tokens:{group:{'123':'synthetic'}},writesEnabled:true,approvalVerifier:()=>true,transport:async(_m:string,params:Record<string,unknown>)=>{calls.push(params);await new Promise(resolve=>setTimeout(resolve,5));return {status:'ok'};}});
 try{const p=await r.plan('messages.send',{group_id:123,peer_id:7,message:'synthetic'});const result=await Promise.all([r.execute(String(p.planId),String(p.confirmation)),r.execute(String(p.planId),String(p.confirmation))]);assert.equal(calls.length,1);assert.ok(Number.isSafeInteger(calls[0]?.random_id));assert.deepEqual(result.map(v=>v.status).sort(),['already_consumed','ok']);assert.equal(r.operation(String(p.planId)).status,'ok');}finally{rmSync(stateDir,{recursive:true});}
});
test('API errors strip upstream token/payload and write transport exceptions stay unknown',async()=>{
 const {vkRequest}=await import('../src/vk/client.js');const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.vk.com/method/wall.get');assert.equal(init?.redirect,'error');return new Response(JSON.stringify({error:{error_code:5,error_msg:'token-private',request_params:[{key:'access_token',value:'private'}]}}));};const result=await vkRequest('wall.get',{domain:-123},'token-private',false);assert.equal(result.status,'api_error');assert.equal(result.code,5);assert.ok(!JSON.stringify(result).includes('private'));assert.equal(calls,1);globalThis.fetch=async()=>{throw new Error('token-private');};assert.equal((await vkRequest('wall.post',{},'token-private',true)).status,'unknown');}finally{globalThis.fetch=original;}
});
test('composite entity IDs and secondary scope injection cannot escape community',async()=>{
 let calls=0;const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'synthetic',group:{'123':'synthetic-group'}},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>{calls++;return {status:'ok'};}});
 try{for(const [method,params] of [
  ['photos.get',{owner_id:-123,album_id:'wall',photo_ids:['-999_7']}],
  ['stats.getPostReach',{owner_id:-123,post_ids:['-999_7']}],
  ['wall.get',{owner_id:-123,group_id:999}],
  ['messages.getHistory',{group_id:123,peer_ids:[1,2]}],
  ['photos.get',{owner_id:-123,photo_ids:[7]}]
 ] as Array<[string,Record<string,unknown>]>)assert.equal((await r.read(method,params)).status,'rejected');assert.equal(calls,0);}finally{rmSync(stateDir,{recursive:true});}
});
test('owner approval is mandatory and does not consume a plan when absent',async()=>{
 const {existsSync}=await import('node:fs');let calls=0;
 const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'synthetic'},writesEnabled:true,transport:async()=>{calls++;return {status:'ok'};}});
 try{const p=await r.plan('wall.post',{owner_id:-123,message:'synthetic'});assert.equal(p.status,'planned');assert.equal((await r.execute(String(p.planId),String(p.confirmation))).status,'approval_required');assert.equal(calls,0);assert.equal(existsSync(join(stateDir,`${p.planId}.consumed`)),false);assert.equal(r.operation(String(p.planId)).status,'planned');}finally{rmSync(stateDir,{recursive:true});}
});
test('owner receipt binds exact plan, hash, method and numeric expiry',()=>{
 const request={planId:'a'.repeat(32),hash:'b'.repeat(64),method:'wall.post',expiresAt:Date.now()+60000};
 assert.equal(matchesApprovalReceipt({...request},request),true);
 for(const body of [{...request,planId:'c'.repeat(32)},{...request,hash:'c'.repeat(64)},{...request,method:'wall.edit'},{...request,expiresAt:request.expiresAt+1},{...request,extra:true},{...request,expiresAt:new Date(request.expiresAt).toISOString()}])assert.equal(matchesApprovalReceipt(body,request),false);
 assert.equal(matchesApprovalReceipt(request,request,request.expiresAt),false);
});
test('service-writable, symlink and absent receipt paths cannot approve',async()=>{
 const {mkdirSync,symlinkSync,writeFileSync}=await import('node:fs');const stateDir=mkdtempSync(join(tmpdir(),'vk-approval-'));
 const request={planId:'a'.repeat(32),hash:'b'.repeat(64),method:'wall.post',expiresAt:Date.now()+60000};
 try{writeFileSync(join(stateDir,`${request.planId}.json`),JSON.stringify(request));assert.equal(verifyApprovalFile(stateDir,request),false);const alias=join(stateDir,'link');symlinkSync(stateDir,alias);assert.equal(verifyApprovalFile(alias,request),false);assert.equal(verifyApprovalFile(undefined,request),false);assert.equal(verifyApprovalFile('relative',request),false);mkdirSync(join(stateDir,'nested'));assert.equal(verifyApprovalFile(join(stateDir,'nested'),request),false);}finally{rmSync(stateDir,{recursive:true});}
});
test('comment author from_group cannot select a different community',async()=>{
 let calls=0;const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'synthetic'},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>{calls++;return {status:'ok'};}});
 try{assert.equal((await r.plan('wall.createComment',{owner_id:-123,post_id:7,message:'synthetic',from_group:1})).status,'rejected');assert.equal((await r.plan('wall.createComment',{owner_id:-123,post_id:7,message:'synthetic',from_group:123})).status,'planned');assert.equal((await r.plan('wall.post',{owner_id:-123,message:'synthetic',from_group:1})).status,'planned');assert.equal(calls,0);}finally{rmSync(stateDir,{recursive:true});}
});
test('state directory rejects root, relative and permissive existing directories without chmod',async()=>{
 const {chmodSync,statSync}=await import('node:fs');const stateDir=mkdtempSync(join(tmpdir(),'vk-state-'));
 try{for(const path of ['/', 'relative'])assert.throws(()=>createRuntime({communities:[],tokens:{},writesEnabled:false,stateDir:path}));chmodSync(stateDir,0o755);assert.throws(()=>createRuntime({communities:[],tokens:{},writesEnabled:false,stateDir}));assert.equal(statSync(stateDir).mode&0o777,0o755);}finally{rmSync(stateDir,{recursive:true});}
});
test('pre-marker I/O failure is storage_error; post-marker failure is unknown',async()=>{
 const {chmodSync,mkdirSync,writeFileSync,unlinkSync}=await import('node:fs');const {runtime:r,stateDir}=make({communities:[123],tokens:{user:'synthetic'},writesEnabled:true,approvalVerifier:()=>true,transport:async()=>{throw new Error('must not call');}});
 try{let p=await r.plan('wall.post',{owner_id:-123,message:'synthetic'});chmodSync(stateDir,0o500);try{assert.equal((await r.execute(String(p.planId),String(p.confirmation))).status,'storage_error');}finally{chmodSync(stateDir,0o700);}const original=join(stateDir,'journal.jsonl');unlinkSync(original);mkdirSync(original);assert.equal((await r.execute(String(p.planId),String(p.confirmation))).status,'unknown');assert.equal(r.operation(String(p.planId)).status,'unknown');rmSync(original,{recursive:true});writeFileSync(original,'');p=await r.plan('wall.post',{owner_id:-123,message:'synthetic'});mkdirSync(join(stateDir,`${p.planId}.consumed`));assert.equal((await r.execute(String(p.planId),String(p.confirmation))).status,'already_consumed');}finally{rmSync(stateDir,{recursive:true});}
});
test('schema minimum string and array bounds are enforced',async()=>{
 const {validate}=await import('../src/policy/validation.js');
 const method={name:'synthetic.read',mode:'read' as const,scope:'group_id' as const,description:'synthetic',token:'group' as const,tokenTypes:['group'],liveVerified:false,parameters:[{name:'group_id',type:'integer'},{name:'text',type:'string',minLength:2},{name:'ids',type:'array',minItems:1,maxItems:2,items:{type:'integer'}}]};
 for(const params of [{group_id:123,text:'x',ids:[1]},{group_id:123,text:'ok',ids:[]},{group_id:123,text:'ok',ids:[1,2,3]}])assert.equal(validate(method,params,[123]).ok,false);
 assert.equal(validate(method,{group_id:123,text:'ok',ids:[1,2]},[123]).ok,true);
});
