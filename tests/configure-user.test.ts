import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('user credential importer verifies owner, scopes, admin boundaries and protected rollback',()=>{
 const result=spawnSync('python3',['tests/configure_user_test.py'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
test('user credential importer never echoes accidental token arguments',()=>{
 const marker='synthetic-user-sensitive-marker';
 for(const args of [['--token',marker],['--expected-user-id',marker],['--expected-user-id','789','--expires-at',marker]]){
  const result=spawnSync('python3',['deploy/configure-user.py',...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.ok(!result.stdout.includes(marker));assert.ok(!result.stderr.includes(marker));
  assert.equal(JSON.parse(result.stderr).credentials_suppressed,true);
 }
});
