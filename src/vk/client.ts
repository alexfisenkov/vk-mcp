import { API_VERSION } from '../catalog/index.js';
export type ApiResult = {status:string;data?:unknown;code?:number;reason?:string};
export type Transport = (method:string,params:Record<string,unknown>,token:string,write:boolean)=>Promise<ApiResult>;
let nextCall=0;
let queue=Promise.resolve();
export const vkRequest:Transport = async(method,params,token,write)=>{
 // Serialize start times globally; no retries, including VK rate-limit errors.
 const turn=queue.then(async()=>{await new Promise(r=>setTimeout(r,Math.max(0,nextCall-Date.now())));nextCall=Date.now()+350;});
 queue=turn.catch(()=>{});await turn;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const body=new URLSearchParams({access_token:token,v:API_VERSION});
  for(const [key,value] of Object.entries(params))body.set(key,Array.isArray(value)?value.join(','):typeof value==='boolean'?(value?'1':'0'):String(value));
  const response=await fetch(`https://api.vk.com/method/${method}`,{method:'POST',body,signal:controller.signal,redirect:'error'});
  if(!response.ok){await response.body?.cancel();return {status:write?'unknown':'api_error',reason:'Upstream HTTP failure'};}
  if(!response.body)return {status:write?'unknown':'api_error',reason:'Missing upstream body'};
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024){await reader.cancel();return {status:write?'unknown':'api_error',reason:'Upstream response exceeds bound'};}chunks.push(value);}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {response?:unknown;error?:{error_code?:number}};
  if(result.error)return {status:'api_error',code:typeof result.error.error_code==='number'?result.error.error_code:undefined,reason:'VK rejected the request'};
  if(!('response' in result))return {status:write?'unknown':'api_error',reason:'Unexpected upstream response'};
  return {status:'ok',data:result.response};
 }catch{return {status:write?'unknown':'api_error',reason:'Upstream request failed; no automatic retry'};}finally{clearTimeout(timeout);}
};
