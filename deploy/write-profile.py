#!/usr/bin/env python3
"""Change only the VK write profile on a trusted Linux deployment.

Defaults to a read-only dry run. --apply explicitly authorizes the local profile
change, not a VK operation. Every write still needs its exact one-use plan and
independent root-owned approval receipt. Disable writes before using configure.py
to onboard additional credentials. No token arguments are supported.
"""
import argparse
import copy
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import subprocess
import sys
import time
import urllib.request

SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError('Unsupported arguments; never pass credentials')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Redirect rejected')


def installation_path(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid absolute installation path')
    return path


def protected_directory(path):
    for parent in [*reversed(path.parents), path]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Directory is not root-controlled')


def read_protected(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o027 or info.st_size > 65536:
            raise ValueError('Invalid protected file')
        raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError('Protected file exceeds limit')
        return raw


def candidate(before, mode):
    if mode not in ('read-only', 'write') or not isinstance(before, dict) or type(before.get('writesEnabled')) is not bool:
        raise ValueError('Invalid profile or configuration')
    if mode == 'write':
        communities = before.get('communities')
        tokens = before.get('tokens')
        if not isinstance(communities, list) or not communities or not isinstance(tokens, dict):
            raise ValueError('Configured communities and write credentials required')
        group = tokens.get('group', {})
        has_group = isinstance(group, dict) and any(group.get(str(identifier)) for identifier in communities)
        if not has_group and not tokens.get('user'):
            raise ValueError('Group or user write credential required; service key is read-only')
        if not isinstance(before.get('approvalDir'), str) or not before['approvalDir']:
            raise ValueError('Independent approval directory required')
    updated = copy.deepcopy(before)
    updated['writesEnabled'] = mode == 'write'
    return updated


def encode_configuration(config):
    raw = (json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode()
    if len(raw) > 65536:
        raise ValueError('Updated protected configuration exceeds limit')
    return raw


def installed_module(root):
    protected_directory(root)
    current = root / 'current'
    info = current.lstat()
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
        raise ValueError('Trusted current release link required')
    release = current.resolve(strict=True)
    if release.parent != root / 'releases' or not re.fullmatch('[a-f0-9]{40}', release.name):
        raise ValueError('Current release is outside trusted release directory')
    module = release / 'dist/server/config.js'
    protected_directory(module.parent)
    info = module.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('Installed parser is not root-controlled')
    return module


def run(*args, input=None):
    result = subprocess.run(args, input=input, capture_output=True, env=SAFE_ENV, cwd='/', timeout=45)
    if result.returncode:
        raise ValueError('Service validation or restart failed; diagnostics suppressed')


def validate_installed(module, updated):
    # Secret JSON travels on stdin, never argv, environment or diagnostics.
    script = ('import{parseSettings}from ' + json.dumps(module.as_uri()) + ';'
              'import{readFileSync,accessSync,constants}from "node:fs";'
              'try{const c=parseSettings(JSON.parse(readFileSync(0,"utf8")));'
              'if(c.writesEnabled)accessSync(c.approvalDir,constants.R_OK|constants.X_OK)}catch{process.exit(1)}')
    run('runuser', '-u', 'mcp-vk', '--', '/usr/bin/node', '--input-type=module', '-e', script,
        input=json.dumps(updated, ensure_ascii=False).encode())


def write_new(path, raw, gid, mode=0o640):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchown(stream.fileno(), 0, gid)
            os.fchmod(stream.fileno(), mode)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def local_json(path, port, bearer, body=None):
    headers = {'Authorization': 'Bearer ' + bearer}
    data = None
    if body is not None:
        headers.update({'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
                        'MCP-Protocol-Version': '2025-03-26'})
        data = json.dumps(body).encode()
    request = urllib.request.Request(f'http://127.0.0.1:{port}/{path}', data=data, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=2) as response:
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError('Readiness response exceeds limit')
        return json.loads(raw)


def health(config_dir, config):
    bearer = read_protected(config_dir / 'http-token').decode('ascii').strip()
    body = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'vk_capabilities', 'arguments': {}}}
    for attempt in range(20):
        try:
            ready = local_json('health', config.get('port', 8865), bearer)
            result = local_json('mcp', config.get('port', 8865), bearer, body).get('result', {})
            profile = result.get('structuredContent', {})
            if ready.get('status') == 'ok' and not result.get('isError') and profile.get('status') == 'ok' and profile.get('writesEnabled') is config['writesEnabled'] and profile.get('ownerApprovalRequired') is True:
                return
        except Exception:
            pass
        time.sleep(.3)
    raise ValueError('Authenticated running profile check failed')


def activate_configuration(staged, config_path, recovery, before, updated, config_dir):
    if read_protected(recovery) != before:
        raise ValueError('Prepared recovery copy mismatch')
    if read_protected(config_path) != before:
        raise ValueError('Configuration changed; refusing overwrite')
    try:
        os.replace(staged, config_path)
        sync_directory(config_dir)
        run('systemctl', 'restart', 'mcp-vk.service')
        health(config_dir, updated)
        if read_protected(config_path) != encode_configuration(updated):
            raise ValueError('Configuration read-back mismatch')
    except BaseException:
        # Recovery was fully persisted before replace. Do not allocate a new
        # secret-bearing file during rollback and never retry a VK operation.
        try:
            os.replace(recovery, config_path)
            sync_directory(config_dir)
            run('systemctl', 'restart', 'mcp-vk.service')
            health(config_dir, json.loads(before))
            if read_protected(config_path) != before:
                raise ValueError('Restored configuration mismatch')
        except BaseException:
            raise ValueError('Profile failed; rollback incomplete; inspect before retry') from None
        raise ValueError('Profile failed; previous configuration restored and verified') from None


def main():
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument('--root', type=installation_path, default=Path('/srv/vk-mcp'))
    parser.add_argument('--config-dir', type=installation_path, default=Path('/etc/vk-mcp'))
    parser.add_argument('--mode', choices=('read-only', 'write'), required=True)
    parser.add_argument('--apply', action='store_true', help='Apply the profile only; VK operations still require exact approvals')
    options = parser.parse_args()
    if not sys.platform.startswith('linux') or os.geteuid() != 0:
        raise ValueError('Linux root operator required')
    config_dir = options.config_dir
    protected_directory(config_dir)
    module = installed_module(options.root)
    identity = pwd.getpwnam('mcp-vk')
    # Cooperating configuration writers must all use this existing shared lock.
    # An unrelated root process ignoring the lock cannot be made atomic by flock.
    lock_fd = os.open(config_dir / 'onboard.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('Invalid operator lock')
        fcntl.flock(lock, fcntl.LOCK_EX)
        config_path = config_dir / 'config.json'
        before = read_protected(config_path)
        config = json.loads(before)
        updated = candidate(config, options.mode)
        serialized = encode_configuration(updated)
        if updated.get('approvalDir') is not None:
            protected_directory(installation_path(updated['approvalDir']))
        validate_installed(module, updated)
        changed = config['writesEnabled'] != updated['writesEnabled']
        if not options.apply:
            print(json.dumps({'status': 'validated', 'mode': 'dry-run', 'changed': changed,
                              'writes_enabled': updated['writesEnabled'], 'owner_approval_required': True}))
            return
        if not changed:
            health(config_dir, updated)
            print(json.dumps({'status': 'already_configured', 'writes_enabled': updated['writesEnabled'], 'owner_approval_required': True}))
            return
        backups = config_dir / 'backups'
        if not backups.exists():
            backups.mkdir(mode=0o700)
        protected_directory(backups)
        if stat.S_IMODE(backups.lstat().st_mode) != 0o700:
            raise ValueError('Backup directory requires mode 0700')
        staged = config_dir / ('.profile-' + secrets.token_hex(8) + '.json')
        recovery = config_dir / ('.restore-profile-' + secrets.token_hex(8) + '.json')
        try:
            write_new(backups / ('before-profile-' + secrets.token_hex(8) + '.json'), before, 0, 0o600)
            sync_directory(backups)
            write_new(recovery, before, identity.pw_gid)
            write_new(staged, serialized, identity.pw_gid)
            sync_directory(config_dir)
            activate_configuration(staged, config_path, recovery, before, updated, config_dir)
            print(json.dumps({'status': 'stored_profile_read_verified', 'writes_enabled': updated['writesEnabled'], 'owner_approval_required': True}))
        finally:
            staged.unlink(missing_ok=True)
            recovery.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('Profile interrupted; inspect running configuration before retry; credentials suppressed', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Profile change stopped; inspect configuration, protected backups and service before retry; credentials suppressed', file=sys.stderr)
        sys.exit(1)
