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
    if (rec) rec.hookIndex = 0;
  }
}

export function clearCurrentInstance() {
  currentInstance = null;
}

export function cleanupComponentInstance(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const slot of rec.hooks) {
    if (slot && slot.type === "effect") {
      const eff = slot;
      if (typeof eff.cleanup === "function") {
        try {
          eff.cleanup();
        } catch {}
      }
    }
  }
  instances.delete(id);
  unregisterInstanceRerender(id);
}

export function runMounted(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const cb of rec.mounted) {
    try {
      cb();
    } catch (err) {
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
  } catch {}
  return dep;
}

function depsChanged(last, next) {
  if (!last) return true;
  if (!next) return true;
  if (last.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (!Object.is(last[i], next[i])) return true;
  }
  return false;
}

function runEffectsForInstance(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (let i = 0; i < rec.hooks.length; i++) {
    const slot = rec.hooks[i];
    if (!slot || slot.type !== "effect") continue;
    const eff = slot;
    const nextDeps = eff.deps?.map(getDepValue);
    const changed = depsChanged(eff.lastDeps, nextDeps);
    if (changed) {
      if (typeof eff.cleanup === "function") {
        try {
          eff.cleanup();
        } catch {}
      }
      try {
        const possibleCleanup = eff.effect();
        eff.cleanup =
          typeof possibleCleanup === "function" ? possibleCleanup : undefined;
      } catch (err) {
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
    throw new Error(
      "onMounted must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance);
  rec.mounted.push(cb);
}

export function onEffect(effect, deps) {
  if (!currentInstance) {
    throw new Error(
      "onEffect must be called during component render (set current instance with setCurrentInstance)."
    );
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
        } catch {}
        eff.cleanup = undefined;
      }
      rec.hooks[idx] = { type: "other" };
    };
  } else {
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
        } catch {}
        slot.cleanup = undefined;
      }
      rec.hooks[idx] = { type: "other" };
    };
  }
}

/* ------------------------------
   PERSISTENCE PLUMBING (opt-in)
--------------------------------*/
const persistUpdaters = new Map(); // key -> (val, cause?) => void
let storageListenerReady = false;

function getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      return window.localStorage;
  } catch {}
  return null;
}

function ensureStorageListener() {
  if (storageListenerReady) return;
  if (typeof window === "undefined") return;
  try {
    window.addEventListener("storage", (e) => {
      if (!e.key) return;
      const upd = persistUpdaters.get(e.key);
      if (!upd) return;
      try {
        const raw = e.newValue;
        if (raw == null) return;
        const env = JSON.parse(raw); // { v?: number, d: any }
        upd(env.d, "external"); // do not echo back into storage
      } catch {}
    });
    storageListenerReady = true;
  } catch {}
}

