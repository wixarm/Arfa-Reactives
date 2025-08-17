type Cleanup = void | (() => void);

type RefSlot = {
  type: "ref";
  value: any;
  subs: Set<() => void>;
  getter: (() => any) & { _isRefGetter?: true };
  setter: (val: any) => void;
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

const instances = new Map<symbol, InstanceRecord>();
let currentInstance: symbol | null = null;
let globalRerender: (() => void) | null = null;

export function setGlobalRerender(fn: (() => void) | null) {
  globalRerender = fn;
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
  // run effect cleanups
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
    // we'll run it during runEffectsForInstance
    return () => {
      if (typeof eff.cleanup === "function") {
        try {
          eff.cleanup();
        } catch {}
        eff.cleanup = undefined;
      }
      // remove effect slot
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

export function ref<T = any>(
  initial?: T
): [
  (() => T) & { _isRefGetter?: true },
  (val: T | ((prev: T | undefined) => T)) => void
] {
  // if there's a current instance, store the ref in its hooks (persistent across renders)
  if (currentInstance) {
    const rec = instances.get(currentInstance)!;
    const idx = rec.hookIndex++;
    const existing = rec.hooks[idx];
    if (existing && (existing as any).type === "ref") {
      const r = existing as RefSlot;
      return [r.getter, r.setter];
    } else {
      let value = initial as T | undefined;
      const subs = new Set<() => void>();
      const getter = (() => value) as any;
      getter._isRefGetter = true;
      function setter(val: T | ((prev: T | undefined) => T)) {
        const next = typeof val === "function" ? (val as any)(value) : val;
        const changed = !Object.is(value, next);
        value = next;
        if (changed) {
          for (const s of subs) {
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
      (getter as any).__subscribe = (cb: () => void) => subs.add(cb);
      (getter as any).__unsubscribe = (cb: () => void) => subs.delete(cb);
      const slot: RefSlot = { type: "ref", value, subs, getter, setter };
      rec.hooks[idx] = slot;
      return [getter, setter];
    }
  }

  // fallback: standalone ref (not tied to component instance) — useful for outside usage
  let value = initial as T | undefined;
  const subs = new Set<() => void>();
  const getter = (() => value) as any;
  getter._isRefGetter = true;
  function setter(val: T | ((prev: T | undefined) => T)) {
    const next = typeof val === "function" ? (val as any)(value) : val;
    const changed = !Object.is(value, next);
    value = next;
    if (changed) {
      for (const s of subs) {
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
  (getter as any).__subscribe = (cb: () => void) => subs.add(cb);
  (getter as any).__unsubscribe = (cb: () => void) => subs.delete(cb);
  return [getter, setter];
}
