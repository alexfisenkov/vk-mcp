#!/usr/bin/env python3
"""Import an existing VK API user access token from a protected Linux root TTY.

This helper does not issue tokens or implement VK user-token renewal. It verifies
the legacy permission bitmask and read-only evidence before storing a static
access token. Its lifetime remains subject to VK. The existing write profile,
community allowlist, other credentials and per-operation approvals are preserved.
Never pass a token as an argument, environment value or chat message.
"""
import argparse
import copy
import fcntl
import getpass
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import sys
import time
import urllib.parse
import urllib.request
import warnings

# Official legacy constants, pinned primary source:
# https://github.com/VKCOM/vk-php-sdk/blob/0b01a07b167549d08a3d910201cec9e8a202a0ee/src/VK/OAuth/Scopes/VKOAuthUserScope.php
# These names/masks do not prove an application can obtain these permissions.
REQUIRED_SCOPES = {'photos': 4, 'video': 16, 'wall': 8192, 'docs': 131072, 'groups': 262144, 'stats': 1048576, 'market': 134217728}
STAGES = {'arguments', 'operator', 'filesystem', 'configuration', 'identity', 'permissions', 'administration', 'wall', 'validation', 'persistence', 'readiness', 'interrupted'}
OUTCOMES = {'previous_configuration_restored', 'rollback_incomplete'}
NEXT_CALL = 0.0
CURRENT_STAGE = 'arguments'


class ImportFailure(ValueError):
    def __init__(self, stage, *, code=None, missing=(), outcome=None):
        super().__init__('User credential import stopped')
        self.stage = stage if stage in STAGES else 'operator'
        self.code = code if type(code) is int and 0 <= code <= 1000000000 else None
        self.missing = [name for name in REQUIRED_SCOPES if name in missing]
        self.outcome = outcome if outcome in OUTCOMES else None

    def report(self):
        result = {'status': 'stopped', 'stage': self.stage, 'credentials_suppressed': True}
        if self.code is not None:
            result['vk_code'] = self.code
        if self.missing:
            result['missing_scopes'] = self.missing
        if self.outcome:
            result['outcome'] = self.outcome
        return result


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ImportFailure('arguments')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ImportFailure('validation')


def numeric_id(value):
    if not isinstance(value, str) or not re.fullmatch('[1-9][0-9]*', value) or int(value) > 9007199254740991:
        raise ImportFailure('arguments')
    return int(value)


