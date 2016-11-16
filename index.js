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
const html = require('html');

/**
 * An instance of the nitro frontify deployer searches through the given
 * directory, parses the pattern.json files, compiles all examples and
 * transmits the result to frontify
 */
class NitroFrontifyDeployer {
	/**
	 * @param {Object} config Base config
	 */
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
			watch: false,
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
		// Additional assets (javascript css images fonts)
		this.options.assetFolder = config.assetFolder || '';
		this.options.assetFilter = config.assetFilter || ['**/*.*'];
		// Optional name transform
		this.options.componentNameProcessor = config.componentNameProcessor || function (name) {
			return name;
		};
		// Options to deploy the result to frontify
		// see https://www.npmjs.com/package/@frontify/frontify-api#advanced-usage
		this.options.frontifyOptions = config.frontifyOptions || {};
		if (!this.options.frontifyOptions.access_token && process.env.FRONTIFY_ACCESS_TOKEN) {
			this.options.frontifyOptions.access_token = process.env.FRONTIFY_ACCESS_TOKEN;
		}

		this.patternValidator = config.nitroComponentValidator || new NitroComponentValidator();
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
	 * @returns {boolean} success
	 */
	deploy() {
		return this.validateComponents()
			.then(() => this.buildComponents())
			.then(() => Promise.all([
				this._syncAssets(),
				this._syncComponents(),
			]))
			.then((syncResults) => (
				{
					assets: syncResults[0],
					components: syncResults[1],
				}));
	}

	/**
	 * Remove recursivly all files from the target directory
	 * @returns {Promise} promise of the finished cleanning
	 */
	clean() {
		return rimraf(this.options.targetDir);
	}

	/**
	 * Validate a single component
	 * @param {Object} component A nitro-component-resolver component instance
	 * @returns {boolean} success
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
	 * @param {string} componentName the name of the component
	 * @param {string} componentPath the absolute path to the component directory
	 * @param {Object} example A nitro-component-resolver example instance
	 * @returns {Object} variant
	 */
	_generateVariation(componentName, componentPath, example) {
		const name = path.basename(example.filepath).replace(/\..+$/, '');
		const examplePath = path.join(path.relative(this.options.rootDirectory, componentPath), `${name}.html`);
		return {
			name: `${componentName} -- ${name}`,
			assets: {
				html: [
					examplePath.replace(/\\/g, '/'),
				],
			},
		};
	}

	/**
	 * Generates the frontify ready pattern json data for the given component
	 * @param {Object} component A nitro-component-resolver component instance
	 * @returns {Object} transferData
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
		// Allow to postprocess the assets name
		resultJson.name = this.options.componentNameProcessor(resultJson.name, componentName, componenType, componentPath);
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
				// Only sync the main examples
				// main examples have a flag `main = true`
				.filter((example) => example.main)
				.forEach((example) => {
					const exampleName = path.relative(component.directory, example.filepath).replace(/\\/g, '/');
					resultJson.variations[exampleName] = this._generateVariation(resultJson.name, componentPath, example);
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
				let compiled;
				try {
					compiled = this.options.compiler(src.toString(), path.resolve(templateSrc));
					// Execute template
					/* istanbul ignore else */
					if (typeof compiled === 'function') {
						compiled = compiled({});
					}
				} catch (templateCompileError) {
					templateCompileError.message = `"${templateSrc}" ${templateCompileError.message}`;
					throw templateCompileError;
				}
				const pretty = html.prettyPrint(compiled, { indent: 2, unformatted: [] });
				return fsWriteFile(templateDest, pretty);
			})
		);
	}

	/**
	 * Generates the frontify ready pattern json data for the given component
	 * @param {Object} component A nitro-component-resolver component instance
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
	buildComponents() {
		return this.nitroComponentResolver
			.getComponents()
			.then((components) => Promise.all(
					_.values(components)
					.map((component) => this._buildComponent(component))
				)
			);
	}

	/**
	 * Syncs all components to frontify
	 * @returns {Promise} sync promise
	 */
	_syncComponents() {
		assert(typeof this.options.frontifyOptions === 'object', 'Please specifiy the frontify options');
		assert(this.options.frontifyOptions.access_token, 'Please specify a frontify token');
		return frontifyApi.syncPatterns(_.extend({
			cwd: this.options.targetDir,
		}, this.options.frontifyOptions), ['*/*/pattern.json']);
	}

	/**
	 * Syncs assets like images to frontify
	 * @returns {Promise} sync promise
	 */
	_syncAssets() {
		assert(typeof this.options.frontifyOptions === 'object', 'Please specifiy the frontify options');
		assert(this.options.frontifyOptions.access_token, 'Please specify a frontify token');
		if (this.options.assetFolder === '') {
			return Promise.resolve([]);
		}
		return frontifyApi.syncAssets(_.extend({
			cwd: this.options.assetFolder,
		}, this.options.frontifyOptions), this.options.assetFilter);
	}

}

module.exports = NitroFrontifyDeployer;
