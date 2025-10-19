import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

export const jstDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const toMinutes = (value) => {
  const num = Math.round(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
};

const clampNonNegative = (value) => {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
};

export async function applyLogDiff({
  todoId,
  dateKey,
  newValue = 0,
  oldValue = 0,
  actualTotalMinutes = 0,
  source = "manual",
  trigger = "log-editor",
}) {
  if (!todoId || !dateKey) throw new Error("todoId と dateKey は必須です");

  const sanitizedNew = clampNonNegative(Math.round(Number(newValue) || 0));
  const sanitizedOld = clampNonNegative(Math.round(Number(oldValue) || 0));
  const delta = sanitizedNew - sanitizedOld;

  if (delta === 0) {
    return { delta: 0, nextTotal: Number(actualTotalMinutes) || 0 };
  }

  const currentTotal = clampNonNegative(Math.round(Number(actualTotalMinutes) || 0));
  const nextTotal = currentTotal + delta;
  if (nextTotal < 0) {
    throw new Error("累積実績が負の値になるため保存できません。");
  }

  await updateDoc(doc(db, "todos", todoId), {
    actualTotalMinutes: increment(delta),
    [`actualLogs.${dateKey}`]: increment(delta),
  });

  await addDoc(collection(db, "todos", todoId, "sessions"), {
    date: dateKey,
    minutes: sanitizedNew,
    source,
    trigger,
    createdAt: serverTimestamp(),
  });

  return { delta, nextTotal };
}

export const computeNewTotalForAddition = ({
  existingValue = 0,
  additionalValue = 0,
}) => {
  const base = toMinutes(existingValue);
  const extra = toMinutes(additionalValue);
  return base + extra;
};
