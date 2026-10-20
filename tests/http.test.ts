import test from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../src/server/http.js';
import { createRuntime } from '../src/vk/runtime.js';

const bearer='synthetic-test-credential-for-http-32chars';
async function fixture(fn:(base:string)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'vk-http-'));
 const runtime=createRuntime({communities:[],tokens:{},writesEnabled:false,stateDir:dir});
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
test('SDK initialize/list/call reports unconfigured and catalog tools',()=>fixture(async base=>{
 async function rpc(method:string,params:any={}){
  const response=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200);return response.json() as Promise<any>;
 }
 assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'vk-mcp');
 const tools=(await rpc('tools/list')).result.tools;assert.ok(tools.some((x:any)=>x.name==='vk_status'));assert.ok(tools.length>=20);
 const status=await rpc('tools/call',{name:'vk_status',arguments:{}});assert.equal(status.result.structuredContent.status,'not_configured');
 const response=await fetch(base+'/health',{headers});const health:any=await response.json();assert.equal(health.release,'test');assert.equal(health.vk,'not_configured');
}));
test('denies bad host/origin, malformed and oversized input',()=>fixture(async base=>{
 const spoofStatus=await new Promise<number>((resolve,reject)=>{const req=request(base+'/mcp',{method:'POST',headers:{...headers,host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');});assert.equal(spoofStatus,403);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:'{'})).status,400);
 assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({big:'a'.repeat(1048576)})})).status,413);
}));
