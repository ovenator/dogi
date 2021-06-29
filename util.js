

exports.openPromise = function() {
    let resolve, reject;
    const p = new Promise((res, rej) => {
        [resolve, reject] = [res, rej];
    })
    p.resolve = resolve;
    p.reject = reject;
    return p;
}

exports.createLock = function(maxRunning, maxPending) {
    let currentCount = 0;
    const pending = [];

    return {
        acquire() {
            if (pending.length > maxPending) {
                return Promise.reject(new Error('Too many pending requests'));
            }

            const op = exports.openPromise();
            if (currentCount < maxRunning) {
                currentCount ++;
                op.resolve();
            } else {
                pending.push(op);
            }
            return op;
        },
        release() {
            const op = pending.shift();
            currentCount --;
            op.resolve();
        }
    }
}
