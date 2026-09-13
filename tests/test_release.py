import base64,hashlib,importlib.util,json,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'script'))
import release
class ReleaseTests(unittest.TestCase):
    def test_extension_contains_only_runtime_files_and_preserves_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'extension.zip';release.extension(target)
            with zipfile.ZipFile(target) as z:
                self.assertEqual(set(z.namelist()),set(release.EXTENSION_FILES))
                self.assertIn('auto-close.js',z.namelist())
                m=json.loads(z.read('manifest.json'))
                identity=''.join(chr(97+int(c,16)) for c in hashlib.sha256(base64.b64decode(m['key'])).hexdigest()[:32])
                self.assertEqual(identity,'ipcmhgncockbpbfddohlgeimcjajpbgn')
                self.assertEqual(m['version'],json.loads((ROOT/'release.json').read_text())['version'])
                self.assertIn(identity,(ROOT/'native-host/Sources/tab-switcher/main.swift').read_text())
    def test_changed_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(release,'OUT',Path(directory)),patch.object(release,'github'):
            p=Path(directory)/'app.zip';p.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):release.fetch('v3.8.0','app.zip','0'*64)
    def test_submission_intent_saved_before_apple_call(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'app.zip';p.write_bytes(b'exact bytes');state={'phase':'build'};saved=[]
            def save(tag,s):saved.append(json.loads(json.dumps(s)))
            with patch.object(release,'save',side_effect=save),patch.object(release,'notary',side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):release.submit('v3.8.0',state,'app',p)
            self.assertEqual(saved[0]['phase'],'app_submitting')
            self.assertEqual(saved[0]['app']['sha256'],release.sha(p))
            self.assertNotIn('id',saved[0]['app'])
    def test_pending_apple_result_does_not_advance(self):
        state={'phase':'app_pending','app':{'id':'existing-id'}}
        with patch.object(release,'notary',return_value={'status':'In Progress'}) as notary,patch.object(release,'save') as save:
            self.assertFalse(release.check('v3.8.0',state,'app'));save.assert_not_called();notary.assert_called_once_with('info','existing-id')
    def test_rejection_is_persisted(self):
        state={'phase':'dmg_pending','dmg':{'id':'existing-id'}}
        with patch.object(release,'notary',return_value={'status':'Invalid'}),patch.object(release,'save') as save:
            with self.assertRaises(RuntimeError):release.check('v3.8.0',state,'dmg')
            self.assertEqual(state['phase'],'dmg_rejected');save.assert_called_once()
if __name__=='__main__':unittest.main()
