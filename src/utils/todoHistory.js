import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const applyNestedUpdate = (target, key, value) => {
  if (typeof key !== "string" || !key.includes(".")) {
    return { ...target, [key]: value };
  }

  const [head, ...rest] = key.split(".");
  const cloned = { ...target };
  const nested = { ...(cloned[head] || {}) };

  if (rest.length === 1) {
    nested[rest[0]] = value;
  } else if (rest.length > 1) {
    let cursor = nested;
    for (let i = 0; i < rest.length; i++) {
      const part = rest[i];
      if (i === rest.length - 1) {
        cursor[part] = value;
      } else {
        cursor[part] = { ...(cursor[part] || {}) };
        cursor = cursor[part];
      }
    }
  }

  cloned[head] = nested;
  return cloned;
};

const buildAfterSnapshot = (before = {}, updates = {}) => {
  return Object.entries(updates).reduce((acc, [key, value]) => {
    return applyNestedUpdate(acc, key, value);
  }, { ...before });
};

export const logTodoHistory = async (
  todo,
  updates = {},
  context = "unknown"
) => {
  if (!todo?.id) return;

  const beforeSnapshot = { ...todo };
  const afterSnapshot = buildAfterSnapshot(beforeSnapshot, updates);

  await addDoc(collection(db, "todos", todo.id, "history"), {
    context,
    before: beforeSnapshot,
    after: afterSnapshot,
    changedFields: Object.keys(updates || {}),
    createdAt: serverTimestamp(),
  });
};
