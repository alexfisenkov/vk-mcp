import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('write profile preserves credentials and approval gates and recovers failed activation',()=>{
 const result=spawnSync('python3',['tests/write_profile_test.py'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
test('write profile rejects accidental credential arguments without echoing values',()=>{
 const marker='synthetic-profile-sensitive-marker';
 const result=spawnSync('python3',['deploy/write-profile.py','--mode','write','--token',marker],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.ok(!result.stdout.includes(marker));assert.ok(!result.stderr.includes(marker));
});
