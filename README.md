# Nitro Frontify Deployer

[![npm version](https://badge.fury.io/js/%40namics%2Fnitro-frontify-deployer.svg)](https://badge.fury.io/js/%40namics%2Fnitro-frontify-deployer)
[![Build Status](https://travis-ci.org/namics/nitro-frontify-deployer.svg?branch=master)](https://travis-ci.org/namics/nitro-frontify-deployer)
[![Coverage Status](https://coveralls.io/repos/github/namics/nitro-frontify-deployer/badge.svg?branch=master)](https://coveralls.io/github/namics/nitro-frontify-deployer?branch=master)
[![Codestyle](https://img.shields.io/badge/codestyle-namics-green.svg)](https://github.com/namics/eslint-config-namics)

This build tool generates all necessary artifacts to deploy the entire nitro project into frontify

## Installation

```bash
npm i --save-dev @namics/nitro-frontify-deployer
```

## Usage

```js
const NitroFrontifyDeployer = new require('@namics/nitro-frontify-deployer');
const deployer = new NitroFrontifyDeployer({
    rootDirectory: '/path/to/your/components',
    // This mapping is used to resolve the component type from the folder name
    // e.g. component/atoms/button.js -> type: atom
    mapping: {
        'atoms': 'atom',
        'molecules': 'molecules',
        'helpers': 'atom'
    },
    // The example template compiler
    compiler: require('handlebars'),
    // Destination directory
    targetDir: '/path/to/your/dist/'
});
```
