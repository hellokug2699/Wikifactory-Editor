// Re-export the YAML surface used by the editor. Bundled into
// app/assets/vendor/yaml.bundle.js by scripts/build-vendor.mjs.
export { parse, parseDocument, stringify, Document, isMap, isSeq, isScalar } from 'yaml';
