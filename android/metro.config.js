// Lets the app import the pure-TS desktop modules in ../src/shared (navigation, autocomplete,
// search keywords, clean links). Everything else resolves from android/node_modules.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const shared = path.resolve(__dirname, '../src/shared')
config.watchFolders = [...(config.watchFolders ?? []), shared]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
module.exports = config
