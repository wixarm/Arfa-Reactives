const instances = new Map();
let currentInstance = null;
let globalRerender = null;
export function setGlobalRerender(fn) {
    globalRerender = fn;
}
export function createComponentInstance() {
    const id = Symbol("comp");
    instances.set(id, { mounted: [], hooks: [], hookIndex: 0 });
    return id;
}
export function setCurrentInstance(id) {
    currentInstance = id;
    if (id) {
        const rec = instances.get(id);
        if (rec)
            rec.hookIndex = 0;
    }
}
export function clearCurrentInstance() {
    currentInstance = null;
}
export function cleanupComponentInstance(id) {
    const rec = instances.get(id);
    if (!rec)
        return;
    // run effect cleanups
    for (const slot of rec.hooks) {
        if (slot && slot.type === "effect") {
            const eff = slot;
            if (typeof eff.cleanup === "function") {
                try {
                    eff.cleanup();
                }
                catch { }
            }
        }
    }
    instances.delete(id);
}
export function runMounted(id) {
    const rec = instances.get(id);
    if (!rec)
        return;
    for (const cb of rec.mounted) {
        try {
            cb();
        }
        catch (err) {
            console.error(err);
        }
    }
    runEffectsForInstance(id);
}
function getDepValue(dep) {
    try {
        if (typeof dep === "function" && dep._isRefGetter) {
            return dep();
        }
    }
    catch { }
    return dep;
}
function depsChanged(last, next) {
    if (!last)
        return true;
    if (!next)
        return true;
    if (last.length !== next.length)
        return true;
    for (let i = 0; i < next.length; i++) {
        if (!Object.is(last[i], next[i]))
            return true;
    }
    return false;
}
function runEffectsForInstance(id) {
    var _a;
    const rec = instances.get(id);
    if (!rec)
        return;
    for (let i = 0; i < rec.hooks.length; i++) {
        const slot = rec.hooks[i];
        if (!slot || slot.type !== "effect")
            continue;
        const eff = slot;
        const nextDeps = (_a = eff.deps) === null || _a === void 0 ? void 0 : _a.map(getDepValue);
        const changed = depsChanged(eff.lastDeps, nextDeps);
        if (changed) {
            if (typeof eff.cleanup === "function") {
                try {
                    eff.cleanup();
                }
                catch { }
            }
            try {
                const possibleCleanup = eff.effect();
                eff.cleanup =
                    typeof possibleCleanup === "function" ? possibleCleanup : undefined;
            }
            catch (err) {
                console.error(err);
                eff.cleanup = undefined;
            }
            eff.lastDeps = nextDeps;
        }
    }
}
export function triggerEffectsForAllInstances() {
    for (const id of instances.keys()) {
        runEffectsForInstance(id);
    }
}
export function onMounted(cb) {
    if (!currentInstance) {
        throw new Error("onMounted must be called during component render (set current instance with setCurrentInstance).");
    }
    const rec = instances.get(currentInstance);
    rec.mounted.push(cb);
}
export function onEffect(effect, deps) {
    if (!currentInstance) {
        throw new Error("onEffect must be called during component render (set current instance with setCurrentInstance).");
    }
    const rec = instances.get(currentInstance);
    const idx = rec.hookIndex++;
    const existing = rec.hooks[idx];
    if (existing && existing.type === "effect") {
        const eff = existing;
        eff.effect = effect;
        eff.deps = deps ? deps.slice() : undefined;
        // we'll run it during runEffectsForInstance
        return () => {
            if (typeof eff.cleanup === "function") {
                try {
                    eff.cleanup();
                }
                catch { }
                eff.cleanup = undefined;
            }
            // remove effect slot
            rec.hooks[idx] = { type: "other" };
        };
    }
    else {
        const slot = {
            type: "effect",
            effect,
            deps: deps ? deps.slice() : undefined,
            lastDeps: undefined,
            cleanup: undefined,
        };
        rec.hooks[idx] = slot;
        return () => {
            if (typeof slot.cleanup === "function") {
                try {
                    slot.cleanup();
                }
                catch { }
                slot.cleanup = undefined;
            }
            rec.hooks[idx] = { type: "other" };
        };
    }
}
export function ref(initial) {
    // if there's a current instance, store the ref in its hooks (persistent across renders)
    if (currentInstance) {
        const rec = instances.get(currentInstance);
        const idx = rec.hookIndex++;
        const existing = rec.hooks[idx];
        if (existing && existing.type === "ref") {
            const r = existing;
            return [r.getter, r.setter];
        }
        else {
            let value = initial;
            const subs = new Set();
            const getter = (() => value);
            getter._isRefGetter = true;
            function setter(val) {
                const next = typeof val === "function" ? val(value) : val;
                const changed = !Object.is(value, next);
                value = next;
                if (changed) {
                    for (const s of subs) {
                        try {
                            s();
                        }
                        catch { }
                    }
                    if (globalRerender) {
                        try {
                            globalRerender();
                        }
                        catch { }
                    }
                    else {
                        triggerEffectsForAllInstances();
                    }
                }
            }
            getter.__subscribe = (cb) => subs.add(cb);
            getter.__unsubscribe = (cb) => subs.delete(cb);
            const slot = { type: "ref", value, subs, getter, setter };
            rec.hooks[idx] = slot;
            return [getter, setter];
        }
    }
    // fallback: standalone ref (not tied to component instance) — useful for outside usage
    let value = initial;
    const subs = new Set();
    const getter = (() => value);
    getter._isRefGetter = true;
    function setter(val) {
        const next = typeof val === "function" ? val(value) : val;
        const changed = !Object.is(value, next);
        value = next;
        if (changed) {
            for (const s of subs) {
                try {
                    s();
                }
                catch { }
            }
            if (globalRerender) {
                try {
                    globalRerender();
                }
                catch { }
            }
            else {
                triggerEffectsForAllInstances();
            }
        }
    }
    getter.__subscribe = (cb) => subs.add(cb);
    getter.__unsubscribe = (cb) => subs.delete(cb);
    return [getter, setter];
}
