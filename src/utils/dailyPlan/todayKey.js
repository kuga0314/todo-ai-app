/** JSTのYYYY-MM-DDを生成 */
export function todayKeyTokyo() {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

export function getTodayKey() {
  return todayKeyTokyo();
}
