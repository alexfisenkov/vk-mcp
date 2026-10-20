import { createRuntime } from './vk/runtime.js';
import { createHttpServer } from './server/http.js';
import { parseSettings,readProtectedFile } from './server/config.js';
import { createMediaExecutor } from './media/flows.js';
try{
 const configPath=process.env.VK_MCP_CONFIG??'/etc/vk-mcp/config.json';
 const tokenPath=process.env.VK_MCP_HTTP_TOKEN_FILE??'/etc/vk-mcp/http-token';
 const config=parseSettings(JSON.parse(readProtectedFile(configPath)));
 const bearer=readProtectedFile(tokenPath).trim();
 const release=process.env.VK_MCP_RELEASE??'development';
 const runtime=createRuntime({...config,mediaExecutor:createMediaExecutor()});
 const server=createHttpServer({runtime,bearer,allowedHosts:config.allowedHosts,allowedOrigins:config.allowedOrigins,release});
 server.on('error',()=>{console.error('vk-mcp: listener failed');process.exitCode=1;});
 server.listen(config.port,'127.0.0.1',()=>console.log(JSON.stringify({event:'started',version:'0.2.0',release,vk:runtime.status().status})));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}catch{console.error('vk-mcp: protected configuration unavailable or invalid');process.exitCode=1;}
