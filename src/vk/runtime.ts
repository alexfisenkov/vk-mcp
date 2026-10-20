import { appendFileSync, constants, fstatSync, lstatSync, readSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { API_VERSION, SCHEMA_COMMIT, catalog, findMethod, type Method } from '../catalog/index.js';
import { validate } from '../policy/validation.js';
import { vkRequest, type Transport, type ApiResult } from './client.js';
export type RuntimeConfig={communities:number[];tokens:{group?:Record<string,string>;user?:string;service?:string};writesEnabled:boolean;stateDir:string;approvalDir?:string;/** Trusted programmatic embedding/test seam; never accepted from JSON configuration. */approvalVerifier?:(request:ApprovalRequest)=>boolean;transport?:Transport;mediaExecutor?:(action:string,params:Record<string,unknown>,token:string)=>Promise<unknown>};
export type Result={status:string;[key:string]:unknown};
export type ApprovalRequest={planId:string;hash:string;method:string;expiresAt:number};
/** Strict receipt body validator, shared by filesystem verification and offline tests. */
export function matchesApprovalReceipt(receipt:unknown,request:ApprovalRequest,now=Date.now()):boolean {
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return false;
 const r=receipt as Record<string,unknown>;
 return Object.keys(r).length===4&&r.planId===request.planId&&r.hash===request.hash&&r.method===request.method&&r.expiresAt===request.expiresAt&&Number.isSafeInteger(r.expiresAt)&&Number(r.expiresAt)>now;
}
/** No service-writable path or symlink may supply owner approval. Root creates receipts. */
export function verifyApprovalFile(approvalDir:string|undefined,request:ApprovalRequest):boolean {
 if(!approvalDir||!isAbsolute(approvalDir)||!/^[a-f0-9]{32}$/.test(request.planId))return false;
 let fd:number|undefined;
 try{
  // Check the lexical path, not realpath: realpath would conceal symlinks.
  const absolute=resolve(approvalDir);
  const ancestors:string[]=[];let current=absolute;
  for(;;){ancestors.push(current);if(current===parse(current).root)break;current=dirname(current);}
  for(const path of ancestors){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)return false;}
  fd=openSync(join(absolute,`${request.planId}.json`),constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||(stat.mode&0o022)!==0||stat.size>4096)return false;
  const buffer=Buffer.alloc(4097);let total=0;
  while(total<buffer.length){const count=readSync(fd,buffer,total,buffer.length-total,null);if(count===0)break;total+=count;}
  if(total>4096)return false;
  return matchesApprovalReceipt(JSON.parse(buffer.subarray(0,total).toString('utf8')),request);
 }catch{return false;}finally{if(fd!==undefined)closeSync(fd);}
}
type Plan={id:string;method:string;params:Record<string,unknown>;community:number;hash:string;binding:string;confirmation:string;expiresAt:number};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safeId=(id:string)=>/^[a-f0-9]{32}$/.test(id);
export function createRuntime(config:RuntimeConfig){
 const communities=[...config.communities];
 if(communities.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('Communities must be positive numeric IDs');
 const cfg={...config,communities,tokens:{...config.tokens,group:{...config.tokens.group}}};
 if(!isAbsolute(cfg.stateDir)||resolve(cfg.stateDir)===parse(resolve(cfg.stateDir)).root)throw new Error('State directory must be an absolute non-root path');
 if(!existsSync(cfg.stateDir))mkdirSync(cfg.stateDir,{recursive:true,mode:0o700});
 const stateStat=lstatSync(cfg.stateDir);
 if(!stateStat.isDirectory()||stateStat.isSymbolicLink()||stateStat.uid!==process.geteuid?.()||(stateStat.mode&0o777)!==0o700)throw new Error('State directory must be owned by the service identity with mode 0700');
 const transport=cfg.transport??vkRequest;
 const binding=digest({communities,writesEnabled:cfg.writesEnabled,tokens:cfg.tokens});
 const tokenFor=(method:Method,community:number):string|undefined=>{
  const types=method.tokenTypes;
  if(method.name.startsWith('messages.'))return types.includes('group')?cfg.tokens.group?.[String(community)]:undefined;
  if(types.includes('group')&&cfg.tokens.group?.[String(community)])return cfg.tokens.group[String(community)];
  if(types.includes('user')&&cfg.tokens.user)return cfg.tokens.user;
  if(method.mode==='read'&&types.includes('service'))return cfg.tokens.service;
  return undefined;
 };
 const audit=(id:string,method:string,hash:string,status:string)=>appendFileSync(join(cfg.stateDir,'journal.jsonl'),JSON.stringify({id,method,hash,status,at:new Date().toISOString()})+'\n',{mode:0o600});
 const check=(name:string,params:Record<string,unknown>,mode:'read'|'write')=>{
  const method=findMethod(name);
  if(!method||method.mode!==mode)return {error:{status:'rejected',reason:'Method is not allowlisted for this operation'} as Result};
  if(!communities.length||!Object.values(cfg.tokens.group??{}).some(Boolean)&&!cfg.tokens.user&&!cfg.tokens.service)return {error:{status:'not_configured',reason:'Configure communities and server-side VK credentials'} as Result};
  const validated=validate(method,params,communities);
  if(!validated.ok)return {error:{status:'rejected',reason:validated.reason} as Result};
  const token=tokenFor(method,validated.community);
  if(!token)return {error:{status:'not_configured',reason:'Required token type is not configured for this method'} as Result};
  return {method,token,...validated};
 };
 const invoke=async(method:Method,params:Record<string,unknown>,token:string):Promise<ApiResult>=>{
  try{
   if(method.name.startsWith('media.')){
    if(!cfg.mediaExecutor)return {status:'rejected',reason:'Media executor is unavailable'};
    const result=await cfg.mediaExecutor(method.name,params,token);
    return result&&typeof result==='object'&&'status' in result?result as ApiResult:{status:'ok',data:result};
   }
   const wire={...params};
   // group_id is a mandatory local scope control, not an upstream parameter for every method.
   return await transport(method.name,wire,token,method.mode==='write');
  }catch{return {status:method.mode==='write'?'unknown':'api_error',reason:'Request failed; no automatic retry'};}
 };
 return {
  communities(){return {status:'ok',communities:communities.map(id=>({communityId:id,ownerId:-id,groupCredentialConfigured:Boolean(cfg.tokens.group?.[String(id)])}))};},
  capabilities(){
   const methods=catalog.map(method=>{
    const readyCommunities=communities.filter(id=>Boolean(tokenFor(method,id)));
    const executorReady=!method.name.startsWith('media.')||Boolean(cfg.mediaExecutor);
    return {name:method.name,mode:method.mode,scope:method.scope,tokenTypes:method.tokenTypes,credentialReady:readyCommunities.length>0,credentialReadyCommunityCount:readyCommunities.length,
     executorReady,available:readyCommunities.length>0&&executorReady&&(method.mode==='read'||cfg.writesEnabled),
     approvalRequired:method.mode==='write',liveVerified:false};
   });
   return {status:'ok',writesEnabled:cfg.writesEnabled,ownerApprovalRequired:true,methodCount:catalog.length,readMethodCount:methods.filter(m=>m.mode==='read').length,writeMethodCount:methods.filter(m=>m.mode==='write').length,
    readinessMeaning:'Configured credential and local policy only; VK permissions require a live per-method check',methods};
  },
  status(){return {status:communities.length>0&&(Object.values(cfg.tokens.group??{}).some(Boolean)||Boolean(cfg.tokens.user||cfg.tokens.service))?'configured':'not_configured',configured:communities.length>0&&(Object.values(cfg.tokens.group??{}).some(Boolean)||Boolean(cfg.tokens.user||cfg.tokens.service)),communityCount:communities.length,tokenTypes:{group:Object.values(cfg.tokens.group??{}).some(Boolean),user:Boolean(cfg.tokens.user),service:Boolean(cfg.tokens.service)},writesEnabled:cfg.writesEnabled,methodCount:catalog.length,apiVersion:API_VERSION,schemaCommit:SCHEMA_COMMIT,liveVerified:false};},
  search(query:string,limit=20){return catalog.filter(m=>(m.name+' '+m.description).toLowerCase().includes(String(query).toLowerCase())).slice(0,Math.min(100,Math.max(1,limit))).map(m=>({name:m.name,mode:m.mode,scope:m.scope,tokenTypes:m.tokenTypes,description:m.description,liveVerified:false}));},
  describe(name:string){const m=findMethod(name);return m?JSON.parse(JSON.stringify(m)):undefined;},
  async read(name:string,params:Record<string,unknown>):Promise<Result>{const c=check(name,params,'read');if(c.error)return c.error;return invoke(c.method!,c.params!,c.token!);},
  async plan(name:string,params:Record<string,unknown>):Promise<Result>{
   if(!cfg.writesEnabled)return {status:'writes_disabled'};
   const c=check(name,params,'write');if(c.error)return c.error;
   if(name.startsWith('media.')&&!cfg.mediaExecutor)return {status:'rejected',reason:'Media executor is unavailable'};
   const finalParams={...c.params};if(name==='messages.send')finalParams.random_id=randomInt(1,2147483647);
   const id=randomBytes(16).toString('hex');const hash=digest({method:name,params:finalParams,community:c.community});
   const plan:Plan={id,method:name,params:finalParams,community:c.community!,hash,binding,confirmation:`CONFIRM ${id} ${hash.slice(0,16)}`,expiresAt:Date.now()+10*60*1000};
   try{writeFileSync(join(cfg.stateDir,`${id}.json`),JSON.stringify(plan),{mode:0o600,flag:'wx'});audit(id,name,hash,'planned');}catch{return {status:'storage_error'};}
   return {status:'planned',planId:id,confirmation:plan.confirmation,expiresAt:new Date(plan.expiresAt).toISOString(),method:name,params:finalParams,hash};
  },
  async execute(id:string,confirmation:string):Promise<Result>{
   if(!cfg.writesEnabled)return {status:'writes_disabled'};
   if(!safeId(id))return {status:'rejected'};
   let p:Plan;try{p=JSON.parse(readFileSync(join(cfg.stateDir,`${id}.json`),'utf8')) as Plan;}catch{return {status:'not_found'};}
   if(existsSync(join(cfg.stateDir,`${id}.consumed`)))return {status:'already_consumed',operationId:id};
   if(p.id!==id||p.confirmation!==confirmation||p.binding!==binding||p.hash!==digest({method:p.method,params:p.params,community:p.community}))return {status:'rejected',reason:'Plan confirmation or configuration binding mismatch'};
   if(p.expiresAt<=Date.now())return {status:'expired'};
   const input={...p.params};delete input.random_id;
   const c=check(p.method,input,'write');if(c.error)return c.error;
   const approval:ApprovalRequest={planId:id,hash:p.hash,method:p.method,expiresAt:p.expiresAt};
   let approved=false;try{approved=cfg.approvalVerifier?cfg.approvalVerifier(approval):verifyApprovalFile(cfg.approvalDir,approval);}catch{/* Fail closed on verifier errors. */}
   if(!approved)return {status:'approval_required',operationId:id,reason:'A separate server-side owner approval receipt is required'};
   let marker:number;
   try{marker=openSync(join(cfg.stateDir,`${id}.consumed`),'wx',0o600);}catch(error){
    return (error as NodeJS.ErrnoException).code==='EEXIST'?{status:'already_consumed',operationId:id}:{status:'storage_error',operationId:id,reason:'Consumption marker could not be created; no API call was made'};
   }
   try{try{fsyncSync(marker);}finally{closeSync(marker);}const dir=openSync(cfg.stateDir,'r');try{fsyncSync(dir);}finally{closeSync(dir);}audit(id,p.method,p.hash,'started');}catch{return {status:'unknown',operationId:id,reason:'Consumption marker durability or audit failed; no API call was made; do not replay'};}

   const result=await invoke(c.method!,p.params,c.token!);
   // Persist no response payload or message text. An unrecorded outcome remains unknown.
   try{writeFileSync(join(cfg.stateDir,`${id}.result.json`),JSON.stringify({status:result.status,operationId:id,code:result.code}),{mode:0o600});audit(id,p.method,p.hash,result.status);}catch{return {status:'unknown',operationId:id,reason:'Outcome could not be durably recorded; do not replay'};}
   return {...result,operationId:id};
  },
  operation(id:string):Result{if(!safeId(id))return {status:'rejected'};try{return JSON.parse(readFileSync(join(cfg.stateDir,`${id}.result.json`),'utf8')) as Result;}catch{if(existsSync(join(cfg.stateDir,`${id}.consumed`)))return {status:'unknown',operationId:id};if(existsSync(join(cfg.stateDir,`${id}.json`)))return {status:'planned',operationId:id};return {status:'not_found'};}}
 };
}
export type Runtime=ReturnType<typeof createRuntime>;
