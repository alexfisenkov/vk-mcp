import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('configure_user', root / 'deploy/configure-user.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
profile_spec = importlib.util.spec_from_file_location('profile_for_tests', root / 'deploy/write-profile.py')
p = importlib.util.module_from_spec(profile_spec)
profile_spec.loader.exec_module(p)
MASK = sum(m.REQUIRED_SCOPES.values())


class UserCredentialTests(unittest.TestCase):
    def config(self):
        return {'communities': [123, 456], 'tokens': {'group': {'123': 'synthetic-group'}, 'service': 'synthetic-service'},
                'writesEnabled': True, 'approvalDir': '/etc/vk-mcp/approvals', 'stateDir': '/var/lib/vk-mcp',
                'allowedHosts': ['127.0.0.1'], 'allowedOrigins': [], 'port': 8865}

    def request(self, method, token, params):
        if method == 'users.get':
            return {'response': [{'id': 789, 'first_name': 'Synthetic', 'last_name': 'Owner'}]}
        if method == 'account.getAppPermissions':
            return {'response': MASK}
        if method == 'groups.getById':
            return {'response': {'groups': [{'id': params['group_id'], 'is_admin': 1, 'admin_level': 3}]}}
        if method == 'wall.get':
            return {'response': {'count': 0, 'items': []}}
        self.fail('unexpected method')

    def test_candidate_preserves_profile_allowlist_and_all_other_credentials(self):
        before = self.config()
        snapshot = copy.deepcopy(before)
        updated = m.candidate(before, 'synthetic-user')
        expected = copy.deepcopy(before)
        expected['tokens']['user'] = 'synthetic-user'
        self.assertEqual(updated, expected)
        self.assertEqual(before, snapshot)
        updated['tokens']['group']['123'] = 'changed'
        self.assertEqual(before, snapshot)
        before['writesEnabled'] = False
        self.assertFalse(m.candidate(before, 'synthetic-user')['writesEnabled'])

    def test_candidate_refuses_rotation_even_an_invalid_existing_placeholder(self):
        for old in ('existing', '', None):
            config = self.config()
            config['tokens']['user'] = old
            with self.assertRaises(m.ImportFailure):
                m.candidate(config, 'synthetic-new')

    def test_invalid_credential_and_local_scope_are_rejected(self):
        for token in ('', 'has space', 'line\nbreak', 'x' * 8193, None):
            with self.assertRaises(m.ImportFailure):
                m.candidate(self.config(), token)
        for change in ({'communities': []}, {'communities': [True]}, {'communities': [123, 123]},
                       {'communities': [-123]}, {'communities': list(range(1, 102))}, {'tokens': []}, {'writesEnabled': 1}):
            with self.assertRaises(m.ImportFailure):
                m.candidate({**self.config(), **change}, 'synthetic')

    def test_expected_owner_id_is_explicit_positive_and_safe(self):
        self.assertEqual(m.numeric_id('789'), 789)
        for invalid in ('0', '-789', '789.0', 'name', ' 789', str(2 ** 54)):
            with self.assertRaises(m.ImportFailure):
                m.numeric_id(invalid)

    def test_permission_mask_checks_every_required_named_bit(self):
        m.verify_permissions(MASK)
        m.verify_permissions(MASK | 65536)
        for name, bit in m.REQUIRED_SCOPES.items():
            with self.assertRaises(m.ImportFailure) as failure:
                m.verify_permissions(MASK & ~bit)
            self.assertEqual(failure.exception.report()['missing_scopes'], [name])
        for invalid in (True, 0.0, float('inf'), '135536644', {'mask': MASK}, None, -1, 2 ** 54):
            with self.assertRaises(m.ImportFailure):
                m.verify_permissions(invalid)

    def test_verification_is_self_identity_and_explicit_allowlist_reads_only(self):
        calls = []
        def request(method, token, params):
            calls.append((method, params))
            return self.request(method, token, params)
        m.verify_token('synthetic-user', 789, [123, 456], request)
        self.assertEqual(calls, [('users.get', {}), ('account.getAppPermissions', {}),
                                ('groups.getById', {'group_id': 123, 'fields': 'is_admin,admin_level'}),
                                ('wall.get', {'owner_id': -123, 'count': 1}),
                                ('groups.getById', {'group_id': 456, 'fields': 'is_admin,admin_level'}),
                                ('wall.get', {'owner_id': -456, 'count': 1})])

    def test_legacy_group_response_shape_and_boolean_administrator_are_accepted(self):
        def request(method, token, params):
            if method == 'groups.getById':
                return {'response': [{'id': params['group_id'], 'is_admin': True, 'admin_level': 3}]}
            return self.request(method, token, params)
        m.verify_token('synthetic', 789, [123], request)

    def test_wrong_owner_or_missing_user_identity_is_rejected_before_permissions(self):
        for response in ([], [{'id': 1}], [{'id': 789}, {'id': 1}], [{'id': '789'}], [{'id': 789, 'deactivated': 'deleted'}], {'id': 789}):
            request = Mock(return_value={'response': response})
            with self.assertRaises(m.ImportFailure) as failure:
                m.verify_token('synthetic', 789, [123], request)
            self.assertEqual(failure.exception.stage, 'identity')
            request.assert_called_once_with('users.get', 'synthetic', {})

    def test_group_and_service_credentials_do_not_pass_user_only_permission_check(self):
        for code in (5, 27, 28):
            def request(method, token, params):
                return {'error': {'error_code': code, 'request_params': [{'key': 'access_token', 'value': 'sensitive-marker'}]}} if method == 'account.getAppPermissions' else self.request(method, token, params)
            with self.assertRaises(m.ImportFailure) as failure:
                m.verify_token('synthetic-not-user', 789, [123], request)
            self.assertEqual(failure.exception.report()['vk_code'], code)
            self.assertNotIn('sensitive-marker', json.dumps(failure.exception.report()))

    def test_every_community_requires_exact_administrator_of_the_exact_group(self):
        for group in ({'id': 999, 'is_admin': 1, 'admin_level': 3}, {'id': 456, 'is_admin': 0, 'admin_level': 3},
                      {'id': 456, 'is_admin': 1, 'admin_level': 1}, {'id': 456, 'is_admin': 1, 'admin_level': 2},
                      {'id': 456, 'is_admin': 1, 'admin_level': 4}, {'id': 456, 'is_admin': '1', 'admin_level': 3},
                      {'id': 456, 'is_admin': True, 'admin_level': True}, {'id': 456}):
            def request(method, token, params):
                if method == 'groups.getById' and params['group_id'] == 456:
                    return {'response': {'groups': [group]}}
                return self.request(method, token, params)
            with self.assertRaises(m.ImportFailure) as failure:
                m.verify_token('synthetic', 789, [123, 456], request)
            self.assertEqual(failure.exception.stage, 'administration')

    def test_malformed_and_rejected_read_responses_are_sanitized_without_retry(self):
        for bad in (None, [], {}, {'error': None}, {'error': {'error_code': 'sensitive-marker'}}, {'error': {'error_code': True}}):
            request = Mock(return_value=bad)
            with self.assertRaises(m.ImportFailure) as failure:
                m.verify_token('synthetic', 789, [123], request)
            self.assertNotIn('sensitive-marker', json.dumps(failure.exception.report()))
            request.assert_called_once()
        request = Mock(side_effect=OSError('sensitive-marker'))
        with self.assertRaises(m.ImportFailure) as failure:
            m.verify_token('synthetic', 789, [123], request)
        self.assertNotIn('sensitive-marker', str(failure.exception))
        request.assert_called_once()

    def test_wall_failure_never_changes_any_configuration(self):
        before = self.config()
        snapshot = copy.deepcopy(before)
        updated = m.candidate(before, 'synthetic')
        def request(method, token, params):
            return {'error': {'error_code': 15}} if method == 'wall.get' else self.request(method, token, params)
        with self.assertRaises(m.ImportFailure) as failure:
            m.verify_token(updated['tokens']['user'], 789, updated['communities'], request)
        self.assertEqual(failure.exception.report()['stage'], 'wall')
        self.assertEqual(before, snapshot)

    def test_only_fixed_minimal_read_shapes_can_reach_vk_network(self):
        for method, params in [('wall.post', {'owner_id': -123}), ('users.get', {'user_ids': 789}),
                               ('account.getAppPermissions', {'user_id': 789}), ('wall.get', {'owner_id': -123, 'count': 2}),
                               ('groups.getById', {'group_id': 123, 'fields': 'members_count'}),
                               ('wall.get', {'owner_id': -123, 'count': 1, 'access_token': 'injected'})]:
            with patch.object(m.urllib.request, 'build_opener') as opener:
                with self.assertRaises(m.ImportFailure):
                    m.vk_read(method, 'synthetic', params)
                opener.assert_not_called()
        with self.assertRaises(m.ImportFailure):
            m.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_privileged_python_import_refuses_untrusted_code_before_import(self):
        for mode, uid in [(stat.S_IFDIR | 0o777, 0), (stat.S_IFDIR | 0o755, 123), (stat.S_IFLNK | 0o777, 0)]:
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)), patch.object(m.importlib.util, 'spec_from_file_location') as importer:
                with self.assertRaises(m.ImportFailure):
                    m.load_profile()
                importer.assert_not_called()

    def test_privileged_import_through_canonical_current_uses_protected_immutable_target(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        deployment = Path(temporary.name).resolve() / 'vk-mcp'
        release = deployment / 'releases' / ('a' * 40)
        (release / 'deploy').mkdir(parents=True)
        # Symlink to the real tested files, so importlib actually executes the
        # sibling helper after source resolution rather than a mocked importer.
        (release / 'deploy/configure-user.py').write_text('# synthetic entrypoint\n')
        (release / 'deploy/write-profile.py').write_bytes((root / 'deploy/write-profile.py').read_bytes())
        (deployment / 'current').symlink_to(release, target_is_directory=True)
        original_lstat = Path.lstat
        def root_owned(path):
            info = original_lstat(path)
            # The fixture sits in a writable temporary directory; production
            # must pass the same mode/ownership test without this test seam.
            mode = stat.S_IFDIR | 0o755 if stat.S_ISDIR(info.st_mode) else stat.S_IFREG | 0o644
            return SimpleNamespace(st_mode=mode, st_uid=0)
        with patch.object(m, '__file__', str(deployment / 'current/deploy/configure-user.py')), patch.object(Path, 'lstat', root_owned):
            loaded = m.load_profile()
        self.assertEqual(Path(loaded.__file__), release / 'deploy/write-profile.py')
        self.assertTrue(callable(loaded.read_protected))
        self.assertTrue(callable(loaded.installed_module))

    def test_privileged_import_still_refuses_an_untrusted_sibling_file(self):
        for file_mode, file_uid in [(stat.S_IFREG | 0o644, 123), (stat.S_IFREG | 0o664, 0), (stat.S_IFLNK | 0o777, 0)]:
            def info(path):
                return SimpleNamespace(st_mode=file_mode, st_uid=file_uid) if path.name == 'write-profile.py' else SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
            with patch.object(Path, 'lstat', info), patch.object(m.importlib.util, 'spec_from_file_location') as importer:
                with self.assertRaises(m.ImportFailure):
                    m.load_profile()
                importer.assert_not_called()

    def activation(self, changed=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        before = (json.dumps(self.config()) + '\n').encode()
        updated = m.candidate(self.config(), 'synthetic-user')
        staged, config, recovery = [directory / name for name in ('staged', 'config', 'recovery')]
        config.write_bytes(b'concurrent' if changed else before)
        recovery.write_bytes(before)
        staged.write_bytes(p.encode_configuration(updated))
        profile = SimpleNamespace(read_protected=lambda path: path.read_bytes(), sync_directory=Mock(), run=Mock(), encode_configuration=p.encode_configuration)
        return profile, staged, config, recovery, before, updated, directory

    def test_activation_checks_new_user_and_exact_config_after_restart(self):
        args = self.activation()
        with patch.object(m, 'health') as health:
            m.activate_configuration(*args)
        args[0].run.assert_called_once_with('systemctl', 'restart', 'mcp-vk.service')
        health.assert_called_once_with(args[0], args[-1], args[-2])
        self.assertEqual(json.loads(args[2].read_bytes()), args[-2])

    def test_failed_new_readiness_restores_existing_profile_and_credentials(self):
        args = self.activation()
        with patch.object(m, 'health', side_effect=[ValueError('failed'), None]) as health:
            with self.assertRaises(m.ImportFailure) as failure:
                m.activate_configuration(*args)
        self.assertEqual(failure.exception.outcome, 'previous_configuration_restored')
        self.assertEqual(args[2].read_bytes(), args[4])
        self.assertEqual(args[0].run.call_count, 2)
        self.assertEqual(health.call_args_list[1].args[-1], json.loads(args[4]))

    def test_failed_rollback_is_explicit_and_not_retried(self):
        args = self.activation()
        with patch.object(m, 'health', side_effect=ValueError('failed')) as health:
            with self.assertRaises(m.ImportFailure) as failure:
                m.activate_configuration(*args)
        self.assertEqual(failure.exception.report()['outcome'], 'rollback_incomplete')
        self.assertEqual(args[0].run.call_count, 2)
        self.assertEqual(health.call_count, 2)

    def test_interrupt_during_new_readiness_rolls_back_and_verifies(self):
        args = self.activation()
        with patch.object(m, 'health', side_effect=[KeyboardInterrupt(), None]):
            with self.assertRaises(m.ImportFailure) as failure:
                m.activate_configuration(*args)
        self.assertEqual(failure.exception.outcome, 'previous_configuration_restored')
        self.assertEqual(args[2].read_bytes(), args[4])

    def test_interrupt_immediately_after_atomic_replace_also_rolls_back(self):
        args = self.activation()
        original_replace = m.os.replace
        def replace(source, target):
            original_replace(source, target)
            if source == args[1]:
                raise KeyboardInterrupt()
        with patch.object(m.os, 'replace', side_effect=replace), patch.object(m, 'health'):
            with self.assertRaises(m.ImportFailure) as failure:
                m.activate_configuration(*args)
        self.assertEqual(failure.exception.outcome, 'previous_configuration_restored')
        self.assertEqual(args[2].read_bytes(), args[4])

    def test_snapshot_drift_never_overwrites_or_restarts(self):
        args = self.activation(changed=True)
        with patch.object(m, 'health'):
            with self.assertRaises(m.ImportFailure):
                m.activate_configuration(*args)
        self.assertEqual(args[2].read_bytes(), b'concurrent')
        args[0].run.assert_not_called()

    def test_running_readiness_requires_user_flag_and_unchanged_write_profile(self):
        config = m.candidate(self.config(), 'synthetic-user')
        profile = SimpleNamespace(health=Mock(), read_protected=Mock(return_value=b'synthetic-bearer'), local_json=Mock(return_value={'result': {'structuredContent': {'status': 'configured', 'tokenTypes': {'user': True}, 'writesEnabled': True}}}))
        m.health(profile, Path('/etc/vk-mcp'), config)
        self.assertEqual(profile.local_json.call_args.args[3]['params']['name'], 'vk_status')
        for user, write in [(False, True), (True, False)]:
            profile.local_json.return_value = {'result': {'structuredContent': {'status': 'configured', 'tokenTypes': {'user': user}, 'writesEnabled': write}}}
            with patch.object(m.time, 'sleep'):
                with self.assertRaises(m.ImportFailure):
                    m.health(profile, Path('/etc/vk-mcp'), config)


if __name__ == '__main__':
    unittest.main()
