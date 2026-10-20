import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';
test('installer dry run validates SHA and does not accept another repository',()=>{
 let p=spawnSync('python3',['deploy/install.py','--sha','a'.repeat(40)],{encoding:'utf8'});assert.equal(p.status,0);assert.equal(JSON.parse(p.stdout).mode,'dry-run');
 p=spawnSync('python3',['deploy/install.py','--sha','main'],{encoding:'utf8'});assert.equal(p.status,1);
 p=spawnSync('python3',['deploy/install.py','--sha','a'.repeat(40),'--repo','https://github.com/other/repo.git'],{encoding:'utf8'});assert.equal(p.status,1);
});
test('automatic updates require successful manual CI for exact main SHA',()=>{
 const code=`import importlib.util\ns=importlib.util.spec_from_file_location('update','deploy/update.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr={'head_sha':'abc','head_branch':'main','event':'workflow_dispatch','status':'completed','conclusion':'success'}\nassert m.verified({'workflow_runs':[r]},'abc')\nfor key,bad in [('head_sha','other'),('head_branch','feature'),('event','push'),('status','queued'),('conclusion','failure')]:\n c=dict(r);c[key]=bad;assert not m.verified({'workflow_runs':[c]},'abc')\n`;
 const p=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});

test('generic secure onboarding preserves keys, validates identity and rolls back',()=>{
 const p=spawnSync('python3',['tests/configure_test.py'],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
test('onboarding argument errors do not echo accidental credential values',()=>{
 const marker='synthetic-sensitive-marker';const p=spawnSync('python3',['deploy/configure.py','--token',marker],{encoding:'utf8'});assert.equal(p.status,1);assert.ok(!p.stdout.includes(marker));assert.ok(!p.stderr.includes(marker));
});
