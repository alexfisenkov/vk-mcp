import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './tools.js';
import type { createRuntime } from '../vk/runtime.js';
export type HttpOptions={runtime:ReturnType<typeof createRuntime>,bearer:string,allowedHosts:string[],allowedOrigins:string[],release:string};
export function createHttpServer(options:HttpOptions){
 if(options.bearer.length<32)throw Error('HTTP bearer must contain at least 32 characters');
 const expected=createHash('sha256').update(`Bearer ${options.bearer}`).digest();
 let windowStart=Date.now(),requests=0;
 function json(res:ServerResponse,status:number,body:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
 const server=createServer({requestTimeout:30000,headersTimeout:10000,maxHeaderSize:16384},async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   const provided=createHash('sha256').update(req.headers.authorization??'').digest();
   if(!timingSafeEqual(provided,expected)){res.setHeader('WWW-Authenticate','Bearer');json(res,401,{error:'unauthorized'});return;}
   let hostname='';try{hostname=new URL(`http://${req.headers.host??''}`).hostname;}catch{}
   if(!options.allowedHosts.includes(hostname)){json(res,403,{error:'invalid_host'});return;}
   if(req.headers.origin&&!options.allowedOrigins.includes(req.headers.origin)){json(res,403,{error:'invalid_origin'});return;}
   if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;}
   if(++requests>120){res.setHeader('Retry-After','60');json(res,429,{error:'rate_limited'});return;}
   if(req.url==='/health'&&req.method==='GET'){const status=await options.runtime.status();json(res,200,{status:'ok',vk:(status as any).status,version:'0.2.0',release:options.release});return;}
   if(req.url!=='/mcp'){json(res,404,{error:'not_found'});return;}
   if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{error:'method_not_allowed'});return;}
   if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){json(res,415,{error:'json_required'});return;}
   let size=0;const chunks:Buffer[]=[];
   for await(const chunk of req){size+=chunk.length;if(size>1048576){json(res,413,{error:'request_too_large'});return;}chunks.push(Buffer.from(chunk));}
   let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{error:'invalid_json'});return;}
   if(!body||typeof body!=='object'||Array.isArray(body)){json(res,400,{error:'invalid_request'});return;}
   const mcp=createMcpServer(options.runtime);
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.once('close',()=>{void transport.close();void mcp.close();});
   await mcp.connect(transport);await transport.handleRequest(req,res,body);
  }catch{if(!res.headersSent)json(res,500,{error:'request_failed'});else res.end();}
 });
 server.keepAliveTimeout=5000;return server;
}
