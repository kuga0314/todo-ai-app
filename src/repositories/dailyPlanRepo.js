import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

export async function fetchAppSettings({ db, uid }) {
  const appSnap = await getDoc(doc(db, `users/${uid}/settings/app`));
  return appSnap.exists() ? appSnap.data() : null;
}

export async function fetchDailyPlan({ db, uid, todayKey }) {
  const planSnap = await getDoc(doc(db, "users", uid, "dailyPlans", todayKey));
  return planSnap.exists() ? planSnap.data() : null;
}

export async function saveDailyPlan({ db, uid, todayKey, docData }) {
  const planRef = doc(db, "users", uid, "dailyPlans", todayKey);
  await setDoc(planRef, docData, { merge: true });
  return planRef;
}

export async function appendDailyPlanHistory({ db, uid, todayKey, historyData }) {
  const planRef = doc(db, "users", uid, "dailyPlans", todayKey);
  await Promise.all([
    setDoc(planRef, { lastChange: historyData }, { merge: true }),
    addDoc(collection(planRef, "revisions"), historyData),
  ]);
}

export async function fetchTodos({ db, uid }) {
  const snap = await getDocs(query(collection(db, "todos"), where("userId", "==", uid)));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

export async function updateTodoAssignments({ db, items, todayKey, todos }) {
  return Promise.allSettled(
    (items || []).map((item) => {
      const todo = todos.find((t) => t.id === item.id);
      if (!todo) return null;
      const ref = doc(db, "todos", item.id);
      const newAssigned = {
        ...(todo.assigned || {}),
        [todayKey]: item.todayMinutes,
      };
      return updateDoc(ref, { assigned: newAssigned });
    })
  );
}
