import test from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../src/server/http.js';
import { createRuntime } from '../src/vk/runtime.js';
import { VERSION } from '../src/version.js';

const bearer='synthetic-test-credential-for-http-32chars';
async function fixture(fn:(base:string)=>Promise<void>,extra:Partial<Parameters<typeof createRuntime>[0]>={}){
 const dir=await mkdtemp(join(tmpdir(),'vk-http-'));
 const runtime=createRuntime({communities:[],tokens:{},writesEnabled:false,...extra,stateDir:dir});
 const server=createHttpServer({runtime,bearer,allowedHosts:['127.0.0.1'],allowedOrigins:[],release:'test'});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address(); if(!address||typeof address==='string')throw Error('listen');
 try{await fn(`http://127.0.0.1:${address.port}`);}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await rm(dir,{recursive:true,force:true});}
}
const headers={Authorization:`Bearer ${bearer}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
test('rejects anonymous and wrong bearer before MCP or health',()=>fixture(async base=>{
 for(const path of ['/mcp','/health']){
 assert.equal((await fetch(base+path)).status,401);
 assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer wrong'}})).status,401);
 }
}));
test('MCP write plan is local and missing owner receipt is an explicit tool error',()=>fixture(async base=>{
 async function call(name:string,args:Record<string,unknown>){const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await r.json() as any).result;}
 const plan=await call('vk_comments_close_plan',{params:{owner_id:-123,post_id:7}});
 assert.equal(plan.structuredContent.status,'planned');assert.equal(plan.isError,false);
 const outcome=await call('vk_execute_write',{plan_id:plan.structuredContent.planId,confirmation:plan.structuredContent.confirmation});
 assert.equal(outcome.structuredContent.status,'approval_required');assert.equal(outcome.isError,true);
},{communities:[123],tokens:{group:{'123':'synthetic-group'}},writesEnabled:true,transport:async()=>{throw Error('No VK calls allowed in this test');}}));
test('SDK initialize/list/call reports unconfigured and catalog tools',()=>fixture(async base=>{
 async function rpc(method:string,params:any={}){
  const response=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200);return response.json() as Promise<any>;
 }
 assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'vk-mcp');
 const tools=(await rpc('tools/list')).result.tools;assert.equal(tools.length,50);assert.equal(new Set(tools.map((x:any)=>x.name)).size,50);
 for(const name of ['vk_status','vk_communities','vk_capabilities','vk_stories_get','vk_post_delete_plan','vk_poll_create_plan'])assert.ok(tools.some((x:any)=>x.name===name));
 assert.equal(tools.find((x:any)=>x.name==='vk_execute_write').annotations.destructiveHint,true);
 assert.equal(tools.find((x:any)=>x.name==='vk_post_delete_plan').annotations.openWorldHint,false);
 const status=await rpc('tools/call',{name:'vk_status',arguments:{}});assert.equal(status.result.structuredContent.status,'not_configured');
 const communities=await rpc('tools/call',{name:'vk_communities',arguments:{}});assert.deepEqual(communities.result.structuredContent.communities,[]);
 const capabilities=await rpc('tools/call',{name:'vk_capabilities',arguments:{}});assert.ok(capabilities.result.structuredContent.methodCount>90);
 const response=await fetch(base+'/health',{headers});const health:any=await response.json();assert.equal(health.release,'test');assert.equal(health.vk,'not_configured');assert.equal(health.version,VERSION);
}));
test('denies bad host/origin, malformed and oversized input',()=>fixture(async base=>{
 const spoofStatus=await new Promise<number>((resolve,reject)=>{const req=request(base+'/mcp',{method:'POST',headers:{...headers,host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');});assert.equal(spoofStatus,403);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:'{'})).status,400);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({big:'a'.repeat(1048576)})})).status,413);
}));
