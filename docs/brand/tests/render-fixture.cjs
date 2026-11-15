'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.woff2':'font/woff2' };
function resource(source, directory) {
  if (/^(data:|https?:|#)/.test(source)) return source;
  const file = path.resolve(directory, source.split('#')[0]);
  if (!file.startsWith(root + path.sep)) throw new Error('Fixture resource must stay inside the brand kit: ' + source);
  return `data:${types[path.extname(file)] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;
}
function css(file) {
  return fs.readFileSync(file,'utf8').replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g, (_, source) => `url("${resource(source,path.dirname(file))}")`);
}
function bundle(relative) {
  const file = path.resolve(root,relative); const dir = path.dirname(file);
  let html = fs.readFileSync(file,'utf8');
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_,source) => `<style>${css(path.resolve(dir,source))}</style>`);
  html = html.replace(/(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/g, (_,prefix,quote,source) => prefix+quote+resource(source,dir)+quote);
  html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_,source) => {
    let code = fs.readFileSync(path.resolve(dir,source),'utf8');
    code = code.replace(/(['"])((?:\.\.\/)+assets\/[^'"]+\.(?:png|svg))\1/g, (_,q,asset) => JSON.stringify(resource(asset,dir)));
    return `<script>document.addEventListener('DOMContentLoaded',()=>{${code.replace(/<\/script/gi,'<\\/script')}\n});</script>`;
  });
  return html;
}
module.exports = { bundle, root };