/* ---------------------------------
   ref(initial, { persist? })  (OPT-IN)
---------------------------------- */
export function ref(initial, options) {
  const persist = options && options.persist ? options.persist : null;

  function initPersistence(getter, baseSetter) {
    if (!persist) return baseSetter;

    const storage = getStorage();
    const fullKey = `${persist.keyPrefix ?? "arfa:"}${persist.key}`;
    const ser =
      persist.serialize ??
      ((v) => JSON.stringify({ v: persist.version, d: v }));
    const deser =
      persist.deserialize ??
      ((s) => {
        const env = JSON.parse(s); // { v?: number, d: any }
        if (persist.version != null && env.v !== persist.version) {
          throw new Error("version mismatch");
        }
        return env.d;
      });

    // hydrate once
    if (storage) {
      try {
        const raw = storage.getItem(fullKey);
        if (raw != null) {
          const val = deser(raw);
          baseSetter(() => val); // set without echoing immediately
        } else {
          try {
            const cur = getter();
            storage.setItem(fullKey, ser(cur));
          } catch {}
        }
      } catch {}
    }

    // wrap setter to also write to storage (unless external)
    const wrapped = (next, cause) => {
      baseSetter(next);
      if (cause === "external") return;
      if (storage) {
        try {
          const value = typeof next === "function" ? next(getter()) : next;
          storage.setItem(fullKey, ser(value));
        } catch {}
      }
    };

    // cross-tab sync
    if (persist.sync !== false && storage) {
      persistUpdaters.set(fullKey, (val, cause) => {
        wrapped(() => val, cause);
        try {
          triggerEffectsForAllInstances();
        } catch {}
      });
      ensureStorageListener();
    }

    // public setter that hides the "cause"
    return (v) => wrapped(v);
  }

  // ====== INSTANCE PATH (hook) ======
  if (currentInstance) {
    const rec = instances.get(currentInstance);
    const idx = rec.hookIndex++;
    const existing = rec.hooks[idx];

    if (existing && existing.type === "ref") {
      const r = existing;
      // If persist was requested now but not initialized before, set up once.
      if (persist && !r.__persistInitialized) {
        const persistedSetter = initPersistence(r.getter, r.setter);
        r.setter = persistedSetter;
        r.__persistInitialized = true;
      }
      return [r.getter, r.setter];
    } else {
      let value = initial;
      const subs = new Set();
      const getter = () => {
        try {
          if (currentInstance) {
            const rer = instanceRerenders.get(currentInstance);
            if (rer) subs.add(rer);
          }
        } catch {}
        return value;
      };
      getter._isRefGetter = true;

      function baseSetter(val) {
        const next = typeof val === "function" ? val(value) : val;
        const changed = !Object.is(value, next);
        value = next;
        if (changed) {
          for (const s of Array.from(subs)) {
            try {
              s();
            } catch {}
          }
          if (globalRerender) {
            try {
              globalRerender();
            } catch {}
          } else {
            triggerEffectsForAllInstances();
          }
        }
      }

      const setter = initPersistence(getter, baseSetter);

      getter.__subscribe = (cb) => subs.add(cb);
      getter.__unsubscribe = (cb) => subs.delete(cb);

      const slot = { type: "ref", value, subs, getter, setter };
      if (persist) slot.__persistInitialized = true;

      rec.hooks[idx] = slot;
      return [getter, setter];
    }
  }

  // ====== NON-INSTANCE PATH (standalone store) ======
  let value = initial;
  const subs = new Set();
  const getter = () => value;
  getter._isRefGetter = true;

  function baseSetter(val) {
    const next = typeof val === "function" ? val(value) : val;
    const changed = !Object.is(value, next);
    value = next;
    if (changed) {
      for (const s of Array.from(subs)) {
        try {
          s();
        } catch {}
      }
      if (globalRerender) {
        try {
          globalRerender();
        } catch {}
      } else {
        triggerEffectsForAllInstances();
      }
    }
  }

  const setter = initPersistence(getter, baseSetter);

  getter.__subscribe = (cb) => subs.add(cb);
  getter.__unsubscribe = (cb) => subs.delete(cb);

  return [getter, setter];
}

/* ------------------------------
   Context API
--------------------------------*/
function toGetter(valOrGetter) {
  // If it's already one of our ref getters, pass through.
  if (typeof valOrGetter === "function" && valOrGetter._isRefGetter) {
    return valOrGetter;
  }
  // Wrap a constant value as a getter. Mark it as a "getter" for consistency.
  const constant = () => valOrGetter;
  constant._isRefGetter = true;
  // Provide no-op subscribe hooks so downstream code can call them safely.
  constant.__subscribe = (_cb) => {};
  constant.__unsubscribe = (_cb) => {};
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
  if (!currentInstance) {
    throw new Error(
      "useContext must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance);
  const idx = rec.hookIndex++;
  const existing = rec.hooks[idx];

  if (existing && existing.type === "other" && existing.value) {
    // reuse; we refresh subscriptions below if needed
  } else {
    rec.hooks[idx] = { type: "other", value: undefined };
  }

  const slot = rec.hooks[idx];

  const activeGetter =
    ctx._stack.length > 0
      ? ctx._stack[ctx._stack.length - 1]
      : ctx._defaultGetter;

  const prevGetter = slot.value && slot.value.getter;
  if (prevGetter !== activeGetter) {
    if (prevGetter && typeof prevGetter.__unsubscribe === "function") {
      const prevCb = slot.value ? slot.value.cb : null;
      if (prevCb) {
        try {
          prevGetter.__unsubscribe(prevCb);
        } catch {}
      }
    }

    const rer = instanceRerenders.get(currentInstance);
    if (rer && typeof activeGetter.__subscribe === "function") {
      const cb = () => {
        try {
          rer();
        } catch {}
      };
      try {
        activeGetter.__subscribe(cb);
      } catch {}
      slot.value = { getter: activeGetter, cb };
    } else {
      slot.value = { getter: activeGetter, cb: null };
    }
  }

  try {
    return activeGetter();
  } catch {
    return ctx._defaultGetter();
  }
}

/**
 * withContext(ctx, valueOrGetter, render)
 *
 * - Pushes the provider getter for the duration of render()
 * - If the binding changed (different getter identity),
 *   it triggers a global re-run so consumers can resubscribe to the new getter.
 */
export function withContext(ctx, valueOrGetter, render) {
  const newGetter = toGetter(valueOrGetter);
  const stack = ctx._stack;

  const prevTop = stack.length ? stack[stack.length - 1] : undefined;
  stack.push(newGetter);

  if (prevTop !== newGetter) {
    try {
      if (globalRerender) {
        globalRerender();
      } else {
        triggerEffectsForAllInstances();
      }
    } catch {}
  }

  try {
    return render();
  } finally {
    stack.pop();
  }
}
