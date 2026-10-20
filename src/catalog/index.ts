import methods from './methods.json' with { type: 'json' };
export const SCHEMA_COMMIT = '333481bd082ad747d4873ef4a77f9247097eeef0';
export const API_VERSION = '5.199';
export type Parameter = {name:string;type?:string|string[];required?:boolean;minimum?:number;maximum?:number;maxLength?:number;enum?:unknown[];items?:unknown;[key:string]:unknown};
export type Method = {name:string;mode:'read'|'write';scope:'owner_id'|'group_id';description:string;parameters:Parameter[];token:'user'|'group';tokenTypes:string[];liveVerified:boolean};
export const catalog:ReadonlyArray<Method> = methods as Method[];
export const findMethod = (name:string):Method|undefined => catalog.find(m=>m.name===name);
const mediaMethods:Method[]=[
 {name:'media.uploadWallPhoto',mode:'write',scope:'group_id',description:'Download a bounded public image and upload/save it as a community wall photo. Does not publish a wall post.',parameters:[{name:'group_id',type:'integer',required:true},{name:'source_url',type:'string',required:true},{name:'caption',type:'string'}],token:'user',tokenTypes:['user'],liveVerified:false},
 {name:'media.uploadVideo',mode:'write',scope:'group_id',description:'Download a bounded public video, reserve and upload it to an allowlisted community.',parameters:[{name:'group_id',type:'integer',required:true},{name:'source_url',type:'string',required:true},{name:'name',type:'string'},{name:'description',type:'string'}],token:'group',tokenTypes:['user','group'],liveVerified:false}
];
(catalog as Method[]).push(...mediaMethods);
