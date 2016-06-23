var assert = require('assert');
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var Ajv = require('ajv');
var schema = require('./schema.json');
var NitroPatternResolver = require('nitro-pattern-resolver');

function NitroFrontifyDeployer(config) {
  assert(config.rootDirectory && fs.existsSync(config.rootDirectory), `Please specify your component rootDirectory folder e.g. { rootDirectory: '/a/path'}`);
  assert(config.mapping && typeof config.mapping === 'object', `Please specifiy the foldername component type mapping e.g. { mapping: {'atoms': 'atom' } }`);
  this.nitroPatternResolver = config.nitroPatternResolver || new NitroPatternResolver({
    rootDirectory: config.rootDirectory,
    examples: true
  });
  this.rootDirectory = config.rootDirectory,
  this.mapping = config.mapping;
}

/**
 * Validates all found components
 *
 * Returns true if all components are valid
 *
 */
NitroFrontifyDeployer.prototype.validateComponents = function () {
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
  if (!this.mapping[typeFolderName]) {
    throw new Error('Folder name "' + typeFolderName + '" is not in the mapping.');
  }
  return valid;
};

/**
 * Generates the frontify variation data for an example file
 */
NitroFrontifyDeployer.prototype._generateVariation = function(component, example) {
  var name = path.basename(example.filename).replace(/\..+$/, '');
  var examplePath = path.join(path.relative(this.rootDirectory, component.directory), name + '.html');
  return {
    name: component.name + ' ' + name,
    'assets': {
      'html': [
        examplePath
      ]
    }
  };
};

/**
 * Generates the frontify ready pattern json data for the given component
 */
NitroFrontifyDeployer.prototype._generateComponentTransferData = function(component) {
  var resultJson = {};
  var frontifyProperties = Object.keys(schema.properties);
  // Copy all known properties
  frontifyProperties.forEach((property) => {
    if (component[property] !== undefined) {
      resultJson[property] = component[property]
    }
  });
  // Add type from folder name
  if (!resultJson.type) {
    resultJson.type = this.mapping[path.basename(path.dirname(path.dirname(component.metaFile)))];
  }
  // Add variations
  resultJson.variations = {};
  return this.nitroPatternResolver.getComponentExamples(component.directory)
    .then((examples) => {
      examples.forEach((example) => {
        resultJson.variations[path.basename(example.filename)] = this._generateVariation(component, example);
      });
      return resultJson;
    });
};

/**
 * Build a single component
 */
NitroFrontifyDeployer.prototype._generateComponentsTransferData = function(component) {
  return this.nitroPatternResolver
    .getComponents()
    .then((components) => {
      return Promise.all(_.values(components)
        .map((component) => this._generateComponentTransferData(component)))
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

};

module.exports = NitroFrontifyDeployer;