def load_profile():
    # Import root-executed Python only from a verified deployment directory,
    # never from a working directory or user-selected module search path.
    # The documented entrypoint uses current/deploy. Resolve that entrypoint to
    # its immutable target, then prove every target ancestor and sibling file.
    source = Path(__file__).resolve(strict=True).parent / 'write-profile.py'
    for parent in [*reversed(source.parent.parents), source.parent]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ImportFailure('filesystem')
    info = source.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ImportFailure('filesystem')
    spec = importlib.util.spec_from_file_location('vk_operator_write_profile', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def candidate(before, token):
    if not isinstance(before, dict) or type(before.get('writesEnabled')) is not bool:
        raise ImportFailure('configuration')
    communities = before.get('communities')
    if not isinstance(communities, list) or not communities or len(communities) > 100 or any(type(c) is not int or not 0 < c <= 9007199254740991 for c in communities) or len(set(communities)) != len(communities):
        raise ImportFailure('configuration')
    tokens = before.get('tokens')
    if not isinstance(tokens, dict) or 'user' in tokens:
        raise ImportFailure('configuration')
    if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(c.isspace() for c in token):
        raise ImportFailure('configuration')
    result = copy.deepcopy(before)
    result['tokens']['user'] = token
    return result


def vk_read(method, token, params):
    global NEXT_CALL
    if (method in ('users.get', 'account.getAppPermissions') and params == {}):
        pass
    elif method == 'groups.getById' and set(params) == {'group_id', 'fields'} and type(params['group_id']) is int and params['group_id'] > 0 and params['fields'] == 'is_admin,admin_level':
        pass
    elif method == 'wall.get' and set(params) == {'owner_id', 'count'} and type(params['owner_id']) is int and params['owner_id'] < 0 and type(params['count']) is int and params['count'] == 1:
        pass
    else:
        raise ImportFailure('validation')
    time.sleep(max(0, NEXT_CALL - time.monotonic()))
    NEXT_CALL = time.monotonic() + .35
    body = urllib.parse.urlencode({'access_token': token, 'v': '5.199', **params}).encode()
    request = urllib.request.Request('https://api.vk.com/method/' + method, data=body, method='POST')
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ImportFailure('validation')
        return json.loads(raw)


def checked_read(request, method, token, params, stage):
    try:
        result = request(method, token, params)
    except Exception:
        raise ImportFailure(stage) from None
    if not isinstance(result, dict) or 'error' in result or 'response' not in result:
        error = result.get('error') if isinstance(result, dict) else None
        code = error.get('error_code') if isinstance(error, dict) else None
        raise ImportFailure(stage, code=code)
    return result['response']


def verify_permissions(response):
    if type(response) is not int or not 0 <= response <= 9007199254740991:
        raise ImportFailure('permissions')
    missing = [name for name, bit in REQUIRED_SCOPES.items() if response & bit != bit]
    if missing:
        raise ImportFailure('permissions', missing=missing)


def verify_token(token, expected_user_id, communities, request=vk_read):
    identity = checked_read(request, 'users.get', token, {}, 'identity')
    if not isinstance(identity, list) or len(identity) != 1 or not isinstance(identity[0], dict) or type(identity[0].get('id')) is not int or identity[0]['id'] != expected_user_id or identity[0].get('deactivated'):
        raise ImportFailure('identity')
    verify_permissions(checked_read(request, 'account.getAppPermissions', token, {}, 'permissions'))
    for community in communities:
        data = checked_read(request, 'groups.getById', token, {'group_id': community, 'fields': 'is_admin,admin_level'}, 'administration')
        groups = data.get('groups') if isinstance(data, dict) else data
        if not isinstance(groups, list) or len(groups) != 1 or not isinstance(groups[0], dict):
            raise ImportFailure('administration')
        group = groups[0]
        is_admin = group.get('is_admin')
        if type(group.get('id')) is not int or group['id'] != community or not (is_admin is True or type(is_admin) is int and is_admin == 1) or type(group.get('admin_level')) is not int or group['admin_level'] != 3:
            raise ImportFailure('administration')
        wall = checked_read(request, 'wall.get', token, {'owner_id': -community, 'count': 1}, 'wall')
        if not isinstance(wall, dict) or not isinstance(wall.get('items'), list):
            raise ImportFailure('wall')


def health(profile, config_dir, config):
    profile.health(config_dir, config)
    bearer = profile.read_protected(config_dir / 'http-token').decode('ascii').strip()
    body = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'vk_status', 'arguments': {}}}
    expected_user = bool(config.get('tokens', {}).get('user'))
    for attempt in range(20):
        try:
            result = profile.local_json('mcp', config.get('port', 8865), bearer, body).get('result', {})
            ready = result.get('structuredContent', {})
            if not result.get('isError') and ready.get('status') == 'configured' and ready.get('tokenTypes', {}).get('user') is expected_user and ready.get('writesEnabled') is config['writesEnabled']:
                return
        except Exception:
            pass
        time.sleep(.3)
    raise ImportFailure('readiness')


def activate_configuration(profile, staged, config_path, recovery, before, updated, config_dir):
    if profile.read_protected(recovery) != before or profile.read_protected(config_path) != before:
        raise ImportFailure('persistence')
    try:
        os.replace(staged, config_path)
        profile.sync_directory(config_dir)
        profile.run('systemctl', 'restart', 'mcp-vk.service')
        health(profile, config_dir, updated)
        if profile.read_protected(config_path) != profile.encode_configuration(updated):
            raise ImportFailure('readiness')
    except BaseException:
        try:
            os.replace(recovery, config_path)
            profile.sync_directory(config_dir)
            profile.run('systemctl', 'restart', 'mcp-vk.service')
            health(profile, config_dir, json.loads(before))
            if profile.read_protected(config_path) != before:
                raise ImportFailure('readiness')
        except BaseException:
            raise ImportFailure('readiness', outcome='rollback_incomplete') from None
        raise ImportFailure('readiness', outcome='previous_configuration_restored') from None


