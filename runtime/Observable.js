class ObserverSink {

    constructor(observer) {

        this._done = false;
        this._stop = null;
        this._observer = observer;
    }

    _close(done) {

        if (done)
            this._done = true;

        if (this._stop) {

            // Call the termination function and drop the reference to it.
            // We must not call the termination function more than once.
            this._stop.call(undefined);
            this._stop = null;
        }
    }

    next(value) {

        // If the stream if closed, then return a "done" result
        if (this._done)
            return { done: true };

        let result;

        try {

            // Send the next value to the sink
            result = this._observer.next(value);

        } catch (e) {

            // If the observer throws, then close the stream and rethrow the error
            this._close(true);
            throw e;
        }

        // Cleanup if sink is closed
        if (result && result.done)
            this._close(true);

        return result;
    }

    throw(value) {

        // If the stream is closed, throw the error to the caller
        if (this._done)
            throw value;

        this._done = true;

        try {

            // If the sink does not support "throw", then throw the error to the caller
            if (!("throw" in this._observer))
                throw value;

            return this._observer.throw(value);

        } finally {

            this._close();
        }
    }

    return(value) {

        // If the stream is closed, then return a done result
        if (this._done)
            return { done: true };

        this._done = true;

        try {

            // If the sink does not support "return", then return a done result
            if (!("return" in this._observer))
                return { done: true };

            return this._observer.return(value);

        } finally {

            this._close();
        }
    }
}

class Observable {

    constructor(init) {

        // The stream initializer must be a function
        if (typeof init !== "function")
            throw new TypeError("Observable initializer must be a function");

        this._init = init;
    }

    subscribe(observer) {

        // The sink must be an object
        if (Object(observer) !== observer)
            throw new TypeError("Observer must be an object");

        let sink = new ObserverSink(observer),
            stop;

        try {

            // Call the stream initializer
            stop = this._init.call(undefined, sink);

            // The return value must be a function or null or undefined
            if (stop != null && typeof stop !== "function")
                throw new TypeError(stop + " is not a function");

        } catch (e) {

            // If an error occurs during startup, then send an error
            // to the sink and rethrow error to caller.
            sink.throw(e);
            throw e; // TODO:  Should we re-throw here?
        }

        sink._stop = stop;

        // If the stream is already finished, then perform cleanup
        if (sink._done)
            sink._close();

        // Return a cancellation function.  The default cancellation function
        // will simply call return on the observer.
        return _=> { sink._close() };
    }

    forEach(fn) {

        return new Promise((resolve, reject) => {

            this.subscribe({

                next: fn,
                throw: reject,
                return: resolve,
            });
        });
    }

    map(fn) {

        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");

        return new this.constructor[Symbol.species](sink => this.subscribe({

            next(value) {

                try { value = fn(value) }
                catch (e) { return sink.throw(e) }

                return sink.next(value);
            },

            throw(value) { return sink.throw(value) },
            return(value) { return sink.return(value) },
        }));
    }

    filter(fn) {

        if (typeof fn !== "function")
            throw new TypeError(fn + " is not a function");

        return new this.constructor[Symbol.species](sink => this.subscribe({

            next(value) {

                try { if (!fn(value)) return { done: false } }
                catch (e) { return sink.throw(e) }

                return sink.next(value);
            },

            throw(value) { return sink.throw(value) },
            return(value) { return sink.return(value) },
        }));
    }

    [Symbol.observable]() { return this }

    static get [Symbol.species]() { return this }

    async *[Symbol.asyncIterator]() {

        let ready = [], pending = [];

        function send(x) {

            if (pending.length > 0) pending.shift()(x);
            else ready.push(x);
        }

        function next() {

            return ready.length > 0 ?
                ready.shift() :
                new Promise(resolve => pending.push(resolve));
        }

        let cancel = this.subscribe({

            next(value) { send({ type: "next", value }) },
            throw(value) { send({ type: "throw", value }) },
            return(value) { send({ type: "return", value }) },
        });

        try {

            while (true) {

                let result = await next();

                if (result.type == "return") return result.value;
                else if (result.type === "throw") throw result.value;
                else yield result.value;
            }

        } finally {

            cancel();
        }
    }

}

if (!_esdown.global.Observable)
    _esdown.global.Observable = Observable;
