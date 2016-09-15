module.exports = {
  'extends': '@namics/eslint-config/configurations/es6-node.js',
  'parser': 'babel-eslint',
  'plugins': ['import'],
  'rules': {
	  'arrow-parens': 0, // turned of because of false positives when using await shorthands
	  'complexity': 0 // turned of because because we can't reduce the complexity of the constructor
  }
};