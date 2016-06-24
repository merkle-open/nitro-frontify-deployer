var assert = require('assert');
var path = require('path');
var denodeify = require('denodeify');
var fs = require('fs');
var _ = require('lodash');
var Ajv = require('ajv');
var schema = require('./schema.json');
var NitroPatternResolver = require('nitro-pattern-resolver');
var mkdirp = denodeify(require('mkdirp'));
var fsWriteFiles = denodeify(fs.writeFile);
var fsReadFile = denodeify(fs.readFile);
var frontifyApi = require('@frontify/frontify-api');

function NitroFrontifyDeployer(config) {
  assert(config.rootDirectory && fs.existsSync(config.rootDirectory), `Please specify your component rootDirectory folder e.g. { rootDirectory: '/a/path'}`);
  assert(config.targetDir && fs.existsSync(config.targetDir), `Please specify your component targetDir folder e.g. { targetDir: '/a/path'}`);
  assert(typeof config.mapping === 'object', `Please specifiy the foldername component type mapping e.g. { mapping: {'atoms': 'atom' } }`);
  assert(typeof config.compiler === 'function', `Please specify a compiler function to compile the example templates`);
  this.nitroPatternResolver = config.nitroPatternResolver || new NitroPatternResolver({
    rootDirectory: config.rootDirectory,
    examples: true
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
  this.options.frontifyOptions = config.frontify;
}

/**
 * Validates all found components
 *
 * Returns true if all components are valid
 *
 */
NitroFrontifyDeployer.prototype.validateComponents = function() {
  return this.nitroPatternResolver
    .getComponents()
    .then((components) => {
      if (Object.keys(components).length === 0) {
        throw new Error('Component validation failed - no components found');
      }
      return !_.values(components)
        .some((component) => !this._validateComponent(component.data, component.metaFile));
    });
};


/**
 * The main method which validates, builds and compiles the entire frontend to frontify
 */
NitroFrontifyDeployer.prototype.deploy = function() {
  return this.validateComponents()
    .then(() => this._buildComponents())
    .then(() => this._syncComponents());
}

/**
 * Validate a single component
 */
NitroFrontifyDeployer.prototype._validateComponent = function(component, name) {
  var ajv = new Ajv();
  var valid = ajv.validate(schema, component);
  if (!valid) {
    throw new Error(ajv.errorsText() + ' in "' + name + '"');
  }
  // Get the type folder name e.g. 'atoms' or 'molecules'
  var typeFolderName = path.basename(path.dirname(path.dirname(name)));
  if (!this.options.mapping[typeFolderName]) {
    throw new Error('Folder name "' + typeFolderName + '" is not in the mapping.');
  }
  return valid;
};

/**
 * Generates the frontify variation data for an example file
 */
NitroFrontifyDeployer.prototype._generateVariation = function(component, example) {
  var name = path.basename(example.filename).replace(/\..+$/, '');
  var examplePath = path.join(path.relative(this.options.rootDirectory, component.directory), name + '.html');
  return {
    name: component.name + ' ' + name,
    'assets': {
      'html': [
        examplePath.replace(/\\/g, '/')
      ]
    }
  };
};

/**
 * Generates the frontify ready pattern json data for the given component
 */
NitroFrontifyDeployer.prototype._generateComponentTransferData = function(component) {
  var resultJson = {};
  var sourceJson = component.data;
  var frontifyProperties = Object.keys(schema.properties);
  // Copy all known properties
  frontifyProperties.forEach((property) => {
    if (sourceJson[property] !== undefined) {
      resultJson[property] = sourceJson[property]
    }
  });
  // Add type from folder name
  if (!resultJson.type) {
    resultJson.type = this.options.mapping[path.basename(path.dirname(path.dirname(component.metaFile)))];
  }
  // Add variations
  resultJson.variations = {};
  return this.nitroPatternResolver.getComponentExamples(component.directory)
    .then((examples) => {
      examples.forEach((example) => {
        var exampleName = path.relative(component.directory, example.filename).replace(/\\/g, '/');
        resultJson.variations[exampleName] = this._generateVariation(component, example);
      });
      return resultJson;
    });
};

/**
 * Compile the example
 */
NitroFrontifyDeployer.prototype._compileExample = function(templateSrc, templateDest) {
  return mkdirp(path.dirname(templateDest)).then(() => {
    return fsReadFile(templateSrc).then((src) => {
      var compiled = this.options.compiler(src.toString());
      // Execute template
      if (typeof compiled === 'function') {
        compiled = compiled({});
      }
      return fsWriteFiles(templateDest, compiled);
    });
  });
};

/**
 * Generates the frontify ready pattern json data for the given component
 */
NitroFrontifyDeployer.prototype._buildComponent = function(component) {
  return this._generateComponentTransferData(component)
    // pattern.json
    .then((transferData) => {
      var componentTargetDir = path.resolve(this.options.targetDir, path.relative(this.options.rootDirectory, component.directory));
      return mkdirp(componentTargetDir)
        .then(() => fsWriteFiles(path.join(componentTargetDir, 'pattern.json'), JSON.stringify(transferData, null, 2)))
        .then(() => transferData);
    })
    // html files
    .then((transferData) => {
      var variationNames = Object.keys(transferData.variations);
      return Promise.all(variationNames.map((variationName) => {
        var variationTemplateSrc = path.resolve(component.directory, variationName);
        var variationTemplateDest = path.resolve(this.options.targetDir, transferData.variations[variationName].assets.html[0]);
        return this._compileExample(variationTemplateSrc, variationTemplateDest);
      }));
    });
};

/**
 * Build all components
 */
NitroFrontifyDeployer.prototype._buildComponents = function() {
  return this.nitroPatternResolver
    .getComponents()
    .then((components) => {
      return Promise.all(_.values(components)
        .map((component) => this._buildComponent(component)))
    });
};

/**
 * Syncs all components to frontify
 */
NitroFrontifyDeployer.prototype._syncComponents = function(component) {
  assert(typeof this.options.frontifyOptions === 'object', `Please specifiy the frontify options`);
  return frontify.syncPatterns(_.extend({
    cwd: this.options.targetDir
  }, this.options.frontifyOptions), ['*/*.json']);
};

module.exports = NitroFrontifyDeployer;