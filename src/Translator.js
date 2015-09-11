import { Runtime } from "./Runtime.js";
import { replaceText } from "./Replacer.js";
import { isLegacyScheme, removeScheme } from "./Schema.js";

const SIGNATURE = "/*=esdown=*/";

const WRAP_CALLEE = "(function(fn, name) { " +

    // CommonJS:
    "if (typeof exports !== 'undefined') " +
        "fn(require, exports, module); " +

    // DOM global module:
    "else if (typeof self !== 'undefined') " +
        "fn(function() { return {} }, name === '*' ? self : (self[name] = {}), {}); " +

"})";

const MODULE_IMPORT_RUNTIME =
"function __load(p, l) { " +
    "module.__es6 = !l; " +
    "var e = require(p); " +
    "if (e && e.constructor !== Object) " +
        "e = Object.create(e, { 'default': { value: e } }); " +
    "return e; " +
"} ";

const MODULE_IMPORT =
"function __import(e) { " +
    "return !e || e.constructor === Object ? e : " +
        "Object.create(e, { 'default': { value: e } }); " +
"} ";

function sanitize(text) {

    // From node/lib/module.js/Module.prototype._compile
    text = text.replace(/^\#\!.*/, '');

    // From node/lib/module.js/stripBOM
    if (text.charCodeAt(0) === 0xFEFF)
        text = text.slice(1);

    return text;
}

function wrapRuntimeAPI() {

    let text = replaceText(Runtime.API, { module: true }).output;

    // Wrap runtime library in an IIFE, exporting into the _esdown variable
    return "var _esdown = {}; (function(exports) {\n\n" + text + "\n\n})(_esdown);\n\n";
}

function wrapPolyfillModules() {

    return Object.keys(Runtime).filter(key => key !== "API").map(key => {

        let text = replaceText(Runtime[key]).output;

        // Wrap each polyfill module in an IIFE
        return "(function() {\n\n" + text + "\n\n})();\n\n";

    }).join("");
}

export function translate(input, options = {}) {

    input = sanitize(input);

    // Node modules are wrapped inside of a function expression, which allows
    // return statements
    if (options.functionContext)
        input = "(function(){" + input + "})";

    let result = replaceText(input, options),
        output = result.output;

    // Remove function expression wrapper for node-modules
    if (options.functionContext)
        output = output.slice(12, -2);

    if (options.runtime) {

        if (options.polyfill)
            output = "\n" + wrapPolyfillModules() + "\n" + output;

        output = wrapRuntimeAPI() + "\n" + output;
    }

    if (options.wrap) {

        // Doesn't make sense to create a module wrapper for a non-module
        if (!options.module)
            throw new Error("Cannot wrap a non-module");

        output = wrapModule(output, result.imports, options);
    }

    return output;
}

export function wrapModule(text, imports, options = {}) {

    let header = "'use strict'; ";

    header += options.runtimeImports ? MODULE_IMPORT_RUNTIME : MODULE_IMPORT;

    let requires = imports.map(dep => {

        let url = dep.url,
            legacy = isLegacyScheme(url),
            ident = dep.identifier;

        if (legacy)
            url = removeScheme(url);

        if (options.runtimeImports) {

            let flag = legacy ? "1" : "0";
            return `${ ident } = __load(${ JSON.stringify(url) }, ${ flag })`;
        }

        return `${ ident } = __import(require(${ JSON.stringify(url) }))`;
    });

    if (requires.length > 0)
        header += "var " + requires.join(", ") + "; ";

    if (!options.global)
        return SIGNATURE + header + text;

    return SIGNATURE + WRAP_CALLEE + "(" +
        "function(require, exports, module) { " + header + text + "\n\n}, " +
        JSON.stringify(options.global) +
    ");";
}

export function isWrapped(text) {

    return text.indexOf(SIGNATURE) === 0;
}
