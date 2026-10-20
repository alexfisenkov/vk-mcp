#!/usr/bin/env python3
"""Quietly deploy main only after successful manual Final verification for exact SHA."""
import argparse,json,re,subprocess,sys,urllib.request
from pathlib import Path
API='https://api.github.com/repos/alexfisenkov/vk-mcp/'

def fetch(path):
    request=urllib.request.Request(API+path,headers={'User-Agent':'vk-mcp-release-monitor','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(request,timeout=20) as response:
        if int(response.headers.get('Content-Length','0'))>2097152:raise ValueError('API response too large')
        raw=response.read(2097153)
        if len(raw)>2097152:raise ValueError('API response too large')
        return json.loads(raw)

def verified(runs,sha):
    return any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='workflow_dispatch' and r.get('status')=='completed' and r.get('conclusion')=='success' for r in runs.get('workflow_runs',[]))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',default='/srv/vk-mcp');p.add_argument('--config-dir',default='/etc/vk-mcp');p.add_argument('--state-dir',default='/var/lib/vk-mcp');p.add_argument('--public-host',default='mcp.example.com');p.add_argument('--port',default='8865');p.add_argument('--apply',action='store_true');a=p.parse_args()
    root=Path(a.root);current=(root/'current').resolve().name
    sha=fetch('commits/main').get('sha','')
    if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('invalid source SHA')
    if current==sha:return
    if not verified(fetch('actions/workflows/check.yml/runs?head_sha='+sha+'&per_page=10'),sha):return
    if not a.apply:print(json.dumps({'status':'update_available','sha':sha}));return
    installer=Path('/usr/local/lib/vk-mcp/install.py')
    for path in (installer.parent,installer):
        info=path.lstat()
        if path.is_symlink() or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('static installer ownership mismatch')
    result=subprocess.run([sys.executable,str(installer),'--sha',sha,'--root',a.root,'--config-dir',a.config_dir,'--state-dir',a.state_dir,'--public-host',a.public_host,'--port',a.port,'--apply'],capture_output=True,text=True)
    if result.returncode:raise ValueError('verified update failed; inspect release state')
    print(json.dumps({'event':'updated','sha':sha}))
if __name__=='__main__':
    try:main()
    except Exception:print('VK update check/release failed; existing runtime retained where possible',file=sys.stderr);sys.exit(1)
