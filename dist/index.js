const instances = new Map();
let currentInstance = null;
let globalRerender = null;
const instanceRerenders = new Map();
export function setGlobalRerender(fn) {
    globalRerender = fn;
}
export function registerInstanceRerender(id, fn) {
    instanceRerenders.set(id, fn);
}
export function unregisterInstanceRerender(id) {
    instanceRerenders.delete(id);
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
    unregisterInstanceRerender(id);
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
        return () => {
            if (typeof eff.cleanup === "function") {
                try {
                    eff.cleanup();
                }
                catch { }
                eff.cleanup = undefined;
            }
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
            const getter = (() => {
                try {
                    if (currentInstance) {
                        const rer = instanceRerenders.get(currentInstance);
                        if (rer) {
                            subs.add(rer);
                        }
                    }
                }
                catch { }
                return value;
            });
            getter._isRefGetter = true;
            function setter(val) {
                const next = typeof val === "function" ? val(value) : val;
                const changed = !Object.is(value, next);
                value = next;
                if (changed) {
                    for (const s of Array.from(subs)) {
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
    let value = initial;
    const subs = new Set();
    const getter = (() => value);
    getter._isRefGetter = true;
    function setter(val) {
        const next = typeof val === "function" ? val(value) : val;
        const changed = !Object.is(value, next);
        value = next;
        if (changed) {
            for (const s of Array.from(subs)) {
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
function toGetter(valOrGetter) {
    // If it's already one of our ref getters, pass through.
    if (typeof valOrGetter === "function" && valOrGetter._isRefGetter) {
        return valOrGetter;
    }
    // Wrap a constant value as a getter. Mark it as a "getter" for consistency.
    const constant = (() => valOrGetter);
    constant._isRefGetter = true;
    // Provide no-op subscribe hooks so downstream code can call them safely.
    constant.__subscribe = (_cb) => { };
    constant.__unsubscribe = (_cb) => { };
    return constant;
}
export function createContext(defaultValue) {
    return {
        _id: Symbol("ctx"),
        _defaultGetter: toGetter(defaultValue),
        _stack: [],
    };
}
/**
 * useContext(ctx)
 * - Reads the nearest provided value (or default).
 * - Subscribes this component instance to updates from the underlying ref getter,
 *   so a ref.set(...) in the provider re-renders the consumer.
 */
export function useContext(ctx) {
    var _a, _b;
    if (!currentInstance) {
        // Same ergonomics as React: hooks must be during render
        throw new Error("useContext must be called during component render (set current instance with setCurrentInstance).");
    }
    const rec = instances.get(currentInstance);
    const idx = rec.hookIndex++;
    const existing = rec.hooks[idx];
    // We'll store the resolved getter in the hook slot so it persists across renders.
    if (existing &&
        existing.type === "other" &&
        existing.value) {
        // reuse: we will refresh subscriptions below anyway
    }
    else {
        rec.hooks[idx] = { type: "other", value: undefined };
    }
    const slot = rec.hooks[idx];
    // Resolve the active getter (nearest provider on stack, else default)
    const activeGetter = ctx._stack.length > 0
        ? ctx._stack[ctx._stack.length - 1]
        : ctx._defaultGetter;
    // If the getter identity changed, (re)wire subscriptions.
    const prevGetter = (_a = slot.value) === null || _a === void 0 ? void 0 : _a.getter;
    if (prevGetter !== activeGetter) {
        // Unsubscribe from previous
        if (prevGetter && typeof prevGetter.__unsubscribe === "function") {
            const prevCb = (_b = slot.value) === null || _b === void 0 ? void 0 : _b.cb;
            if (prevCb) {
                try {
                    prevGetter.__unsubscribe(prevCb);
                }
                catch { }
            }
        }
        // Subscribe to the new getter to trigger this instance's rerender when it changes
        const rer = instanceRerenders.get(currentInstance);
        if (rer && typeof activeGetter.__subscribe === "function") {
            const cb = () => {
                try {
                    rer();
                }
                catch { }
            };
            try {
                activeGetter.__subscribe(cb);
            }
            catch { }
            slot.value = { getter: activeGetter, cb };
        }
        else {
            // No subscription available; still store the getter for comparison
            slot.value = { getter: activeGetter, cb: null };
        }
    }
    // Finally return the value
    try {
        return activeGetter();
    }
    catch {
        // If something goes wrong, fall back to default value (non-throwing)
        return ctx._defaultGetter();
    }
}
/**
 * withContext(ctx, valueOrGetter, render)
 * A minimal Provider helper you can use in your renderer:
 *
 * withContext(MyCtx, someRefGetter /* or constant * /, () => {
 *   // render children under this context
 * });
 *
 * - Pushes the provider getter for the duration of render()
 * - If the binding changed (different getter identity vs. previously at this stack level),
 *   it triggers a global re-run so consumers can resubscribe to the new getter.
 */
export function withContext(ctx, valueOrGetter, render) {
    const newGetter = toGetter(valueOrGetter);
    const stack = ctx._stack;
    const prevTop = stack.length ? stack[stack.length - 1] : undefined;
    stack.push(newGetter);
    // If the provider binding itself changed (different getter identity),
    // poke a global re-render so consumers calling useContext will run again
    // and attach to the new getter.
    if (prevTop !== newGetter) {
        try {
            if (globalRerender) {
                globalRerender();
            }
            else {
                triggerEffectsForAllInstances();
            }
        }
        catch { }
    }
    try {
        return render();
    }
    finally {
        // Pop and we're done. Subscriptions to the underlying ref getter persist
        // across renders; consumers will re-attach on the next render pass anyway.
        stack.pop();
    }
}
// how to use
// 1) define a context
// const ThemeCtx = createContext<"light" | "dark">("light");
// 2) somewhere high up in your render tree:
// withContext(ThemeCtx, "dark", () => {
// children rendered here see "dark"
// });
// Or provide a reactive ref so consumers re-render when it changes:
// const [theme, setTheme] = ref<"light" | "dark">("light");
// withContext(ThemeCtx, theme, () => {
// ...children...
// calling setTheme("dark") will re-render consumers that call useContext(ThemeCtx)
// });
// 3) consume in a component:
// function MyButton() {
// const t = useContext(ThemeCtx); // "light" | "dark"
// render using `t`
// }
