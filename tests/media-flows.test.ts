import test from 'node:test';import assert from 'node:assert/strict';
import {createMediaExecutor} from '../src/media/flows.js';
test('photo upload executes get server/upload/save and returns attachment',async()=>{
 const calls:string[]=[];
 const run=createMediaExecutor({download:async()=>({bytes:Buffer.from('image'),contentType:'image/jpeg',filename:'media.jpg'}),upload:async()=>{calls.push('upload');return {server:123,photo:'[]',hash:'synthetic'};},request:async(m)=>{calls.push(m);return m==='photos.getWallUploadServer'?{status:'ok',data:{upload_url:'https://upload.vk.com/photo'}}:{status:'ok',data:[{owner_id:-123,id:456}]};}});
 const out:any=await run('media.uploadWallPhoto',{group_id:123,source_url:'https://example.com/media.jpg'},'synthetic');assert.equal(out.status,'ok');assert.equal(out.attachment,'photo-123_456');assert.deepEqual(calls,['photos.getWallUploadServer','upload','photos.saveWallPhoto']);
});
test('download failure never reserves a video or calls upload',async()=>{
 let calls=0;const run=createMediaExecutor({download:async()=>{throw Error('secret_query');},upload:async()=>{calls++;return {};},request:async()=>{calls++;return {status:'ok'};}});
 const out:any=await run('media.uploadVideo',{group_id:123,source_url:'https://example.com/v.mp4'},'synthetic');assert.equal(out.status,'rejected');assert.equal(calls,0);assert.ok(!JSON.stringify(out).includes('secret_query'));
});
test('failed upload after reservation is unknown and never retried',async()=>{
 let uploads=0;const run=createMediaExecutor({download:async()=>({bytes:Buffer.from('video'),contentType:'video/mp4',filename:'media.mp4'}),upload:async()=>{uploads++;throw Error('credential');},request:async()=>({status:'ok',data:{upload_url:'https://upload.vk.com/video',owner_id:-123,video_id:789}})});
 const out:any=await run('media.uploadVideo',{group_id:123,source_url:'https://example.com/v.mp4'},'synthetic');assert.equal(out.status,'unknown');assert.equal(uploads,1);assert.equal(out.stage,'upload');
});
test('video ownership is validated before any bytes are uploaded',async()=>{
 let uploads=0;const run=createMediaExecutor({download:async()=>({bytes:Buffer.from('video'),contentType:'video/mp4',filename:'media.mp4'}),upload:async()=>{uploads++;return {};},request:async()=>({status:'ok',data:{upload_url:'https://upload.vk.com/video',owner_id:-999,video_id:789}})});
 const out:any=await run('media.uploadVideo',{group_id:123,source_url:'https://example.com/v.mp4'},'synthetic');assert.equal(uploads,0);assert.equal(out.status,'unknown');assert.equal(out.stage,'reserve');
});

test('empty media does not create a VK video reservation',async()=>{
 let requests=0;const run=createMediaExecutor({download:async()=>({bytes:Buffer.alloc(0),contentType:'video/mp4',filename:'media.mp4'}),upload:async()=>({}),request:async()=>{requests++;return {status:'ok'};}});
 const out:any=await run('media.uploadVideo',{group_id:123,source_url:'https://example.com/v.mp4'},'synthetic');assert.equal(out.status,'rejected');assert.equal(requests,0);
});
