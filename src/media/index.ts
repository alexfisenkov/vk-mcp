import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';

const MIB = 1024 * 1024;
const MIME = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['video/mp4','mp4'],['application/pdf','pdf']]);
const UPLOAD_HOSTS = ['vk.com','userapi.com','vkuserphoto.ru','vkuserlive.net'];
const SAFE_ERRORS = new Set(['invalid_media_url','media_host_rejected','media_dns_rejected','media_redirect_limit','media_type_rejected','media_size_limit','media_http_failed','media_invalid_options','media_upload_response_invalid','media_upload_parameters_invalid']);
interface Address {address:string;family:number}
interface Response {statusCode:number;headers:IncomingHttpHeaders;body:Readable}
interface Dependencies {
 resolve:(host:string)=>Promise<Address>;
 request:(url:URL,address:Address,method:'GET'|'POST',body?:Buffer,headers?:Record<string,string>,timeoutMs?:number)=>Promise<Response>;
}
export interface DownloadOptions {maxBytes?:number;timeoutMs?:number}
export interface DownloadedMedia {bytes:Buffer;contentType:string;filename:string}

/** Conservative global-unicast-only classifier. Mapped IPv6 is rejected entirely. */
export function isPublicAddress(address:string):boolean {
 const version=isIP(address);
 if(version===4){
  const n=address.split('.').map(Number);const a=n[0]!,b=n[1]!,c=n[2]!;
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
 }
 if(version===6){
  const normalized=new URL(`https://[${address}]/`).hostname.slice(1,-1);
  const first=parseInt(normalized.split(':')[0]!,16);
  // Only 2000::/3; exclude transition, special-purpose and documentation space.
  if(!(first>=0x2000&&first<=0x3fff)||first===0x2002)return false;
  if(first===0x2001){const second=parseInt(normalized.split(':')[1]||'0',16);if(second<=0x1ff||second===0xdb8)return false;}
  if(first===0x3fff){const second=parseInt(normalized.split(':')[1]||'0',16);if(second<=0xfff)return false;}
  return true;
 }
 return false;
}

export function validateMediaUrl(value:string,upload=false):URL {
 let url:URL;
 try{if(value.length>8192||!/^https:\/\//i.test(value))throw Error();url=new URL(value);}catch{throw Error('invalid_media_url');}
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hash||url.hostname.endsWith('.'))throw Error('invalid_media_url');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(isIP(host)&&!isPublicAddress(host))throw Error('invalid_media_url');
 if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw Error('invalid_media_url');
 if(upload&&!UPLOAD_HOSTS.some(root=>host===root||host.endsWith(`.${root}`)))throw Error('media_host_rejected');
 return url;
}

export async function resolvePublicAddress(host:string,resolver:(host:string)=>Promise<Address[]>=hostname=>lookup(hostname,{all:true,verbatim:true})):Promise<Address>{
 const answers=await resolver(host.replace(/^\[|\]$/g,''));
 if(!answers.length||answers.some(answer=>!isPublicAddress(answer.address)||isIP(answer.address)!==answer.family))throw Error('media_dns_rejected');
 return answers[0]!;
}

export async function readBoundedBody(body:Readable,maxBytes:number):Promise<Buffer>{
 const chunks:Buffer[]=[];let total=0;
 try {for await(const chunk of body){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>maxBytes)throw Error('media_size_limit');chunks.push(bytes);}return Buffer.concat(chunks,total);}catch(error){body.destroy();throw error;}
}

export function createPinnedLookup(address:Address):LookupFunction {
 return (_host,options,callback)=>{
  if(options.all)(callback as unknown as (error:null,addresses:Address[])=>void)(null,[address]);
  else callback(null,address.address,address.family);
 };
}

const pinnedRequest:Dependencies['request']=(url,address,method,body,headers,timeoutMs=30000)=>new Promise((resolve,reject)=>{
 // A fresh socket and fixed lookup prevent DNS re-resolution/rebinding and pool reuse.
 const req=httpsRequest(url,{method,agent:false,headers,lookup:createPinnedLookup(address)},res=>{
  res.once('end',()=>clearTimeout(deadline));res.once('close',()=>clearTimeout(deadline));res.once('error',()=>clearTimeout(deadline));
  resolve({statusCode:res.statusCode??0,headers:res.headers,body:res});
 });
 const deadline=setTimeout(()=>req.destroy(Error('media_timeout')),timeoutMs);deadline.unref();
 req.once('error',error=>{clearTimeout(deadline);reject(error);});
 req.end(body);
});

