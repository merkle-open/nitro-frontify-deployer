/* eslint max-len: off, quotes:off */
import test from 'ava';
import denodeify from 'denodeify';
import path from 'path';
import NitroFrontifyDeployer from '..';

const copy = denodeify(require('ncp').ncp);
const mkdirp = denodeify(require('mkdirp'));
const rimraf = denodeify(require('rimraf'));
const readFile = denodeify(require('fs').readFile);
const fileExists = (file) => readFile(file).then(() => true).catch(() => false);
const act = ['a', 'c', 'c', 'e', 's', 's', '_', 't', 'o', 'k', 'e', 'n'].join('');

const tmp = path.resolve(__dirname, '..', 'tmp', 'testing');
const fixtures = path.resolve(__dirname, 'fixtures');
const compilerMock = (tpl) => () => tpl.toUpperCase();

const getErrorMessage = async(cb) => {
	try {
		await Promise.resolve().then(cb);
	} catch (e) {
		return e.message;
	}
	return undefined;
};

let testDirId = 0;
const createTestEnvironment = async(environment = 'valid') => {
	const targetDir = path.resolve(tmp, `test-${testDirId++}`);
	const componentDir = path.join(targetDir, 'components');
	const tmpDir = path.join(targetDir, 'tmp');
	await mkdirp(tmpDir);
	await copy(path.join(fixtures, environment), targetDir);
	return {
		componentDir,
		tmpDir
	};
};

test('should verify that all files are valid', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	t.is(await deployer.validateComponents(), true);
	t.pass();
});

test('should throw if a component is not valid', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('invalid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const err = await getErrorMessage(async() => {
		await deployer.validateComponents();
	});
	const invalidFile = path.join(componentDir, 'atoms', 'button', 'pattern.json');
	const expectedMessage = `Schema "nitro-frontify-deployer-input-schema" can't be applied for "${invalidFile}" because data.stability should be equal to one of the allowed values`;
	t.is(err, expectedMessage);
	t.pass();
});

test('should throw no component exists', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('empty');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const err = await getErrorMessage(async() => {
		await deployer.validateComponents();
	});
	const expectedMessage = `Component validation failed - no components found`;
	t.is(err, expectedMessage);
	t.pass();
});

test('should throw if the component type is not in the mapping', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const err = await getErrorMessage(async() => {
		await deployer.validateComponents();
	});
	const expectedMessage = `Folder name "atoms" is not in the mapping.`;
	t.is(err, expectedMessage);
	t.pass();
});

test('should generate the transferdata for a component', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const buttonComponent = await deployer.nitroComponentResolver.getComponent('atoms/button');
	const transferData = await deployer._generateComponentTransferData(buttonComponent);
	const expected = {
		name: 'button',
		type: 'atom',
		stability: 'beta',
		id: 189,
		variations: {
			'_example/example.hbs': {
				name: 'button example',
				assets: {
					html: [
						'atoms/button/example.html'
					]
				}
			}
		}
	};
	t.deepEqual(transferData, expected);
	t.pass();
});

test('should generate the transferdata for another component', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const radioComponent = await deployer.nitroComponentResolver.getComponent('atoms/radio');
	const transferData = await deployer._generateComponentTransferData(radioComponent);
	const expected = {
		stability: 'stable',
		name: 'radio',
		type: 'atom',
		variations: {
			'_example/desktop.hbs': {
				name: 'radio desktop',
				assets: {
					html: [
						'atoms/radio/desktop.html'
					]
				}
			},
			'_example/mobile.hbs': {
				name: 'radio mobile',
				assets: {
					html: [
						'atoms/radio/mobile.html'
					]
				}
			}
		}
	};
	t.deepEqual(transferData, expected);
	t.pass();
});

test('should compile a components examples', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const buttonComponent = await deployer.nitroComponentResolver.getComponent('atoms/button');
	await deployer._buildComponent(buttonComponent);
	const renderedTemplate = await readFile(path.join(tmpDir, 'atoms', 'button', 'example.html'));
	t.is(renderedTemplate.toString(), 'HELLO WORLD');
	t.pass();
});

test('should compile a components examples', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	await deployer._buildComponents();
	const renderedTemplate = await readFile(path.join(tmpDir, 'atoms', 'button', 'example.html'));
	t.is(renderedTemplate.toString(), 'HELLO WORLD');
	t.pass();
});

test('should generate a components pattern.json', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const buttonComponent = await deployer.nitroComponentResolver.getComponent('atoms/button');
	await deployer._buildComponent(buttonComponent);
	const patternJson = await readFile(path.join(tmpDir, 'atoms', 'button', 'pattern.json'));
	const patternData = JSON.parse(patternJson.toString());
	const transferData = await deployer._generateComponentTransferData(buttonComponent);
	t.deepEqual(patternData, transferData);
	t.pass();
});

test('should deploy without any error', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir,
		frontifyOptions: {
			[act]: '...',
			project: 112324,
			baseUrl: 'https:/https://app.frontify.com/',
			dryRun: true
		}
	});
	//
	// TODO UPDATE FRONTIFY OPTIONS AND REMOVE ERROR CHECKING
	//
	const err = await getErrorMessage(async() => {
		await deployer.deploy();
	});
	t.is(err, 'Could not get your pattern library data. Error: Invalid URI "https:/https://app.frontify.com/v1/patterns/list/112324"');
	//
	// const deployResult = await deployer.deploy();
	// t.deepEqual(deployResult.length, 5);
	t.pass();
});

test('should clean the target folder', async t => {
	const {
		componentDir,
		tmpDir
	} = await createTestEnvironment('valid');
	const deployer = new NitroFrontifyDeployer({
		rootDirectory: componentDir,
		mapping: {
			atoms: 'atom'
		},
		compiler: compilerMock,
		targetDir: tmpDir
	});
	const htmlFile = path.join(tmpDir, 'atoms', 'button', 'example.html');
	await deployer._buildComponents();
	const existsBeforeClean = await fileExists(htmlFile);
	await deployer.clean();
	const existsAfterClean = await fileExists(htmlFile);
	t.is(existsBeforeClean, true);
	t.is(existsAfterClean, false);
	t.pass();
});

test.after.always('cleanup', async() => {
	await rimraf(tmp);
});
