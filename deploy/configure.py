#!/usr/bin/env python3
"""Linux/VPS owner-terminal onboarding. Hidden token input; no credential arguments."""
import argparse,copy,fcntl,getpass,hashlib,json,os,pwd,re,secrets,stat,subprocess,sys,time,urllib.request,urllib.parse,warnings
from pathlib import Path
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('VK redirect rejected')

CONFIG=Path('/etc/vk-mcp/config.json')
HTTP_CREDENTIAL_PATH=Path('/etc/vk-mcp/http-token')
ROOT=Path('/srv/vk-mcp')

def community_id(value):
 if not re.fullmatch('[1-9][0-9]*',value) or int(value)>9007199254740991:raise ValueError('Invalid numeric community ID')
 return int(value)

def candidate(before,group,token):
 if not isinstance(token,str) or not 1<=len(token)<=8192 or any(c.isspace() for c in token):raise ValueError('Invalid token format')
 if before.get('writesEnabled') is not False:raise ValueError('Onboarding requires read-only mode')
 result=copy.deepcopy(before);groups=result.setdefault('tokens',{}).setdefault('group',{})
 if str(group) in groups:raise ValueError('Existing credential is not replaced; ask the operator')
 result.setdefault('communities',[])
 if group not in result['communities']:result['communities'].append(group)
 groups[str(group)]=token
 return result

def service_candidate(before,key):
 if not isinstance(key,str) or not 1<=len(key)<=8192 or any(c.isspace() for c in key):raise ValueError('Invalid key format')
 if before.get('writesEnabled') is not False or not before.get('communities'):raise ValueError('Read-only configured community required')
 result=copy.deepcopy(before);tokens=result.setdefault('tokens',{})
 if tokens.get('service'):raise ValueError('Existing service credential is not replaced')
 tokens['service']=key
 return result

def confirm_target(result,group):
 if 'error' in result:raise ValueError('VK rejected the credential; no configuration changed')
 data=result.get('response');items=data.get('groups') if isinstance(data,dict) else data
 if not isinstance(items,list) or len(items)!=1 or not isinstance(items[0],dict) or items[0].get('id')!=group:raise ValueError('VK target metadata mismatch')
 return group

def vk_read(method,token,params):
 if method not in ('groups.getById','groups.getTokenPermissions','wall.get'):raise ValueError('Unsupported verification method')
 body=urllib.parse.urlencode({'access_token':token,'v':'5.199',**params}).encode()
 req=urllib.request.Request('https://api.vk.com/method/'+method,data=body,method='POST')
 with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as response:
  raw=response.read(1048577)
  if len(raw)>1048576:raise ValueError('VK response exceeds limit')
  return json.loads(raw)

def verify_community_token(token,group,request=vk_read):
 permissions=request('groups.getTokenPermissions',token,{})
 data=permissions.get('response')
 if 'error' in permissions or not isinstance(data,dict) or type(data.get('mask')) is not int:raise ValueError('Group token verification failed')
 # No group_id is sent: only identity inferred by VK from this credential can pass.
 confirm_target(request('groups.getById',token,{}),group)
 return group

def verification_group(config,requested=None):
 groups=[community_id(str(value)) for value in config.get('communities',[])]
 if not groups:raise ValueError('Connect a community first')
 selected=groups[0] if requested is None else community_id(str(requested))
 if selected not in groups:raise ValueError('Verification target is not allowlisted')
 return selected

def verify_service_key(key,group,request=vk_read):
 result=request('wall.get',key,{'owner_id':-group,'count':1})
 data=result.get('response')
 if 'error' in result or not isinstance(data,dict) or not isinstance(data.get('items'),list):raise ValueError('Wall read with service key failed')
 return group

