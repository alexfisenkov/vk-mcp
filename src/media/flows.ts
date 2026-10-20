import {safeDownload,uploadToVk,type DownloadedMedia} from './index.js';
import {vkRequest,type Transport,type ApiResult} from '../vk/client.js';
type Dependencies={download:(url:string)=>Promise<DownloadedMedia>,upload:typeof uploadToVk,request:Transport};
export function createMediaExecutor(deps:Dependencies={download:safeDownload,upload:uploadToVk,request:vkRequest}){
 return async(action:string,params:Record<string,unknown>,token:string):Promise<ApiResult & Record<string,unknown>>=>{
  if(!['media.uploadWallPhoto','media.uploadVideo'].includes(action))return {status:'rejected',reason:'Unsupported media operation'};
  let media:DownloadedMedia;
  try{media=await deps.download(String(params.source_url));}catch{return {status:'rejected',reason:'Media download failed',stage:'download'};}
  if(media.bytes.length===0)return {status:'rejected',reason:'Empty media is not uploadable',stage:'download'};
  const photo=action==='media.uploadWallPhoto';
  if(photo?!['image/jpeg','image/png','image/webp'].includes(media.contentType):media.contentType!=='video/mp4')return {status:'rejected',reason:'Media type does not match action',stage:'download'};
  let stage='reserve';
  try{
   const reserve=await deps.request(photo?'photos.getWallUploadServer':'video.save',photo?{group_id:params.group_id}:{group_id:params.group_id,name:params.name??'',description:params.description??'',no_comments:0},token,!photo);
   if(reserve.status!=='ok')return {...reserve,stage};
   const data=reserve.data as Record<string,unknown>|undefined;
   if(!data||typeof data.upload_url!=='string')return {status:photo?'api_error':'unknown',stage,reason:'Missing VK upload URL'};
   if(!photo&&(!Number.isSafeInteger(data.video_id)||data.owner_id!==-Number(params.group_id)))return {status:'unknown',stage,reason:'Unexpected video ownership'};
   stage='upload';const uploaded=await deps.upload(data.upload_url,media.bytes,media.contentType,media.filename,photo?'photo':'video_file');
   if('error' in uploaded)return {status:'unknown',stage,reason:'VK upload returned an error'};
   if(!photo){
    if(!Number.isSafeInteger(data.video_id)||data.owner_id!==-Number(params.group_id))return {status:'unknown',stage,reason:'Unexpected video ownership'};
    return {status:'ok',attachment:`video${data.owner_id}_${data.video_id}`,owner_id:data.owner_id,video_id:data.video_id,processing:true};
   }
   if(!Number.isSafeInteger(uploaded.server)||typeof uploaded.photo!=='string'||typeof uploaded.hash!=='string')return {status:'unknown',stage,reason:'Unexpected VK upload response'};
   stage='save';const saved=await deps.request('photos.saveWallPhoto',{group_id:params.group_id,server:uploaded.server,photo:uploaded.photo,hash:uploaded.hash,caption:params.caption??''},token,true);
   if(saved.status!=='ok')return {...saved,stage};
   const image=Array.isArray(saved.data)?saved.data[0]:undefined;
   if(!image||image.owner_id!==-Number(params.group_id)||!Number.isSafeInteger(image.id))return {status:'unknown',stage,reason:'Unexpected photo ownership'};
   return {status:'ok',attachment:`photo${image.owner_id}_${image.id}`,owner_id:image.owner_id,photo_id:image.id};
  }catch{return {status:'unknown',stage,reason:'Media outcome unknown; reconcile before creating another plan'};}
 };
}
