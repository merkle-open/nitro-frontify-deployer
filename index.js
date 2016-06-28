'use strict';
const assert = require('assert');
const path = require('path');
const denodeify = require('denodeify');
const fs = require('fs');
const _ = require('lodash');
const schema = require('./schema.json');
const NitroComponentResolver = require('@namics/nitro-component-resolver');
const NitroComponentValidator = require('@namics/nitro-component-validator');
const mkdirp = denodeify(require('mkdirp'));
const rimraf = denodeify(require('rimraf'));
const fsWriteFile = denodeify(fs.writeFile);
const fsReadFile = denodeify(fs.readFile);
const frontifyApi = require('@frontify/frontify-api');
const copy = denodeify(require('ncp').ncp);
const html = require('html');

class NitroFrontifyDeployer {

	constructor(config) {
		assert(config.rootDirectory && fs.existsSync(config.rootDirectory),
			'Please specify your component rootDirectory folder e.g. { rootDirectory: "/a/path"}');
		assert(config.targetDir,
			'Please specify your component targetDir folder e.g. { targetDir: "/a/path"}');
		assert(typeof config.mapping === 'object',
			'Please specifiy the foldername component type mapping e.g. { mapping: {"atoms": "atom" } }');
		assert(typeof config.compiler === 'function',
			'Please specify a compiler function to compile the example templates');

		this.nitroComponentResolver = config.nitroComponentResolver || new NitroComponentResolver({
			rootDirectory: config.rootDirectory,
			examples: true,
			watch: false
		});
		this.options = {};
		// The temporary directory where the html files should be build into
		this.options.targetDir = config.targetDir;
		// The source directory where the components are read from
		this.options.rootDirectory = config.rootDirectory;
		// Mapping between component folder name e.g. 'atoms' and component type e.g. 'atom'
		this.options.mapping = config.mapping;
		// The template compiler
		this.options.compiler = config.compiler;
		// Options to deploy the result to frontify
		this.options.frontifyOptions = config.frontifyOptions;
		// JS files to deploy
		this.options.jsFiles = config.jsFiles || [];
		// CSS files to deploy
		this.options.cssFiles = config.cssFiles || [];

		this.patternValidator = config.nitroPatternValidator || new NitroComponentValidator();
		this.patternValidator.addSchema(schema, 'frontify-deployer-schema');
	}

	/**
	 * Validates all found components
	 *
	 * Returns true if all components are valid
	 * @returns {boolean} success
	 *
	 */
	validateComponents() {
		return this.nitroComponentResolver
			.getComponents()
			.then((components) => {
				if (Object.keys(components).length === 0) {
					throw new Error('Component validation failed - no components found');
				}
				return !_.values(components)
					.some((component) => !this._validateComponent(component));
			});
	}

	/**
	 * The main method which validates, builds and compiles the entire frontend to frontify
	 * @return {boolean} success
	 */
	deploy() {
		return this.validateComponents()
			.then(() => this._buildComponents())
			.then(() => this._syncComponents());
	}

	clean() {
		return rimraf(this.options.targetDir);
	}

	/**
	 * Validate a single component
	 * @param {object} component A nitro-component-resolver component instance
	 * @return {boolean} success
	 */
	_validateComponent(component) {
		this.patternValidator.validateComponent(component);
		// Get the type folder name e.g. 'atoms' or 'molecules'
		const typeFolderName = path.basename(path.dirname(path.dirname(component.metaFile)));
		if (!this.options.mapping[typeFolderName]) {
			throw new Error(`Folder name "${typeFolderName}" is not in the mapping.`);
		}
		return true;
	}

	/**
	 * Generates the frontify variation data for an example file
	 * @param {object} component A nitro-component-resolver component instance
	 * @param {object} example A nitro-component-resolver example instance
	 * @return {object} variant
	 */
	_generateVariation(component, example) {
		const name = path.basename(example.filepath).replace(/\..+$/, '');
		const examplePath = path.join(path.relative(this.options.rootDirectory, component.directory), `${name}.html`);
		return {
			name: `${component.name} ${name}`,
			assets: {
				html: [
					examplePath.replace(/\\/g, '/')
				]
			}
		};
	}

