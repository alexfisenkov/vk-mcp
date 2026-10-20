import test from 'node:test';import assert from 'node:assert/strict';
import {parseSettings} from '../src/server/config.js';
const input={communities:[],tokens:{},writesEnabled:false,stateDir:'/var/lib/vk-mcp',allowedHosts:['127.0.0.1'],allowedOrigins:[],port:8865};
test('valid empty configuration reports deferred credentials',()=>{const c=parseSettings(input);assert.deepEqual(c.tokens,{});assert.equal(c.writesEnabled,false);});
test('rejects unsafe config, unknown fields and group tokens outside allowlist',()=>{for(const patch of [{port:-1},{writesEnabled:'false'},{allowedHosts:['*']},{stateDir:'relative'},{tokens:{group:{'999':'synthetic'}}},{extra:true}])assert.throws(()=>parseSettings({...input,...patch}));});