def main():
    global CURRENT_STAGE
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/srv/vk-mcp'))
    parser.add_argument('--config-dir', type=Path, default=Path('/etc/vk-mcp'))
    parser.add_argument('--expected-user-id', type=numeric_id, required=True, help='Numeric owner ID obtained independently; never inferred from the entered token')
    options = parser.parse_args()
    CURRENT_STAGE = 'operator'
    if not sys.platform.startswith('linux') or os.geteuid() != 0 or not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ImportFailure('operator')
    CURRENT_STAGE = 'filesystem'
    profile = load_profile()
    config_dir = profile.installation_path(str(options.config_dir))
    root = profile.installation_path(str(options.root))
    profile.protected_directory(config_dir)
    module = profile.installed_module(root)
    identity = pwd.getpwnam('mcp-vk')
    lock_fd = os.open(config_dir / 'onboard.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ImportFailure('filesystem')
        fcntl.flock(lock, fcntl.LOCK_EX)
        config_path = config_dir / 'config.json'
        CURRENT_STAGE = 'configuration'
        before = profile.read_protected(config_path)
        config = json.loads(before)
        # Refuse rotation or malformed local scope before asking for any token.
        candidate(config, 'synthetic-preflight')
        if config.get('approvalDir') is not None:
            profile.protected_directory(profile.installation_path(config['approvalDir']))
        warnings.simplefilter('error', getpass.GetPassWarning)
        print('Проверка токена пользователя VK: личность, права и доступ к настроенным сообществам. Только чтение; ввод скрыт.')
        entered = getpass.getpass('Токен пользователя VK API: ')
        updated = candidate(config, entered)
        serialized = profile.encode_configuration(updated)
        CURRENT_STAGE = 'validation'
        profile.validate_installed(module, updated)
        verify_token(entered, options.expected_user_id, updated['communities'])
        CURRENT_STAGE = 'persistence'
        backups = config_dir / 'backups'
        if not backups.exists():
            backups.mkdir(mode=0o700)
        profile.protected_directory(backups)
        if stat.S_IMODE(backups.lstat().st_mode) != 0o700:
            raise ImportFailure('filesystem')
        staged = config_dir / ('.user-' + secrets.token_hex(8) + '.json')
        recovery = config_dir / ('.restore-user-' + secrets.token_hex(8) + '.json')
        try:
            profile.write_new(backups / ('before-user-' + secrets.token_hex(8) + '.json'), before, 0, 0o600)
            profile.sync_directory(backups)
            profile.write_new(recovery, before, identity.pw_gid)
            profile.write_new(staged, serialized, identity.pw_gid)
            profile.sync_directory(config_dir)
            activate_configuration(profile, staged, config_path, recovery, before, updated, config_dir)
            print(json.dumps({'status': 'stored_user_read_verified', 'credential_kind': 'user', 'user_identity_verified': True,
                              'community_count': len(updated['communities']), 'scopes_verified': list(REQUIRED_SCOPES),
                              'writes_enabled': updated['writesEnabled'], 'owner_approval_required': True,
                              'vk_user_refresh_configured': False, 'next': 'Run per-capability acceptance; imported token lifetime is controlled by VK'}))
        finally:
            staged.unlink(missing_ok=True)
            recovery.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print(json.dumps(ImportFailure('interrupted').report()), file=sys.stderr)
        sys.exit(1)
    except ImportFailure as error:
        print(json.dumps(error.report()), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(json.dumps(ImportFailure(CURRENT_STAGE).report()), file=sys.stderr)
        sys.exit(1)