	/**
	 * Generates the frontify ready pattern json data for the given component
	 * @param {object} component A nitro-component-resolver component instance
	 * @return {object} transferData
	 */
	_generateComponentTransferData(component) {
		const resultJson = {};
		const sourceJson = component.data;
		const frontifyProperties = Object.keys(schema.properties);
		// Copy all known properties
		frontifyProperties.forEach((property) => {
			if (sourceJson[property] !== undefined) {
				resultJson[property] = sourceJson[property];
			}
		});
		const componentPath = path.dirname(component.metaFile);
		const componentName = path.basename(componentPath);
		const componenType = path.basename(path.dirname(componentPath));
		// Set name from folder name e.g. components/atoms/button -> button
		/* istanbul ignore else */
		if (!resultJson.name) {
			resultJson.name = componentName;
		}
		// Set type from folder name e.g. components/atoms/button -> atoms -> [options.mapping] -> atom
		/* istanbul ignore else */
		if (!resultJson.type) {
			resultJson.type = this.options.mapping[componenType];
		}
		// Add variations
		resultJson.variations = {};
		return this.nitroComponentResolver.getComponentExamples(component.directory)
			.then((examples) => {
				examples
				.filter((example) => !example.hidden)
				.forEach((example) => {
					const exampleName = path.relative(component.directory, example.filepath).replace(/\\/g, '/');
					resultJson.variations[exampleName] = this._generateVariation(component, example);
				});
				return resultJson;
			});
	}

	/**
	 * Compile the example template using the engine from the config e.g. handlebars
	 * @param {string} templateSrc template source file e.g. /a/path/file.hbs
	 * @param {string} templateDest template output file e.g. /a/path/file.html
	 * @returns {Promise} write promise
	 */
	_compileExample(templateSrc, templateDest) {
		return mkdirp(path.dirname(templateDest)).then(() =>
			fsReadFile(templateSrc).then((src) => {
				let compiled = this.options.compiler(src.toString());
				// Execute template
				/* istanbul ignore else */
				if (typeof compiled === 'function') {
					compiled = compiled({});
				}
				const pretty = html.prettyPrint(compiled, { indent: 2, unformatted: [] });
				return fsWriteFile(templateDest, pretty);
			})
		);
	}

	/**
	 * @returns {Promise}
	 * Frontify doesn't support uploading css files and js files seperately
	 */
	_buildBaseComponent() {
		const coreComponentDirectory = path.resolve(this.options.targetDir, 'core', 'assets');
		const coreComponent = {
			name: 'core-assets',
			type: 'atom',
			stability: 'beta',
			assets: {
				html: [],
				css: this.options.cssFiles.map((file) => path.join(coreComponentDirectory, 'css', path.basename(file))),
				js: this.options.jsFiles.map((file) => path.join(coreComponentDirectory, 'js', path.basename(file)))
			}
		};
		return Promise.resolve()
			.then(() => mkdirp(path.join(coreComponentDirectory, 'css')))
			.then(() => Promise.all(
				this.options.cssFiles.map(
					(file) => copy(file, path.join(coreComponentDirectory, 'css', path.basename(file)))
				)
			))
			.then(() => mkdirp(path.join(coreComponentDirectory, 'js')))
			.then(() => Promise.all(
				this.options.jsFiles.map(
					(file) => copy(file, path.join(coreComponentDirectory, 'js', path.basename(file)))
				)
			))
			.then(() => fsWriteFile(
				path.join(coreComponentDirectory, 'pattern.json'),
				JSON.stringify(coreComponent, null, 2))
			);
	}

	/**
	 * Generates the frontify ready pattern json data for the given component
	 * @param {object} component A nitro-component-resolver component instance
	 * @returns {Promise} build promise
	 */
	_buildComponent(component) {
		return this._generateComponentTransferData(component)
			// pattern.json
			.then((transferData) => {
				const relativeComponentDirectory = path.relative(this.options.rootDirectory, component.directory);
				const componentTargetDir = path.resolve(this.options.targetDir, relativeComponentDirectory);
				const patternJson = path.join(componentTargetDir, 'pattern.json');
				return mkdirp(componentTargetDir)
					.then(() => fsWriteFile(patternJson, JSON.stringify(transferData, null, 2)))
					.then(() => transferData);
			})
			// html files
			.then((transferData) => {
				const variationNames = Object.keys(transferData.variations);
				return Promise.all(variationNames.map((variationName) => {
					const variationTemplateSrc = path.resolve(component.directory, variationName);
					const firstAsset = transferData.variations[variationName].assets.html[0];
					const variationTemplateDest = path.resolve(this.options.targetDir, firstAsset);
					return this._compileExample(variationTemplateSrc, variationTemplateDest);
				}));
			});
	}

	/**
	 * Build all components
	 * @returns {Promise} build promise
	 */
	_buildComponents() {
		return this.nitroComponentResolver
			.getComponents()
			.then((components) => Promise.all(
					_.values(components)
					.map((component) => this._buildComponent(component))
				)
			)
			.then(() => this._buildBaseComponent());
	}

	/**
	 * Syncs all components to frontify
	 * @returns {Promise} sync promise
	 */
	_syncComponents() {
		assert(typeof this.options.frontifyOptions === 'object', 'Please specifiy the frontify options');
		return frontifyApi.syncPatterns(_.extend({
			cwd: this.options.targetDir
		}, this.options.frontifyOptions), ['*/*/pattern.json']);
	}

}

module.exports = NitroFrontifyDeployer;
