const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Cloud Functions — отдельный проект со своим package.json и своим
// node_modules. Приложение оттуда ничего не импортирует, а лишнее дерево
// зависимостей Metro всё равно обходит: это лишние секунды на старте и
// вторая копия firebase в резолвере.
const functionsDir = path.resolve(__dirname, 'functions');
config.resolver.blockList = [
  new RegExp(`^${functionsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/].*`),
];

module.exports = config;
