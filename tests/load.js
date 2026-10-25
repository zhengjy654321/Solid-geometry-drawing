// 在 Node 中按顺序加载核心模块（与 index.html 中的顺序一致）
const path = require('path');
const files = ['vec', 'exact', 'style', 'scene', 'solids', 'measure', 'commands', 'textvars'];
for (const f of files) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
module.exports = globalThis.SG;
