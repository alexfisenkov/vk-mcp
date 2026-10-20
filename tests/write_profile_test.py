import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'deploy/write-profile.py'
spec = importlib.util.spec_from_file_location('write_profile', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProfileTests(unittest.TestCase):
    def config(self):
        return {'communities': [123], 'tokens': {'group': {'123': 'synthetic-group'}, 'service': 'synthetic-service'},
                'writesEnabled': False, 'approvalDir': '/etc/vk-mcp/approvals', 'port': 8865,
                'stateDir': '/var/lib/vk-mcp', 'allowedHosts': ['127.0.0.1'], 'allowedOrigins': []}

    def test_profile_changes_only_one_field_and_never_mutates_source(self):
        before = self.config()
        snapshot = copy.deepcopy(before)
        after = m.candidate(before, 'write')
        self.assertEqual(before, snapshot)
        expected = copy.deepcopy(before)
        expected['writesEnabled'] = True
        self.assertEqual(after, expected)
        self.assertEqual(m.candidate(after, 'read-only'), before)
        after['tokens']['group']['123'] = 'different'
        self.assertEqual(before, snapshot)

    def test_write_profile_rejects_service_only_and_missing_scope(self):
        for mutate in (lambda c: c.update(communities=[]),
                       lambda c: c.update(tokens={'service': 'synthetic'}),
                       lambda c: c.update(tokens={'group': {'456': 'synthetic'}}),
                       lambda c: c.pop('approvalDir'),
                       lambda c: c.update(approvalDir='')):
            config = self.config()
            mutate(config)
            with self.assertRaises(ValueError):
                m.candidate(config, 'write')

    def test_user_credential_is_accepted_but_not_service_key(self):
        config = self.config()
        config['tokens'] = {'user': 'synthetic-user', 'service': 'synthetic-service'}
        self.assertTrue(m.candidate(config, 'write')['writesEnabled'])

    def test_serialized_config_keeps_protected_file_bound(self):
        config = self.config()
        self.assertEqual(json.loads(m.encode_configuration(config)), config)
        with self.assertRaises(ValueError):
            m.encode_configuration({'large': 'x' * 65536})

    def test_disabling_does_not_require_a_remaining_write_credential(self):
        config = {'communities': [], 'tokens': {}, 'writesEnabled': True}
        self.assertFalse(m.candidate(config, 'read-only')['writesEnabled'])
        for mode, before in [('invalid', self.config()), ('write', []), ('write', {'writesEnabled': 1})]:
            with self.assertRaises(ValueError):
                m.candidate(before, mode)

    def test_paths_accept_unicode_and_spaces_but_reject_relative_traversal_and_controls(self):
        self.assertEqual(m.installation_path('/srv/пример проекта'), Path('/srv/пример проекта'))
        for path in ('relative', '/srv/../etc', '/srv/line\nfeed', '/srv/null\0byte'):
            with self.assertRaises(ValueError):
                m.installation_path(path)

    def test_directory_chain_rejects_nonroot_writable_and_symlink_components(self):
        safe = SimpleNamespace(st_mode=stat.S_IFDIR | 0o750, st_uid=0)
        with patch.object(Path, 'lstat', return_value=safe):
            m.protected_directory(Path('/etc/vk-mcp/approvals'))
        for mode, uid in [(stat.S_IFDIR | 0o770, 0), (stat.S_IFDIR | 0o750, 123), (stat.S_IFLNK | 0o777, 0)]:
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)):
                with self.assertRaises(ValueError):
                    m.protected_directory(Path('/etc/vk-mcp/approvals'))

    def test_installed_parser_runs_as_service_with_secrets_on_stdin_only(self):
        config = self.config()
        with patch.object(m, 'run') as run:
            m.validate_installed(Path('/srv/пример проекта/releases/' + 'a' * 40 + '/dist/server/config.js'), config)
        args, kwargs = run.call_args
        self.assertEqual(args[:5], ('runuser', '-u', 'mcp-vk', '--', '/usr/bin/node'))
        self.assertNotIn('synthetic-group', repr(args))
        self.assertNotIn('synthetic-service', repr(args))
        self.assertEqual(json.loads(kwargs['input']), config)
        self.assertIn('parseSettings', args[-1])
        self.assertIn('accessSync', args[-1])

    def test_installed_module_requires_root_owned_current_and_exact_release(self):
        root = Path('/srv/vk-mcp')
        release = root / 'releases' / ('a' * 40)
        link = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)
        module = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0)
        with patch.object(m, 'protected_directory'), patch.object(Path, 'resolve', return_value=release), \
             patch.object(Path, 'lstat', side_effect=[link, module]):
            self.assertEqual(m.installed_module(root), release / 'dist/server/config.js')
        for invalid in (Path('/srv/other/releases/' + 'a' * 40), root / 'releases/main'):
            with patch.object(m, 'protected_directory'), patch.object(Path, 'resolve', return_value=invalid), \
                 patch.object(Path, 'lstat', return_value=link):
                with self.assertRaises(ValueError):
                    m.installed_module(root)
        for invalid in (SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=123),
                        SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)):
            with patch.object(m, 'protected_directory'), patch.object(Path, 'lstat', return_value=invalid):
                with self.assertRaises(ValueError):
                    m.installed_module(root)
        with patch.object(m, 'protected_directory'), patch.object(Path, 'resolve', return_value=release), \
             patch.object(Path, 'lstat', side_effect=[link, SimpleNamespace(st_mode=stat.S_IFREG | 0o664, st_uid=0)]):
            with self.assertRaises(ValueError):
                m.installed_module(root)

    def test_partial_secret_write_is_removed_on_fsync_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'staged'
            with patch.object(m.os, 'fchown'), patch.object(m.os, 'fsync', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    m.write_new(path, b'synthetic', 123)
            self.assertFalse(path.exists())

    def activation(self, change_before=False, recovery_raw=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        parent = Path(directory.name)
        before = (json.dumps(self.config()) + '\n').encode()
        updated = m.candidate(self.config(), 'write')
        config = parent / 'config.json'
        staged = parent / 'staged'
        recovery = parent / 'recovery'
        config.write_bytes(b'concurrent change' if change_before else before)
        staged.write_bytes((json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode())
        recovery.write_bytes(before if recovery_raw is None else recovery_raw)
        return staged, config, recovery, before, updated, parent

    def test_success_is_restarted_authenticated_and_read_back(self):
        args = self.activation()
        with patch.object(m, 'read_protected', side_effect=lambda path: path.read_bytes()), \
             patch.object(m, 'run') as run, patch.object(m, 'health') as health, patch.object(m, 'sync_directory') as sync:
            m.activate_configuration(*args)
        run.assert_called_once_with('systemctl', 'restart', 'mcp-vk.service')
        health.assert_called_once_with(args[-1], args[-2])
        sync.assert_called_once_with(args[-1])
        self.assertEqual(json.loads(args[1].read_bytes()), args[-2])

    def test_failure_restores_prepared_copy_and_verifies_previous_profile(self):
        args = self.activation()
        with patch.object(m, 'read_protected', side_effect=lambda path: path.read_bytes()), \
             patch.object(m, 'run') as run, patch.object(m, 'health', side_effect=[ValueError('not ready'), None]) as health, \
             patch.object(m, 'sync_directory'), patch.object(m, 'write_new', side_effect=OSError('cannot allocate')):
            with self.assertRaisesRegex(ValueError, 'restored and verified'):
                m.activate_configuration(*args)
        self.assertEqual(args[1].read_bytes(), args[3])
        self.assertEqual(run.call_count, 2)
        self.assertEqual(health.call_args_list[1].args, (args[-1], json.loads(args[3])))

    def test_restart_failure_also_restores_and_verifies_previous_profile(self):
        args = self.activation()
        with patch.object(m, 'read_protected', side_effect=lambda path: path.read_bytes()), \
             patch.object(m, 'run', side_effect=[ValueError('restart failed'), None]) as run, \
             patch.object(m, 'health') as health, patch.object(m, 'sync_directory'):
            with self.assertRaisesRegex(ValueError, 'restored and verified'):
                m.activate_configuration(*args)
        self.assertEqual(args[1].read_bytes(), args[3])
        self.assertEqual(run.call_count, 2)
        health.assert_called_once_with(args[-1], json.loads(args[3]))

    def test_failed_rollback_reports_unknown_running_state_without_retry(self):
        args = self.activation()
        with patch.object(m, 'read_protected', side_effect=lambda path: path.read_bytes()), \
             patch.object(m, 'run') as run, patch.object(m, 'health', side_effect=ValueError('not ready')) as health, \
             patch.object(m, 'sync_directory'):
            with self.assertRaisesRegex(ValueError, 'rollback incomplete'):
                m.activate_configuration(*args)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(health.call_count, 2)

    def test_snapshot_drift_or_bad_recovery_never_restarts_or_overwrites(self):
        for args in (self.activation(change_before=True), self.activation(recovery_raw=b'bad recovery')):
            snapshot = args[1].read_bytes()
            with patch.object(m, 'read_protected', side_effect=lambda path: path.read_bytes()), patch.object(m, 'run') as run:
                with self.assertRaises(ValueError):
                    m.activate_configuration(*args)
            self.assertEqual(args[1].read_bytes(), snapshot)
            run.assert_not_called()

    def test_health_requires_profile_and_approval_gate_not_just_listener(self):
        calls = []
        def response(path, port, bearer, body=None):
            calls.append((path, port, body))
            if path == 'health':
                return {'status': 'ok'}
            return {'result': {'structuredContent': {'status': 'ok', 'writesEnabled': True, 'ownerApprovalRequired': True}}}
        config = self.config()
        config['writesEnabled'] = True
        with patch.object(m, 'read_protected', return_value=b'synthetic-bearer'), patch.object(m, 'local_json', side_effect=response):
            m.health(Path('/etc/vk-mcp'), config)
        self.assertEqual([c[0] for c in calls], ['health', 'mcp'])
        self.assertEqual(calls[1][2]['params']['name'], 'vk_capabilities')
        with patch.object(m, 'read_protected', return_value=b'synthetic-bearer'), \
             patch.object(m, 'local_json', return_value={'status': 'ok'}), patch.object(m.time, 'sleep'):
            with self.assertRaises(ValueError):
                m.health(Path('/etc/vk-mcp'), config)

    def test_readiness_redirect_is_rejected(self):
        with self.assertRaises(ValueError):
            m.NoRedirect().redirect_request(None, None, None, None, None, None)


if __name__ == '__main__':
    unittest.main()
