import { openSync, readFileSync, fstatSync, closeSync, constants } from 'node:fs';
import { z } from 'zod';
const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const token=z.string().min(1).max(8192).regex(/^\S+$/);
const schema=z.object({
 communities:z.array(positive).max(100),tokens:z.object({group:z.record(z.string().regex(/^[1-9][0-9]*$/),token).optional(),user:token.optional(),service:token.optional()}).strict(),
 writesEnabled:z.boolean(),approvalDir:z.string().startsWith('/').max(4096).optional(),stateDir:z.string().startsWith('/').max(4096),port:z.number().int().min(1024).max(65535).default(8865),
 allowedHosts:z.array(z.string().regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[::1\])$/)).min(1).max(10),
 allowedOrigins:z.array(z.string().url().refine(s=>new URL(s).protocol==='https:'&&new URL(s).origin===s)).max(20),
}).strict();
export function parseSettings(input:unknown){
 const value=schema.parse(input);
 if(['/', '/etc', '/srv', '/var', '/var/lib', '/home', '/tmp', '/usr'].includes(value.stateDir)||value.stateDir.includes('/../')||value.stateDir.endsWith('/..'))throw Error('unsafe state path');
 if(value.writesEnabled&&!value.approvalDir)throw Error('write profile requires independent owner approval directory');
 if(new Set(value.communities).size!==value.communities.length)throw Error('duplicate communities');
 if(Object.keys(value.tokens.group??{}).some(id=>!value.communities.includes(Number(id))))throw Error('group token is outside allowlist');
 return value;
}
export function readProtectedFile(path:string):string{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.size>65536||(s.mode&0o027)!==0||![0,process.getuid?.()].includes(s.uid))throw Error('invalid protected file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}
}
