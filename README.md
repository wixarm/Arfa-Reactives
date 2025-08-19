<div align="center">
  <a href="https://armantarhani.ir">
    <picture>
       <img alt="Arfa.js logo" src="/docs/assets/logo.png" height="160" />
    </picture>

  </a>
  <h1>Arfa.js</h1>

</div>

---

## 📖 Overview

**arfa-reactives** is the reactivity system built for the **Arfa.js** framework.
It provides a simple, lightweight way to manage state and lifecycle inside Arfa.js components.

**Arfa.js** uses the arfa-reactives package to provide a familiar but lightweight hook system:

ref(initialValue) → Create reactive state ([getter, setter])

onMounted(fn) → Run logic when a component is mounted

onEffect(fn, deps) → Run side effects when dependencies change

Example Usage:

```bash
import { onMounted, onEffect, ref } from "arfa-reactives";

export default function CounterExample() {
  const [count, setCount] = ref(1);
  const [showMessage, setShowMessage] = ref(true);

  // Run once on mount
  onMounted(() => {
    console.log("Component mounted with initial count:", count());
  });

  // Effect runs when count changes
  onEffect(() => {
    console.log("Count changed:", count());
    return () => console.log("Cleaning up for count:", count());
  }, [count]);

  // Effect runs when showMessage changes
  onEffect(() => {
    console.log("Show message changed:", showMessage());
  }, [showMessage]);

  return (
    <div>
      <h2>Current count: {count()}</h2>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <button onClick={() => setShowMessage(v => !v)}>Toggle Message</button>

      {showMessage() && (
        <p>{count() % 2 === 0 ? "Count is even!" : "Count is odd!"}</p>
      )}
    </div>
  );
}

```
