import type { Method, Parameter } from '../catalog/index.js';
export type Validated = { ok:true;community:number;params:Record<string,unknown> }|{ok:false;reason:string};
function validValue(p:Parameter,value:unknown):boolean {
 const types=Array.isArray(p.type)?p.type:[p.type];
 if(!types.some(type=>type==='integer'?typeof value==='number'&&Number.isSafeInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):type==='boolean'?typeof value==='boolean'||value===0||value===1:type==='string'?typeof value==='string':type==='array'?Array.isArray(value):false))return false;
 if(typeof value==='number'&&((p.minimum!==undefined&&value<p.minimum)||(p.maximum!==undefined&&value>p.maximum)))return false;
 if(typeof value==='string'&&typeof p.minLength==='number'&&value.length<p.minLength)return false;
 if(typeof value==='string'&&(value.length>Math.min(p.maxLength??16000,16000)||/[\u0000]/u.test(value)))return false;
 if(p.enum&&!p.enum.includes(value))return false;
 if(Array.isArray(value)){
  if(value.length>1000||(typeof p.maxItems==='number'&&value.length>p.maxItems)||(typeof p.minItems==='number'&&value.length<p.minItems))return false;
  const items=p.items as Parameter|undefined;
  if(value.some(v=>items?.type?!validValue({...items,name:p.name},v):typeof v!=='string'||v.length>1000))return false;
 }
 return true;
}
export function validate(method:Method,input:Record<string,unknown>,communities:ReadonlyArray<number>):Validated {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>40)return {ok:false,reason:'Invalid parameters'};
 const scope=input[method.scope];
 if(typeof scope!=='number'||!Number.isSafeInteger(scope)||(method.scope==='owner_id'?scope>=0:scope<=0))return {ok:false,reason:'Explicit community scope required'};
 const community=Math.abs(scope);
 if(!communities.includes(community))return {ok:false,reason:'Community is not allowlisted'};
 for(const [key,value] of Object.entries(input)){
  const p=method.parameters.find(p=>p.name===key);
  if(!p||['access_token','v','execute','random_id'].includes(key)||!validValue(p,value))return {ok:false,reason:'Unknown or invalid parameter'};
 }
 for(const p of method.parameters)if(p.required&&input[p.name]===undefined)return {ok:false,reason:'Missing required parameter'};
 // Recipient conversations are accessible only through the chosen community token.
 if(method.name.startsWith('messages.')&&input.peer_id!==undefined&&(!Number.isSafeInteger(input.peer_id)||Number(input.peer_id)<=0))return {ok:false,reason:'Invalid conversation'};
 if(method.name==='photos.get'&&Array.isArray(input.photo_ids)&&input.photo_ids.some(id=>typeof id!=='string'||!/^[1-9]\d*$/u.test(id)||!Number.isSafeInteger(Number(id))))return {ok:false,reason:'Only positive owner-local photo IDs are allowed'};
 // These methods deliberately expose conversation-local IDs only. Global
 // message_ids/message_id selectors are not part of their catalog contract.
 if(method.name==='messages.edit'&&input.cmid===undefined)return {ok:false,reason:'Conversation-local message ID required'};
 if(method.name==='messages.edit'&&![input.message,input.attachment].some(value=>typeof value==='string'&&value.trim().length>0))return {ok:false,reason:'Edited text or attachment required'};
 if(method.name==='messages.delete'&&(!Array.isArray(input.cmids)||input.cmids.length===0))return {ok:false,reason:'Conversation-local message IDs required'};
 // owner_id is a ban target here, not a second selectable community scope.
 // The reviewed subset supports user targets only, within group_id.
 if(['groups.ban','groups.unban'].includes(method.name)&&(!Number.isSafeInteger(input.owner_id)||Number(input.owner_id)<=0))return {ok:false,reason:'Positive user target required'};
 // VK can remove a video from a different collection via target_id. Pin the
 // removal collection to the same explicit owner instead of its user default.
 if(method.name==='video.delete'&&input.target_id!==scope)return {ok:false,reason:'Video removal target must match community owner'};
 if(input.from_group!==undefined){
  if(method.name==='wall.createComment'&&input.from_group!==community)return {ok:false,reason:'Comment author must match the scoped community'};
  if(method.name==='wall.post'&&![true,1].includes(input.from_group as number))return {ok:false,reason:'Invalid community post author flag'};
 }
 if(input.count!==undefined&&(Number(input.count)<0||Number(input.count)>1000))return {ok:false,reason:'Count exceeds server bound'};
 return {ok:true,community,params:{...input}};
}
