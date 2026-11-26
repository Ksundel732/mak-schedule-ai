"use client";

import { useCallback, useEffect, useState } from "react";
import { POSITIONS, positionName } from "../src/lib/planner";

type Fixed = { id: number; employeeId: number; employeeName: string; dayOfWeek: number; startTime: string; endTime: string; roleName: string };
type Person = { id: number; name: string };

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const field: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };

export default function FixedShifts() {
  const [list, setList] = useState<Fixed[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [dayOfWeek, setDay] = useState("1");
  const [startTime, setStart] = useState("10:00");
  const [endTime, setEnd] = useState("18:00");
  const [roleName, setRole] = useState(positionName(POSITIONS[0]));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([fetch("/api/fixed-shifts", { cache: "no-store" }).then((r) => r.json()), fetch("/api/staff", { cache: "no-store" }).then((r) => r.json())]);
      if (a.error) setMsg(a.error); else setList(a.fixedShifts);
      setPeople(s.employees ?? []);
    } catch {
      setMsg("Не удалось загрузить данные");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/fixed-shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, dayOfWeek, startTime, endTime, roleName }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await fetch("/api/fixed-shifts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Фиксированные смены</h2>
      <p style={{ margin: "0 0 16px", color: "#777", fontSize: 14 }}>
        Смена, которая повторяется каждую неделю независимо от прогноза: обучение, ночная смена, свинг. Генератор ставит такие смены первыми и учитывает их в нагрузке. Одному сотруднику — одна фиксированная смена в день.
      </p>
      <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, alignItems: "end" }}>
        <select style={field} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          <option value="">Сотрудник…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={field} value={dayOfWeek} onChange={(e) => setDay(e.target.value)}>
          {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </select>
        <input type="time" style={field} value={startTime} onChange={(e) => setStart(e.target.value)} />
        <input type="time" style={field} value={endTime} onChange={(e) => setEnd(e.target.value)} />
        <select style={field} value={roleName} onChange={(e) => setRole(e.target.value)}>
          {POSITIONS.map((p) => <option key={p.code}>{positionName(p)}</option>)}
        </select>
        <button type="submit" disabled={busy} style={{ background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Сохраняю…" : "Добавить"}</button>
      </form>
      {msg && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#fdecec", color: "#b3261e" }}>{msg}</div>}
      <div style={{ marginTop: 20, display: "grid", gap: 6 }}>
        {list.length === 0 && !msg && <div style={{ color: "#777" }}>Фиксированных смен пока нет.</div>}
        {list.map((f) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
            <span><strong>{DAYS[f.dayOfWeek - 1]}</strong> · {f.employeeName} · {f.startTime}–{f.endTime} · {f.roleName}</span>
            <button type="button" onClick={() => remove(f.id)} style={{ border: "1px solid #d5e2da", background: "white", borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "#b3261e" }}>Удалить</button>
          </div>
        ))}
      </div>
    </section>
  );
}