def read_protected(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o027 or s.st_size>65536:raise ValueError('Protected file ownership/permissions invalid')
  return f.read(65537)

def write_new(path,raw,gid,mode=0o640):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  with os.fdopen(fd,'wb') as f:
   os.fchown(f.fileno(),0,gid);os.fchmod(f.fileno(),mode);f.write(raw);f.flush();os.fsync(f.fileno())
 except BaseException:
  path.unlink(missing_ok=True);raise

def run(*args):
 if subprocess.run(args,capture_output=True).returncode:raise ValueError('Service validation/restart failed')

def health(port):
 auth=read_protected(HTTP_CREDENTIAL_PATH).decode('ascii').strip()
 req=urllib.request.Request(f'http://127.0.0.1:{port}/health',headers={'Authorization':'Bearer '+auth})
 for _ in range(20):
  try:
   with urllib.request.urlopen(req,timeout=2) as r:
    h=json.load(r)
    if h.get('status')=='ok' and h.get('vk')=='configured':return
  except Exception:pass
  time.sleep(.3)
 raise ValueError('Configured readiness check failed')

def activate_configuration(staged,config,recovery,port):
 if recovery.is_symlink() or not recovery.is_file():raise ValueError('Prepared recovery file required')
 os.replace(staged,config)
 try:
  run('systemctl','restart','mcp-vk.service');health(port)
 except Exception:
  os.replace(recovery,config);run('systemctl','restart','mcp-vk.service');raise ValueError('Readiness failed; previous configuration restored')

class SafeArgumentParser(argparse.ArgumentParser):
 def error(self,message):raise ValueError('Unsupported arguments; credentials must be entered interactively')

def main():
 global CONFIG,HTTP_CREDENTIAL_PATH,ROOT
 parser=SafeArgumentParser(description=__doc__)
 parser.add_argument('--service',action='store_true')
 parser.add_argument('--community-id',type=community_id,help='Existing allowlisted community for service-key wall verification')
 parser.add_argument('--root',type=Path,default=Path('/srv/vk-mcp'))
 parser.add_argument('--config-dir',type=Path,default=Path('/etc/vk-mcp'))
 options=parser.parse_args()
 for path in (options.root,options.config_dir):
  if not path.is_absolute() or any(c.isspace() for c in str(path)) or '..' in path.parts:raise ValueError('Invalid installation path')
 if options.community_id is not None and not options.service:raise ValueError('Community selection is only for service-key verification')
 ROOT=options.root;CONFIG=options.config_dir/'config.json';HTTP_CREDENTIAL_PATH=options.config_dir/'http-token'
 if os.geteuid()!=0 or not sys.stdin.isatty() or not sys.stderr.isatty():raise ValueError('Run from an interactive SSH terminal as root; input will not be echoed')
 service_mode=options.service
 parent=CONFIG.parent;identity=pwd.getpwnam('mcp-vk')
 for path in [*reversed(parent.parents),parent]:
  s=path.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('Configuration parent is not root-controlled')
 lockfd=os.open(parent/'onboard.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 with os.fdopen(lockfd,'w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  before=read_protected(CONFIG);config=json.loads(before)
  warnings.simplefilter('error',getpass.GetPassWarning)
  if service_mode:
   group=verification_group(config,options.community_id)
   print('Проверка сервисного ключа чтением стены сообщества '+str(group)+'. Ввод скрыт.')
   entered=getpass.getpass('Сервисный ключ приложения VK: ')
   updated=service_candidate(config,entered);verify_service_key(entered,group)
  else:
   group=community_id(input('Числовой ID сообщества VK (без минуса): ').strip())
   print('Вставьте токен именно этого сообщества. Ввод скрыт и не попадёт в историю команд.')
   entered=getpass.getpass('Токен сообщества: ')
   updated=candidate(config,group,entered);verify_community_token(entered,group)
  staged=parent/('.onboard-'+secrets.token_hex(8)+'.json');recovery=parent/('.restore-'+secrets.token_hex(8)+'.json');gid=identity.pw_gid
  try:
   write_new(staged,(json.dumps(updated,ensure_ascii=False,indent=2)+'\n').encode(),gid)
   module=(ROOT/'current/dist/server/config.js').as_uri()
   script='import{parseSettings,readProtectedFile}from '+json.dumps(module)+';try{parseSettings(JSON.parse(readProtectedFile(process.argv[1])))}catch{process.exit(1)}'
   run('runuser','-u','mcp-vk','--','node','--input-type=module','-e',script,str(staged))
   backups=parent/'backups'
   if not backups.exists():backups.mkdir(mode=0o700)
   info=backups.lstat()
   if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700:raise ValueError('Invalid backup directory')
   backup=backups/('before-onboard-'+secrets.token_hex(8)+'.json');write_new(backup,before,0,0o600)
   write_new(recovery,before,gid)
   if read_protected(CONFIG)!=before:raise ValueError('Configuration changed; no overwrite')
   activate_configuration(staged,CONFIG,recovery,updated['port'])
   if service_mode:
    print(json.dumps({'status':'stored_wall_read_verified','credential_kind':'service','community_id':group,'writes_enabled':False}))
   else:print(json.dumps({'status':'stored_metadata_read_verified','community_id':group,'writes_enabled':False,'token_owner_independently_verified':True,'next':'Run per-capability read-only acceptance; token must originate from this community'},ensure_ascii=False))
  finally:
   staged.unlink(missing_ok=True);recovery.unlink(missing_ok=True)

if __name__=='__main__':
 try:main()
 except (KeyboardInterrupt,EOFError):print('Отменено. При прерывании после сохранения проверьте конфигурацию перед повтором.',file=sys.stderr);sys.exit(1)
 except Exception:print('Подключение остановлено. Токен не выводится. Проверьте ID/ключ/права; при частичном исходе сначала read-back, без повторной выдачи ключа.',file=sys.stderr);sys.exit(1)
