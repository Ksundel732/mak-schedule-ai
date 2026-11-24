"use client";

import { useEffect, useState } from "react";
import { DAILY_ORDERS, setDailyOrders } from "../src/lib/planner";

const NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const field: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };

export default function Forecast() {
  const [values, setValues] = useState<string[]>(NAMES.map((_, i) => String(DAILY_ORDERS[i + 1])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/forecast", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (d.orders) setValues(NAMES.map((_, i) => String(d.orders[i + 1])));
    }).catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const orders = Object.fromEntries(values.map((v, i) => [i + 1, Number(v)]));
      const r = await fetch("/api/forecast", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setDailyOrders(orders);
      setMsg({ ok: true, text: "Прогноз сохранён. Новые расписания будут строиться по нему." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Прогноз заказов (GC)</h2>
      <p style={{ margin: "0 0 16px", color: "#777", fontSize: 14 }}>
        Сколько заказов ожидается в каждый день недели. По этим числам считается, сколько людей нужно в каждый час. Перед составлением расписания обновите прогноз, а после сохранения нажмите «Создать расписание» заново.
      </p>
      <form onSubmit={save} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        {NAMES.map((name, i) => (
          <label key={name} style={{ display: "grid", gridTemplateColumns: "140px 1fr", alignItems: "center", gap: 10 }}>
            {name}
            <input type="number" min={0} max={20000} style={field} value={values[i]} onChange={(e) => setValues(values.map((v, idx) => (idx === i ? e.target.value : v)))} />
          </label>
        ))}
        {msg && <div style={{ padding: 10, borderRadius: 10, background: msg.ok ? "#e8f5ec" : "#fdecec", color: msg.ok ? "#176b3a" : "#b3261e" }}>{msg.text}</div>}
        <div><button type="submit" disabled={busy} style={{ background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Сохраняю…" : "Сохранить прогноз"}</button></div>
      </form>
    </section>
  );
}
