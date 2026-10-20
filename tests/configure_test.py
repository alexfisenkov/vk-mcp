import importlib.util, unittest, tempfile
from unittest.mock import patch
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'deploy/configure.py'
s=importlib.util.spec_from_file_location('onboard',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class OnboardTests(unittest.TestCase):
 def test_input(self):
  self.assertEqual(m.community_id('123'),123)
  for bad in ('-123','0','abc','1.5',str(2**54)):
   with self.assertRaises(ValueError):m.community_id(bad)
 def test_candidate_preserves_config_and_writes_stay_disabled(self):
  before={'communities':[111],'tokens':{'service':'synthetic-service'},'writesEnabled':False,'port':8865}
  candidate=m.candidate(before,123,'synthetic-group')
  self.assertEqual(before['communities'],[111]);self.assertEqual(candidate['communities'],[111,123]);self.assertEqual(candidate['tokens']['group'],{'123':'synthetic-group'});self.assertEqual(candidate['tokens']['service'],'synthetic-service');self.assertFalse(candidate['writesEnabled'])
 def test_refuses_rotation_and_write_enabled(self):
  for cfg in ({'communities':[123],'tokens':{'group':{'123':'existing'}},'writesEnabled':False},{'communities':[],'tokens':{},'writesEnabled':True}):
   with self.assertRaises(ValueError):m.candidate(cfg,123,'synthetic-group')
 def test_extract_community_from_both_vk_response_shapes(self):
  self.assertEqual(m.confirm_target({'response':{'groups':[{'id':123}]}},123),123)
  self.assertEqual(m.confirm_target({'response':[{'id':123}]},123),123)
  for response in ({'error':{'error_code':5}},{'response':[{'id':999}]},{'response':None}):
   with self.assertRaises(ValueError):m.confirm_target(response,123)
 def test_rejects_invalid_token(self):
  for t in ('','a b','secret\nline','x'*8193):
   with self.assertRaises(ValueError):m.candidate({'communities':[],'tokens':{},'writesEnabled':False},123,t)
 def test_identity_verification_never_uses_requested_group_as_lookup(self):
  calls=[]
  def request(method,token,params):
   calls.append((method,params))
   return {'response':{'mask':1}} if method.endswith('getTokenPermissions') else {'response':[{'id':123}]}
  self.assertEqual(m.verify_community_token('synthetic',123,request),123)
  self.assertEqual(calls,[('groups.getTokenPermissions',{}),('groups.getById',{})])
  with self.assertRaises(ValueError):m.verify_community_token('synthetic',999,request)
 def test_partial_write_is_cleaned_up(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'secret.json'
   with patch.object(m.os,'fchown'),patch.object(m.os,'fsync',side_effect=OSError('disk error')):
    with self.assertRaises(OSError):m.write_new(path,b'synthetic',0)
   self.assertFalse(path.exists())
 def test_redirect_is_refused(self):
  with self.assertRaises(ValueError):m.NoRedirect().redirect_request(None,None,None,None,None,None)
 def test_rollback_uses_prepared_copy_without_new_writes(self):
  with tempfile.TemporaryDirectory() as directory:
   config=Path(directory)/'config';staged=Path(directory)/'staged';recovery=Path(directory)/'recovery'
   config.write_bytes(b'old');staged.write_bytes(b'new');recovery.write_bytes(b'old')
   with patch.object(m,'run'),patch.object(m,'health',side_effect=ValueError('not ready')),patch.object(m,'write_new',side_effect=OSError('disk full')):
    with self.assertRaises(ValueError):m.activate_configuration(staged,config,recovery,8865)
   self.assertEqual(config.read_bytes(),b'old')
 def test_service_key_preserves_group_and_refuses_overwrite(self):
  before={'communities':[123],'tokens':{'group':{'123':'synthetic-group'}},'writesEnabled':False}
  after=m.service_candidate(before,'synthetic-service')
  self.assertEqual(after['tokens']['group'],before['tokens']['group']);self.assertNotIn('service',before['tokens']);self.assertEqual(after['tokens']['service'],'synthetic-service')
  with self.assertRaises(ValueError):m.service_candidate(after,'another-service')
 def test_service_key_verification_is_read_only_and_source_scoped(self):
  calls=[]
  def request(method,key,params):calls.append((method,params));return {'response':{'count':0,'items':[]}}
  self.assertEqual(m.verify_service_key('synthetic',123,request),123)
  self.assertEqual(calls,[('wall.get',{'owner_id':-123,'count':1})])
  with self.assertRaises(ValueError):m.verify_service_key('synthetic',123,lambda *a:{'error':{'error_code':5}})
 def test_service_key_rejects_missing_scope_and_invalid_format(self):
  for before,key in [({'communities':[],'writesEnabled':False},'synthetic'),({'communities':[123],'writesEnabled':True},'synthetic'),({'communities':[123],'writesEnabled':False},'has space')]:
   with self.assertRaises(ValueError):m.service_candidate(before,key)
 def test_service_probe_selects_only_existing_allowlisted_community(self):
  config={'communities':[123,456]}
  self.assertEqual(m.verification_group(config),123)
  self.assertEqual(m.verification_group(config,456),456)
  for requested in (999,-123,'bad'):
   with self.assertRaises(ValueError):m.verification_group(config,requested)
if __name__=='__main__':unittest.main()
