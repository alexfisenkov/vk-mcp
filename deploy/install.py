#!/usr/bin/env python3
"""Install/update an exact public Git commit. Root required; credentials never printed."""
import argparse,json,os,pwd,re,secrets,shutil,subprocess,sys,time,urllib.request
from pathlib import Path

def run(*args,**kwargs):
    result=subprocess.run(args,capture_output=True,text=True,**kwargs)
    if result.returncode: raise RuntimeError('command failed (details suppressed)')
    return result.stdout.strip()

def atomic(path,data,mode=0o644,gid=0):
    temp=path.with_name(path.name+'.new-'+secrets.token_hex(4))
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
    with os.fdopen(fd,'w') as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.chown(temp,0,gid);os.chmod(temp,mode);os.replace(temp,path)

def link(path,target):
    temp=path.with_name(path.name+'.new-'+secrets.token_hex(4));temp.symlink_to(target);os.replace(temp,path)

def health(configdir):
    token=(configdir/'http-token').read_text().strip()
    config=json.loads((configdir/'config.json').read_text())
    req=urllib.request.Request(f"http://127.0.0.1:{config['port']}/health",headers={'Authorization':'Bearer '+token})
    for attempt in range(30):
        try:
            with urllib.request.urlopen(req,timeout=2) as response:
                value=json.load(response)
                if value.get('status')=='ok':return value
        except Exception:time.sleep(0.4)
    raise RuntimeError('authenticated health check failed')

