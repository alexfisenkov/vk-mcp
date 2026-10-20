#!/usr/bin/env python3
"""Authorize one existing write plan from a privileged owner session, not MCP."""
import argparse,json,os,pwd,re,secrets,stat,sys,time
from pathlib import Path

def protected_read(path,limit):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'r') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size>limit:raise ValueError('invalid file')
        return json.load(stream)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',default='/etc/vk-mcp/config.json');p.add_argument('--plan-id',required=True);p.add_argument('--hash',required=True);a=p.parse_args()
    if os.geteuid()!=0:raise ValueError('privileged owner session required')
    if not re.fullmatch('[a-f0-9]{32}',a.plan_id) or not re.fullmatch('[a-f0-9]{64}',a.hash):raise ValueError('invalid binding')
    config=protected_read(Path(a.config),65536)
    if not config['writesEnabled']:raise ValueError('write profile disabled')
    state=Path(config['stateDir']);directory=Path(config['approvalDir'])
    if not directory.is_absolute():raise ValueError('invalid approval directory')
    for path in [*reversed(directory.parents),directory]:
        info=path.lstat()
        if path.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('approval directory not root-controlled')
    plan=protected_read(state/(a.plan_id+'.json'),1048576)
    if plan['id']!=a.plan_id or plan['hash']!=a.hash or plan['expiresAt']<=time.time()*1000 or plan['expiresAt']>time.time()*1000+600000:raise ValueError('plan expired or mismatched')
    if (state/(a.plan_id+'.consumed')).exists():raise ValueError('operation already consumed')
    if not re.fullmatch('[a-zA-Z][a-zA-Z.]+',plan['method']):raise ValueError('invalid method')
    receipt={'planId':a.plan_id,'hash':a.hash,'method':plan['method'],'expiresAt':plan['expiresAt']}
    path=directory/(a.plan_id+'.json');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
    with os.fdopen(fd,'w') as stream:json.dump(receipt,stream);stream.flush();os.fsync(stream.fileno())
    os.chown(path,0,pwd.getpwnam('mcp-vk').pw_gid)
    print(json.dumps({'status':'approved','planId':a.plan_id,'method':plan['method'],'hash':a.hash}))
if __name__=='__main__':
    try:main()
    except Exception:print('Approval refused; inspect plan and owner instruction',file=sys.stderr);sys.exit(1)
