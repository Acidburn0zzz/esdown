function globalObject() {

    try { return global.global } catch (x) {}
    try { return window.window } catch (x) {}
    return null;
}

var arraySlice = Array.prototype.slice,
    hasOwn = Object.prototype.hasOwnProperty,
    staticName = /^__static_/,
    Global = globalObject();

// Returns true if the object has the specified property in
// its prototype chain
function has(obj, name) {

    for (; obj; obj = Object.getPrototypeOf(obj))
        if (hasOwn.call(obj, name))
            return true;

    return false;
}

// Iterates over the descriptors for each own property of an object
function forEachDesc(obj, fn) {

    var names = Object.getOwnPropertyNames(obj), i;

    for (i = 0; i < names.length; ++i)
        fn(names[i], Object.getOwnPropertyDescriptor(obj, names[i]));

    if (Object.getOwnPropertySymbols) {

        names = Object.getOwnPropertySymbols(obj);

        for (i = 0; i < names.length; ++i)
            fn(names[i], Object.getOwnPropertyDescriptor(obj, names[i]));
    }

    return obj;
}

// Performs copy-based inheritance
function inherit(to, from) {

    for (; from; from = Object.getPrototypeOf(from)) {

        forEachDesc(from, (name, desc) => {

            if (!has(to, name))
                Object.defineProperty(to, name, desc);
        });
    }

    return to;
}

// Installs methods on a prototype
function defineMethods(to, from) {

    forEachDesc(from, (name, desc) => {

        if (typeof name !== "string" || !staticName.test(name))
            Object.defineProperty(to, name, desc);
    });
}

// Installs static methods on a constructor
function defineStatic(to, from) {

    forEachDesc(from, (name, desc) => {

        if (typeof name === "string" &&
            staticName.test(name) &&
            typeof desc.value === "object" &&
            desc.value) {

            defineMethods(to, desc.value);
        }
    });
}

// Builds a class
function buildClass(base, def) {

    var parent;

    if (def === void 0) {

        // If no base class is specified, then Object.prototype
        // is the parent prototype
        def = base;
        base = null;
        parent = Object.prototype;

    } else if (base === null) {

        // If the base is null, then then then the parent prototype is null
        parent = null;

    } else if (typeof base === "function") {

        parent = base.prototype;

        // Prototype must be null or an object
        if (parent !== null && Object(parent) !== parent)
            parent = void 0;
    }

    if (parent === void 0)
        throw new TypeError;

    // Generate the method collection, closing over "__super"
    var proto = Object.create(parent),
        props = def(parent, base || Function.prototype),
        constructor = props.constructor;

    if (!constructor)
        throw new Error("No constructor specified");

    // Make constructor non-enumerable
    Object.defineProperty(props, "constructor", {

        enumerable: false,
        writable: true,
        configurable: true,
        value: constructor
    });

    // Set prototype methods
    defineMethods(proto, props);

    // Set constructor's prototype
    constructor.prototype = proto;

    // Set class "static" methods
    defineStatic(constructor, props);

    // "Inherit" from base constructor
    if (base) inherit(constructor, base);

    return constructor;
}

Global._es6now = {

    version: "0.8.9",

    global: Global,

    class: buildClass,

    // Support for iterator protocol
    iter(obj) {

        if (typeof Symbol !== "undefined" && Symbol.iterator && obj[Symbol.iterator] !== void 0)
            return obj[Symbol.iterator]();

        if (Array.isArray(obj))
            return obj.values();

        return obj;
    },

    // Support for computed property names
    computed(obj) {

        var name, desc, i;

        for (i = 1; i < arguments.length; ++i) {

            name = "__$" + (i - 1);
            desc = Object.getOwnPropertyDescriptor(obj, name);

            if (!desc)
                continue;

            Object.defineProperty(obj, arguments[i], desc);
            delete obj[name];
        }

        return obj;
    },

    // Support for tagged templates
    callSite(values, raw) {

        values.raw = raw || values;
        return values;
    },

    // Support for async functions
    async(iterable) {

        try {

            var iter = _es6now.iter(iterable),
                resolver,
                promise;

            promise = new Promise((resolve, reject) => resolver = { resolve, reject });
            resume("next", void 0);
            return promise;

        } catch (x) { return Promise.reject(x) }

        function resume(type, value) {

            if (!(type in iter)) {

                resolver.reject(value);
                return;
            }

            try {

                var result = iter[type](value);

                value = Promise.resolve(result.value);

                if (result.done)
                    value.then(resolver.resolve, resolver.reject);
                else
                    value.then(x => resume("next", x), x => resume("throw", x));

            } catch (x) { resolver.reject(x) }
        }
    },

    // Support for async generators
    asyncGen(waitToken, iterable) {

        var iter = _es6now.iter(iterable),
            state = "paused",
            queue = [];

        return {

            next(val) { return enqueue("next", val) },
            throw(val) { return enqueue("throw", val) },
            return(val) { return enqueue("return", val) }
        };

        function enqueue(type, value) {

            var resolve, reject;
            var promise = new Promise((res, rej) => (resolve = res, reject = rej));

            queue.push({ type, value, resolve, reject });

            if (state === "paused")
                next();

            return promise;
        }

        function next() {

            if (queue.length > 0) {

                state = "running";
                var first = queue[0];
                resume(first.type, first.value);

            } else {

                state = "paused";
            }
        }

        function resume(type, value) {

            if (!(type in iter)) {

                queue.shift().reject(value);
                return;
            }

            try {

                var result = iter[type](value);

                if (result.value === waitToken) {

                    if (result.done)
                        throw new Error("Invalid async generator return");

                    result.value.value.then(
                        x => resume("next", x),
                        x => resume("throw", x));

                    return;

                } else {

                    queue.shift().resolve(result);
                }

            } catch (x) { queue.shift().reject(x) }

            next();
        }
    },

    // Support for spread operations
    spread() {

        return {

            a: [],

            // Add items
            s() {

                for (var i = 0; i < arguments.length; ++i)
                    this.a.push(arguments[i]);

                return this;
            },

            // Add the contents of iterables
            i(list) {

                if (Array.isArray(list)) {

                    this.a.push.apply(this.a, list);

                } else {

                    for (var item of list)
                        this.a.push(item);
                }

                return this;
            }

        };
    },

    // Support for object destructuring
    objd(obj) {

        if (!obj || typeof obj !== "object")
           throw new TypeError;

        return obj;
    },

    // Support for array destructuring
    arrayd(obj) {

        if (Array.isArray(obj)) {

            return {

                at(skip, pos) { return obj[pos] },
                rest(skip, pos) { return obj.slice(pos) }
            };
        }

        var iter = _es6now.iter(obj);

        return {

            at(skip) {

                var r;

                while (skip--)
                    r = iter.next();

                return r.value;
            },

            rest(skip) {

                var a = [], r;

                while (--skip)
                    r = iter.next();

                while (r = iter.next(), !r.done)
                    a.push(r.value);

                return a;
            }
        };
    }

};