def activate(root,release,configdir):
    link(root/'current',release)
    shutil.copyfile(release/'mcp-vk.service','/etc/systemd/system/mcp-vk.service')
    run('systemctl','daemon-reload');run('systemctl','enable','--now','mcp-vk.service');run('systemctl','restart','mcp-vk.service')
    value=health(configdir)
    if value['release']!=release.name:raise RuntimeError('release health mismatch')
    return value

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',default='https://github.com/alexfisenkov/vk-mcp.git')
    p.add_argument('--sha');p.add_argument('--root',default='/srv/vk-mcp');p.add_argument('--config-dir',default='/etc/vk-mcp');p.add_argument('--state-dir',default='/var/lib/vk-mcp');p.add_argument('--public-host',default='mcp.example.com');p.add_argument('--port',type=int,default=8865);p.add_argument('--apply',action='store_true');p.add_argument('--rollback',action='store_true');p.add_argument('--auto-update',action='store_true')
    a=p.parse_args()
    if a.repo!='https://github.com/alexfisenkov/vk-mcp.git':raise ValueError('repository URL rejected')
    if not a.rollback and not re.fullmatch('[a-f0-9]{40}',a.sha or ''):raise ValueError('full Git SHA required')
    for path in (a.root,a.config_dir,a.state_dir):
        if not Path(path).is_absolute() or any(c.isspace() for c in path) or any(x in path for x in ('..','%','\n')):raise ValueError('absolute paths without whitespace required')
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9.-]*',a.public_host) or not 1024<=a.port<=65535:raise ValueError('listener settings rejected')
    print(json.dumps({'mode':'apply' if a.apply else 'dry-run','operation':'rollback' if a.rollback else 'release','sha':a.sha,'writes_enabled':False}))
    if not a.apply:return
    if os.geteuid()!=0:raise ValueError('root required')
    root=Path(a.root);configdir=Path(a.config_dir);state=Path(a.state_dir)
    for username,home in [('mcp-vk',state),('mcp-vk-build',Path('/nonexistent'))]:
        try:identity=pwd.getpwnam(username)
        except KeyError:
            run('useradd','--system','--user-group','--no-create-home','--home-dir',str(home),'--shell','/usr/sbin/nologin',username);identity=pwd.getpwnam(username)
        if identity.pw_dir!=str(home) or identity.pw_shell!='/usr/sbin/nologin' or os.getgrouplist(username,identity.pw_gid)!=[identity.pw_gid]:raise ValueError('service identity drift')
    service=pwd.getpwnam('mcp-vk');builder=pwd.getpwnam('mcp-vk-build')
    for path in (root,root/'releases',configdir):
        path.mkdir(parents=True,exist_ok=True)
        for parent in [*reversed(path.parents),path]:
            info=parent.lstat()
            if not parent.is_dir() or parent.is_symlink() or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('deployment parent not root-controlled')
    previous=(root/'current').resolve() if (root/'current').is_symlink() else None
    unit_path=Path('/etc/systemd/system/mcp-vk.service')
    if previous:
        if previous.parent!=root/'releases' or not (previous/'mcp-vk.service').is_file():raise ValueError('current release ownership is unproven')
        if not unit_path.is_file() or unit_path.is_symlink() or unit_path.read_bytes()!=(previous/'mcp-vk.service').read_bytes():raise ValueError('existing unit drift')
    elif unit_path.exists() or unit_path.is_symlink() or (configdir/'config.json').exists() or (configdir/'http-token').exists():
        raise ValueError('first install refuses existing unit or credentials')
    if a.rollback:
        release=(root/'previous').resolve()
        if release.parent!=root/'releases' or not (release/'mcp-vk.service').is_file():raise ValueError('rollback artifact unavailable')
        try:value=activate(root,release,configdir)
        except Exception:
            if previous:activate(root,previous,configdir)
            raise
        if previous:link(root/'previous',previous)
        print(json.dumps(value));return
    release=root/'releases'/a.sha
    if release.exists():raise ValueError('release exists; inspect before retry')
    build=root/('.build-'+a.sha+'-'+secrets.token_hex(4));build.mkdir(mode=0o755);os.chown(build,builder.pw_uid,builder.pw_gid)
    # The builder cannot read runtime secrets and has no supplementary groups.
    prefix=('systemd-run','--quiet','--wait','--pipe','--collect','--property=User=mcp-vk-build','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=ReadWritePaths='+str(build),'--property=WorkingDirectory='+str(build/'source'),'--property=KillMode=control-group','--setenv=HOME='+str(build),'--setenv=npm_config_cache='+str(build/'.npm'),'--')
    run('runuser','-u','mcp-vk-build','--','git','clone','--no-checkout',a.repo,str(build/'source'))
    source=build/'source'
    run('runuser','-u','mcp-vk-build','--','git','-C',str(source),'checkout','--detach',a.sha)
    if run('git','-c','safe.directory='+str(source),'-C',str(source),'rev-parse','HEAD')!=a.sha:raise ValueError('source SHA mismatch')
    run(*prefix,'npm','ci','--ignore-scripts','--no-audit','--no-fund',cwd=source)
    run(*prefix,'npm','run','check',cwd=source)
    run(*prefix,'npm','prune','--omit=dev','--ignore-scripts','--no-audit','--no-fund',cwd=source)
    if source.is_symlink() or not source.is_dir():raise ValueError('build source replaced')
    for parent,dirs,files in os.walk(source,followlinks=False):
        for name in dirs+files:
            path=Path(parent)/name
            if path.is_symlink() and not path.resolve().is_relative_to(source):raise ValueError('build symlink escapes source')
    shutil.rmtree(source/'.git');os.rename(source,release)
    for path,dirs,files in os.walk(release):
        os.chown(path,0,0);os.chmod(path,0o755)
        for name in files:
            target=Path(path)/name
            if not target.is_symlink():os.chown(target,0,0);os.chmod(target,0o755 if os.access(target,os.X_OK) else 0o644)
    if not (configdir/'http-token').exists():atomic(configdir/'http-token',secrets.token_urlsafe(64)+'\n',0o640,service.pw_gid)
    if not (configdir/'config.json').exists():atomic(configdir/'config.json',json.dumps({'communities':[],'tokens':{},'writesEnabled':False,'approvalDir':str(configdir/'approvals'),'stateDir':str(state),'port':a.port,'allowedHosts':['127.0.0.1',a.public_host],'allowedOrigins':[]},indent=2)+'\n',0o640,service.pw_gid)
    if not (configdir/'approvals').exists():
        (configdir/'approvals').mkdir(mode=0o750);os.chown(configdir/'approvals',0,service.pw_gid)
    if not state.exists():state.mkdir(mode=0o700);os.chown(state,service.pw_uid,service.pw_gid)
    unit=f'''[Unit]
Description=VK community MCP
After=network-online.target
[Service]
User=mcp-vk
Group=mcp-vk
WorkingDirectory={release}
Environment=NODE_ENV=production
Environment=VK_MCP_CONFIG={configdir}/config.json
Environment=VK_MCP_HTTP_TOKEN_FILE={configdir}/http-token
Environment=VK_MCP_RELEASE={a.sha}
ExecStart=/usr/bin/node {release}/dist/index.js
Restart=on-failure
RestartSec=5
UMask=0077
MemoryMax=256M
CPUQuota=50%
TasksMax=64
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths={state}
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
[Install]
WantedBy=multi-user.target
'''
    atomic(release/'mcp-vk.service',unit)
    try:value=activate(root,release,configdir)
    except Exception:
        if previous:activate(root,previous,configdir)
        else:run('systemctl','stop','mcp-vk.service')
        raise
    if previous:link(root/'previous',previous)
    atomic(root/'release.json',json.dumps({'sha':a.sha,'previous':previous.name if previous else None,'health':value},indent=2)+'\n')
    shutil.rmtree(build)
    if a.auto_update:
        library=Path('/usr/local/lib/vk-mcp');library.mkdir(mode=0o755,exist_ok=True)
        if library.is_symlink() or library.stat().st_uid!=0 or library.stat().st_mode&0o022:raise ValueError('updater library ownership')
        for name in ('install.py','update.py'):
            dest=library/name
            if not dest.exists():atomic(dest,(release/'deploy'/name).read_text())
            elif dest.is_symlink() or dest.stat().st_uid!=0 or dest.stat().st_mode&0o022:raise ValueError('updater source ownership')
        atomic(Path('/etc/systemd/system/mcp-vk-update.service'),f'''[Unit]
Description=Update VK MCP from verified GitHub commit
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/lib/vk-mcp/update.py --root {root} --config-dir {configdir} --state-dir {state} --public-host {a.public_host} --port {a.port} --apply
UMask=0077
TimeoutStartSec=600
''')
        atomic(Path('/etc/systemd/system/mcp-vk-update.timer'),'''[Unit]
Description=Check verified VK MCP updates
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
RandomizedDelaySec=20
Persistent=true
[Install]
WantedBy=timers.target
''')
        run('systemctl','daemon-reload');run('systemctl','enable','--now','mcp-vk-update.timer')
    print(json.dumps(value))
if __name__=='__main__':
    try:main()
    except Exception:
        print('VK release failed; inspect state before retry; sensitive details suppressed',file=sys.stderr);sys.exit(1)
