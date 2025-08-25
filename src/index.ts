type Cleanup = void | (() => void);

/* =========================
   Hook & Instance Types
========================= */

type RefSlot = {
  type: "ref";
  value: any;
  subs: Set<() => void>;
  getter: (() => any) & { _isRefGetter?: true };
  setter: (val: any) => void;
  // internal flag when persistence was initialized
  __persistInitialized?: boolean;
};

type EffectSlot = {
  type: "effect";
  effect: () => Cleanup;
  deps?: any[];
  lastDeps?: any[] | undefined;
  cleanup?: (() => void) | void;
};

type HookSlot = RefSlot | EffectSlot | { type: "other"; value?: any };

type InstanceRecord = {
  mounted: Array<() => void>;
  hooks: HookSlot[];
  hookIndex: number;
};

/* =========================
   Core Runtime
========================= */

const instances = new Map<symbol, InstanceRecord>();
let currentInstance: symbol | null = null;
let globalRerender: (() => void) | null = null;

const instanceRerenders = new Map<symbol, () => void>();

export function setGlobalRerender(fn: (() => void) | null) {
  globalRerender = fn;
}

export function registerInstanceRerender(id: symbol, fn: () => void) {
  instanceRerenders.set(id, fn);
}

export function unregisterInstanceRerender(id: symbol) {
  instanceRerenders.delete(id);
}

export function createComponentInstance(): symbol {
  const id = Symbol("comp");
  instances.set(id, { mounted: [], hooks: [], hookIndex: 0 });
  return id;
}

export function setCurrentInstance(id: symbol | null) {
  currentInstance = id;
  if (id) {
    const rec = instances.get(id);
    if (rec) rec.hookIndex = 0;
  }
}

export function clearCurrentInstance() {
  currentInstance = null;
}