function optionsBound(options:DownloadOptions){
 const maxBytes=options.maxBytes??20*MIB,timeoutMs=options.timeoutMs??30000;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>50*MIB||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('media_invalid_options');
 return {maxBytes,timeoutMs};
}
function sanitized(error:unknown,fallback:string):Error{return Error(error instanceof Error&&SAFE_ERRORS.has(error.message)?error.message:fallback);}

/** Dependency seam for offline tests; production exports always use DNS + pinned HTTPS. */
export function createMediaClient(dependencies:Dependencies){
 async function timedRequest(url:URL,method:'GET'|'POST',timeoutMs:number,body?:Buffer,headers?:Record<string,string>):Promise<Response>{
  // Bound DNS and TLS/header wait together; request timer bounds streaming too.
  const controller=new AbortController();let response:Response|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{controller.signal.addEventListener('abort',()=>reject(Error('media_timeout')),{once:true});});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref();
  try{return await Promise.race([(async()=>{const address=await dependencies.resolve(url.hostname);if(!isPublicAddress(address.address))throw Error('media_dns_rejected');if(controller.signal.aborted)throw Error('media_timeout');response=await dependencies.request(url,address,method,body,headers,timeoutMs);if(controller.signal.aborted){response.body.destroy();throw Error('media_timeout');}return response;})(),timeout]);}finally{clearTimeout(timer);}
 }
 async function safeDownload(value:string,options:DownloadOptions={}):Promise<DownloadedMedia>{
  try{
   const {maxBytes,timeoutMs}=optionsBound(options);let url=validateMediaUrl(value);
   for(let redirect=0;redirect<=3;redirect++){
    const response=await timedRequest(url,'GET',timeoutMs);
    if([301,302,303,307,308].includes(response.statusCode)){
     response.body.destroy();if(redirect===3||!response.headers.location)throw Error('media_redirect_limit');
     url=validateMediaUrl(new URL(response.headers.location,url).toString());continue;
    }
    if(response.statusCode!==200){response.body.destroy();throw Error('media_http_failed');}
    const contentType=String(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
    if(!MIME.has(contentType)){response.body.destroy();throw Error('media_type_rejected');}
    const length=response.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>maxBytes)){response.body.destroy();throw Error('media_size_limit');}
    const bytes=await readBoundedBody(response.body,maxBytes);
    return {bytes,contentType,filename:`media.${MIME.get(contentType)}`};
   }
   throw Error('media_redirect_limit');
  }catch(error){throw sanitized(error,'media_download_failed');}
 }
 async function uploadToVk(value:string,bytes:Buffer,contentType:string,filename:string,fieldName:string):Promise<Record<string,unknown>>{
  try{
   const url=validateMediaUrl(value,true);
   if(!MIME.has(contentType)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>50*MIB||!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(fieldName))throw Error('media_upload_parameters_invalid');
   const safeFilename=filename.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||`media.${MIME.get(contentType)}`;
   const boundary=`vkmedia${randomBytes(24).toString('hex')}`;
   const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${safeFilename}"\r\nContent-Type: ${contentType}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
   const response=await timedRequest(url,'POST',30000,body,{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(body.length)});
   // Uploads never follow redirects and never retry unknown write outcomes.
   if(response.statusCode!==200){response.body.destroy();throw Error('media_http_failed');}
   const result:unknown=JSON.parse((await readBoundedBody(response.body,MIB)).toString('utf8'));
   if(!result||typeof result!=='object'||Array.isArray(result))throw Error('media_upload_response_invalid');
   return result as Record<string,unknown>;
  }catch(error){throw sanitized(error,'media_upload_failed');}
 }
 return {safeDownload,uploadToVk};
}
const production=createMediaClient({resolve:resolvePublicAddress,request:pinnedRequest});
export const safeDownload=production.safeDownload;
export const uploadToVk=production.uploadToVk;
