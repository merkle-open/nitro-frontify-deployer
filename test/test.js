import test from 'ava';
import NitroFrontifyDeployer from '..';
import denodeify from 'denodeify';
import path from 'path';

const copy = denodeify(require('ncp').ncp);
const mkdirp = denodeify(require('mkdirp'));
const rimraf = denodeify(require('rimraf'));
const readFile = denodeify(require('fs').readFile);
const writeFile = denodeify(require('fs').writeFile);
const unlink = denodeify(require('fs').unlink);

const tmp = path.resolve(__dirname, '..', 'tmp', 'testing');
const fixtures = path.resolve(__dirname, 'fixtures');

let testDirId = 0;
async function createTestEnvironment(environment = 'valid') {
  const targetDir = path.resolve(tmp, 'test-' + testDirId++);
  const componentDir = path.join(targetDir, 'components');
  const tmpDir = path.join(targetDir, 'tmp');
  await mkdirp(tmpDir)
  await copy(path.join(fixtures, environment), targetDir);
  return {componentDir, tmpDir};
}

test('should verify that all files are valid', async t => {
    const {componentDir} = await createTestEnvironment('valid');
    const deployer = new NitroFrontifyDeployer({
      rootDirectory: componentDir,
      mapping: { 'atoms': 'atom' }
    });
    t.is(await deployer.validateComponents(), true);
    t.pass();
});

test('should throw if a component is not valid', async t => {
    const {componentDir} = await createTestEnvironment('invalid');
    const deployer = new NitroFrontifyDeployer({
      rootDirectory: componentDir,
      mapping: { 'atoms': 'atom' }
    });
    var err;
    try {
      await deployer.validateComponents();
    } catch(e) {
      err = e;
    }
    var invalidFile = path.join(componentDir, 'atoms', 'button', 'pattern.json');
    var expectedMessage = `data should have required property 'name' in "${invalidFile}"`;
    t.is(err.message, expectedMessage);
    t.pass();
});

test('should throw no component exists', async t => {
    const {componentDir} = await createTestEnvironment('empty');
    const deployer = new NitroFrontifyDeployer({
      rootDirectory: componentDir,
      mapping: { 'atoms': 'atom' }
    });
    var err;
    try {
      await deployer.validateComponents();
    } catch(e) {
      err = e;
    }
    var expectedMessage = `Component validation failed - no components found`;
    t.is(err.message, expectedMessage);
    t.pass();
});

test('should throw if the component type is not in the mapping', async t => {
    const {componentDir} = await createTestEnvironment('valid');
    const deployer = new NitroFrontifyDeployer({
      rootDirectory: componentDir,
      mapping: { }
    });
    var err;
    try {
      await deployer.validateComponents();
    } catch(e) {
      err = e;
    }
    var expectedMessage = `Folder name "atoms" is not in the mapping.`;
    t.is(err.message, expectedMessage);
    t.pass();
});

test('should generate the transferdata for a component', async t => {
  const {componentDir} = await createTestEnvironment('valid');
  const deployer = new NitroFrontifyDeployer({
    rootDirectory: componentDir,
    mapping: { 'atoms': 'atom' }
  });
  var [component] = await deployer._generateComponentsTransferData();
  var expected = {
    'name': 'button',
    'type': 'atoms',
    'variations': {
      'example.hbs': {
        'name': 'button example',
        'assets': {
          'html': [
            'atoms/button/example.html'
          ]
        }
      }
    }
  };
  t.deepEqual(component, expected);
  t.pass();
});


test.after.always('cleanup', async t => {
  await rimraf(tmp);
});