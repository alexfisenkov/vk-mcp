import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedLookup, isPublicAddress, validateMediaUrl, resolvePublicAddress, readBoundedBody, createMediaClient } from '../src/media/index.js';
import { Readable } from 'node:stream';

test('media rejects private and special IPv4/IPv6 including mapped addresses',()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.1.1','0.0.0.0','192.0.2.1','198.18.0.1','224.1.1.1','::1','::','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:8.8.8.8','2001:db8::1','2002:7f00:1::1']) assert.equal(isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(ip),true,ip);
});
test('media URLs have HTTPS-only URL and VK upload host boundaries',()=>{
 for(const url of ['/etc/passwd','file:///etc/passwd','http://example.com/a','https://a:b@example.com/a','https://example.com:8443/a','https://127.1/a','https://[::1]/a']) assert.throws(()=>validateMediaUrl(url));
 for(const url of ['https://vk.com.evil.test/a','https://evilvk.com/a','https://example.com/a']) assert.throws(()=>validateMediaUrl(url,true));
 assert.equal(validateMediaUrl('https://pu.userapi.com/upload?token=secret',true).hostname,'pu.userapi.com');
 assert.equal(validateMediaUrl('https://upload.vk.com/a',true).hostname,'upload.vk.com');
});
test('all DNS answers are validated and chosen address can be pinned',async()=>{
 await assert.rejects(resolvePublicAddress('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
 assert.deepEqual(await resolvePublicAddress('example.com',async()=>[{address:'8.8.8.8',family:4}]),{address:'8.8.8.8',family:4});
});
test('body bounds count streaming bytes',async()=>{
 await assert.rejects(readBoundedBody(Readable.from([Buffer.alloc(3),Buffer.alloc(4)]),6),/media_size_limit/);
 assert.equal((await readBoundedBody(Readable.from([Buffer.from('ok')]),3)).toString(),'ok');
});
test('redirects are revalidated, bounded, and MIME and size fail closed',async()=>{
 const make=(reply:(url:URL)=>any)=>createMediaClient({resolve:async()=>({address:'8.8.8.8',family:4}),request:async(url)=>reply(url)});
 await assert.rejects(make(()=>({statusCode:302,headers:{location:'https://127.0.0.1/secret'},body:Readable.from([])})).safeDownload('https://example.com/a'),/invalid_media_url/);
 await assert.rejects(make(()=>({statusCode:302,headers:{location:'/next'},body:Readable.from([])})).safeDownload('https://example.com/a'),/media_redirect_limit/);
 await assert.rejects(make(()=>({statusCode:200,headers:{'content-type':'text/html'},body:Readable.from(['secret'])})).safeDownload('https://example.com/a'),/media_type_rejected/);
 await assert.rejects(make(()=>({statusCode:200,headers:{'content-type':'image/png'},body:Readable.from([Buffer.alloc(4)])})).safeDownload('https://example.com/a',{maxBytes:3}),/media_size_limit/);
 const result=await make(()=>({statusCode:200,headers:{'content-type':'image/png'},body:Readable.from([Buffer.from('png')])})).safeDownload('https://example.com/a?access_token=secret');
 assert.equal(result.filename,'media.png'); assert.equal(result.bytes.toString(),'png');
});
test('unexpected network errors never include URL query secrets',async()=>{
 const client=createMediaClient({resolve:async()=>{throw new Error('https://example.com/?token=SUPERSECRET');},request:async()=>{throw Error('unreachable');}});
 await assert.rejects(client.safeDownload('https://example.com/?token=SUPERSECRET'),err=>String(err)==='Error: media_download_failed');
});
test('upload bounds hosts, fields, MIME, and response JSON with synthetic network',async()=>{
 let called=false;
 const client=createMediaClient({resolve:async()=>({address:'8.8.8.8',family:4}),request:async(_url,_address,method,body)=>{called=true;assert.equal(method,'POST');assert.ok(body?.includes(Buffer.from('name="photo"')));return {statusCode:200,headers:{},body:Readable.from(['{"server":1}'])};}});
 await assert.rejects(client.uploadToVk('https://evil.test/a',Buffer.from('x'),'image/png','x.png','photo')); assert.equal(called,false);
 await assert.rejects(client.uploadToVk('https://upload.vk.com/a',Buffer.from('x'),'image/png','x.png','x\r\nheader')); assert.equal(called,false);
 assert.deepEqual(await client.uploadToVk('https://upload.vk.com/a',Buffer.from('x'),'image/png','../../x.png','photo'),{server:1});
});
test('each redirect gets a fresh public DNS pin and original TLS hostname',async()=>{
 const hosts:string[]=[];let calls=0;
 const client=createMediaClient({resolve:async host=>{hosts.push(host);return {address:'8.8.8.8',family:4};},request:async(url,address)=>{assert.equal(address.address,'8.8.8.8');calls++;return calls===1?{statusCode:302,headers:{location:'https://second.example/media'},body:Readable.from([])}:{statusCode:200,headers:{'content-type':'application/pdf'},body:Readable.from(['pdf'])};}});
 assert.equal((await client.safeDownload('https://first.example/media')).contentType,'application/pdf');
 assert.deepEqual(hosts,['first.example','second.example']);
});
test('upload never follows redirects or retries failure',async()=>{
 let calls=0;
 const client=createMediaClient({resolve:async()=>({address:'8.8.8.8',family:4}),request:async()=>{calls++;return {statusCode:307,headers:{location:'https://upload.vk.com/again'},body:Readable.from([])};}});
 await assert.rejects(client.uploadToVk('https://upload.vk.com/a',Buffer.from('x'),'image/png','x.png','photo'),/media_http_failed/);
 assert.equal(calls,1);
});
test('download option caps cannot be bypassed',async()=>{
 const client=createMediaClient({resolve:async()=>{throw Error('must not resolve');},request:async()=>{throw Error('must not request');}});
 for(const opts of [{maxBytes:0},{maxBytes:51*1024*1024},{maxBytes:NaN},{timeoutMs:120001}]) await assert.rejects(client.safeDownload('https://example.com/a',opts),/media_invalid_options/);
});

test('pinned lookup supports Node autoSelectFamily and single-address callbacks',()=>{
 const pin=createPinnedLookup({address:'8.8.8.8',family:4});
 pin('ignored.example',{},(_error,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
 pin('ignored.example',{all:true},((_error:unknown,addresses:unknown)=>{assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);}) as any);
});