export function cleanupComponentInstance(id: symbol) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const slot of rec.hooks) {
    if (slot && (slot as EffectSlot).type === "effect") {
      const eff = slot as EffectSlot;
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

export function runMounted(id: symbol) {
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

function getDepValue(dep: any) {
  try {
    if (typeof dep === "function" && (dep as any)._isRefGetter) {
      return dep();
    }
  } catch {}
  return dep;
}

function depsChanged(last?: any[], next?: any[]) {
  if (!last) return true;
  if (!next) return true;
  if (last.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (!Object.is(last[i], next[i])) return true;
  }
  return false;
}

function runEffectsForInstance(id: symbol) {
  const rec = instances.get(id);
  if (!rec) return;
  for (let i = 0; i < rec.hooks.length; i++) {
    const slot = rec.hooks[i];
    if (!slot || (slot as any).type !== "effect") continue;
    const eff = slot as EffectSlot;
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

export function onMounted(cb: () => void) {
  if (!currentInstance) {
    throw new Error(
      "onMounted must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance)!;
  rec.mounted.push(cb);
}

export function onEffect(effect: () => Cleanup, deps?: any[]) {
  if (!currentInstance) {
    throw new Error(
      "onEffect must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance)!;
  const idx = rec.hookIndex++;
  const existing = rec.hooks[idx];
  if (existing && (existing as any).type === "effect") {
    const eff = existing as EffectSlot;
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
    const slot: EffectSlot = {
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

/* =========================
   Persistence (opt-in)
========================= */

type PersistOptions<T> = {
  key: string; // required
  version?: number;
  keyPrefix?: string; // default "arfa:"
  serialize?: (v: T) => string; // default JSON envelope {v,d}
  deserialize?: (s: string) => T; // default JSON envelope reader
  sync?: boolean; // cross-tab via storage event (default true)
};

type RefOptions<T> = { persist?: PersistOptions<T> };
type PersistEnvelope = { v?: number; d: any };

const persistUpdaters = new Map<
  string,
  (val: any, cause?: "external") => void
>();
let storageListenerReady = false;

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      return window.localStorage;
  } catch {}
  return null;
}

function ensureStorageListener() {
  if (storageListenerReady || typeof window === "undefined") return;
  try {
    window.addEventListener("storage", (e: StorageEvent) => {
      if (!e.key) return;
      const update = persistUpdaters.get(e.key);
      if (!update) return;
      try {
        if (e.newValue == null) return;
        const env: PersistEnvelope = JSON.parse(e.newValue);
        update(env.d, "external");
      } catch {}
    });
    storageListenerReady = true;
  } catch {}
}

/* =========================
   ref() with overloads
========================= */

// Overload: legacy call (no options)
export function ref<T = any>(
  initial?: T
): [
  (() => T) & { _isRefGetter?: true },
  (val: T | ((prev: T | undefined) => T)) => void
];

// Overload: with options (persist)
export function ref<T = any>(
  initial: T | undefined,
  options: RefOptions<T>
): [
  (() => T) & { _isRefGetter?: true },
  (val: T | ((prev: T | undefined) => T)) => void
];

// Implementation
export function ref<T = any>(
  initial?: T,
  options?: RefOptions<T>
): [
  (() => T) & { _isRefGetter?: true },
  (val: T | ((prev: T | undefined) => T)) => void
] {
  const persist = options?.persist;

  // set up persistence around a base setter + getter
  function initPersistence(
    getter: (() => T) & { _isRefGetter?: true },
    baseSetter: (val: T | ((prev: T | undefined) => T)) => void
  ): (val: T | ((prev: T | undefined) => T)) => void {
    if (!persist) return baseSetter;

    const storage = getStorage();
    const fullKey = `${persist.keyPrefix ?? "arfa:"}${persist.key}`;
    const ser =
      persist.serialize ??
      ((v: T) =>
        JSON.stringify({ v: persist.version, d: v } as PersistEnvelope));
    const deser =
      persist.deserialize ??
      ((s: string) => {
        const env: PersistEnvelope = JSON.parse(s);
        if (persist.version != null && env.v !== persist.version) {
          throw new Error("version mismatch");
        }
        return env.d as T;
      });

    // hydrate once
    if (storage) {
      try {
        const raw = storage.getItem(fullKey);
        if (raw != null) {
          const val = deser(raw);
          baseSetter(val); // pass value directly
        } else {
          try {
            const cur = getter();
            storage.setItem(fullKey, ser(cur));
          } catch {}
        }
      } catch {}
    }

    // wrap setter to write to storage (unless external)
    const wrapped = (next: any, cause?: "external") => {
      baseSetter(next);

      if (cause === "external") return;

      if (storage) {
        try {
          const valueToStore = getter();
          storage.setItem(fullKey, ser(valueToStore));
        } catch {}
      }
    };

    // cross-tab sync
    if (persist.sync !== false && storage) {
      persistUpdaters.set(fullKey, (val, cause) => {
        wrapped(val, cause); // pass value directly
        try {
          triggerEffectsForAllInstances();
        } catch {}
      });
      ensureStorageListener();
    }

    // public setter
    return (v: any) => wrapped(v);
  }

  // ===== Hook path (component instance) =====
  if (currentInstance) {
    const rec = instances.get(currentInstance)!;
    const idx = rec.hookIndex++;
    const existing = rec.hooks[idx];

    if (existing && (existing as any).type === "ref") {
      const r = existing as RefSlot;
      // lazily init persistence exactly once per hook slot
      if (persist && !r.__persistInitialized) {
        r.setter = initPersistence(r.getter as any, r.setter as any) as any;
        r.__persistInitialized = true;
      }
      return [r.getter, r.setter];
    } else {
      let value = initial as T | undefined;
      const subs = new Set<() => void>();
      const getter = (() => {
        try {
          if (currentInstance) {
            const rer = instanceRerenders.get(currentInstance);
            if (rer) {
              subs.add(rer);
            }
          }
        } catch {}
        return value;
      }) as any;
      getter._isRefGetter = true;

      function baseSetter(val: T | ((prev: T | undefined) => T)) {
        const next = typeof val === "function" ? (val as any)(value) : val;
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

      (getter as any).__subscribe = (cb: () => void) => subs.add(cb);
      (getter as any).__unsubscribe = (cb: () => void) => subs.delete(cb);

      const slot: RefSlot = { type: "ref", value, subs, getter, setter };
      if (persist) slot.__persistInitialized = true;

      rec.hooks[idx] = slot;
      return [getter, setter];
    }
  }

  // ===== Standalone path (outside render) =====
  let value = initial as T | undefined;
  const subs = new Set<() => void>();
  const getter = (() => value) as any;
  getter._isRefGetter = true;

  function baseSetter(val: T | ((prev: T | undefined) => T)) {
    const next = typeof val === "function" ? (val as any)(value) : val;
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

  (getter as any).__subscribe = (cb: () => void) => subs.add(cb);
  (getter as any).__unsubscribe = (cb: () => void) => subs.delete(cb);
  return [getter, setter];
}

/* =========================
   Context API
========================= */

type Getter<T> = (() => T) & {
  _isRefGetter?: true;
  __subscribe?: (cb: () => void) => void;
  __unsubscribe?: (cb: () => void) => void;
};

export type Context<T> = {
  _id: symbol;
  _defaultGetter: Getter<T>;
  _stack: Getter<T>[];
};

function toGetter<T>(valOrGetter: T | Getter<T>): Getter<T> {
  // If it's already one of our ref getters, pass through.
  if (typeof valOrGetter === "function" && (valOrGetter as any)._isRefGetter) {
    return valOrGetter as Getter<T>;
  }
  // Wrap a constant value as a getter. Mark it as a "getter" for consistency.
  const constant = (() => valOrGetter) as Getter<T>;
  (constant as any)._isRefGetter = true;
  // Provide no-op subscribe hooks so downstream code can call them safely.
  (constant as any).__subscribe = (_cb: () => void) => {};
  (constant as any).__unsubscribe = (_cb: () => void) => {};
  return constant;
}

export function createContext<T>(defaultValue: T): Context<T> {
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
export function useContext<T>(ctx: Context<T>): T {
  if (!currentInstance) {
    // Same ergonomics as React: hooks must be during render
    throw new Error(
      "useContext must be called during component render (set current instance with setCurrentInstance)."
    );
  }

  const rec = instances.get(currentInstance)!;
  const idx = rec.hookIndex++;
  const existing = rec.hooks[idx];

  // We'll store the resolved getter in the hook slot so it persists across renders.
  if (
    existing &&
    (existing as any).type === "other" &&
    (existing as any).value
  ) {
    // reuse: we will refresh subscriptions below anyway
  } else {
    rec.hooks[idx] = { type: "other", value: undefined };
  }

  const slot = rec.hooks[idx] as { type: "other"; value?: any };

  // Resolve the active getter (nearest provider on stack, else default)
  const activeGetter =
    ctx._stack.length > 0
      ? ctx._stack[ctx._stack.length - 1]
      : ctx._defaultGetter;

  // If the getter identity changed, (re)wire subscriptions.
  const prevGetter: Getter<T> | undefined = slot.value?.getter;
  if (prevGetter !== activeGetter) {
    // Unsubscribe from previous
    if (prevGetter && typeof prevGetter.__unsubscribe === "function") {
      const prevCb = slot.value?.cb;
      if (prevCb) {
        try {
          prevGetter.__unsubscribe!(prevCb);
        } catch {}
      }
    }

    // Subscribe to the new getter to trigger this instance's rerender when it changes
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
      // No subscription available; still store the getter for comparison
      slot.value = { getter: activeGetter, cb: null };
    }
  }

  // Finally return the value
  try {
    return activeGetter();
  } catch {
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
export function withContext<T, R>(
  ctx: Context<T>,
  valueOrGetter: T | Getter<T>,
  render: () => R
): R {
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
      } else {
        triggerEffectsForAllInstances();
      }
    } catch {}
  }

  try {
    return render();
  } finally {
    // Pop and we're done. Subscriptions to the underlying ref getter persist
    // across renders; consumers will re-attach on the next render pass anyway.
    stack.pop();
  }
}

/* =========================
   Usage (example)
========================= */
// const [theme, setTheme] = ref<"light" | "dark">("light", {
//   persist: { key: "theme", version: 1, keyPrefix: "arfa:", sync: true }
// });
