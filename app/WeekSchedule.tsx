"use client";

import { useEffect, useMemo, useState } from "react";
import { POSITIONS, positionName } from "../src/lib/planner";

type Shift = {
  id: number; employeeId: number; date: string; startTime: string; endTime: string;
  breakMins: number; roleName: string; employee?: { id: number; name: string };
};
type Person = { id: number; name: string };
type Editor = { employeeId: number; name: string; date: string; shift?: Shift } | null;

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const ALL_POSITIONS = POSITIONS.map(positionName);

function mondayKey(value: Date) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function shiftDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// Как в ESP: часы смены считаются по длине смены, перерывы показываются отдельно
const hoursOf = (s: Shift) => Math.max(0, (toMin(s.endTime) - toMin(s.startTime)) / 60);

const btn: React.CSSProperties = { border: "1px solid #d5e2da", background: "white", color: "#30493a", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" };
const th: React.CSSProperties = { padding: 10, borderBottom: "1px solid #e5e5e5", textAlign: "center" };
const field: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };

export default function WeekSchedule({ shifts, onRefresh }: { shifts: Shift[]; onRefresh: () => void }) {
  const now = new Date();
  const todayKey = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
  const [week, setWeek] = useState(mondayKey(new Date(todayKey)));
  const [people, setPeople] = useState<Person[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [form, setForm] = useState({ startTime: "10:00", endTime: "18:00", roleName: ALL_POSITIONS[0] });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [absences, setAbsences] = useState<{ employeeId: number; type: string; startDate: string; endDate: string }[]>([]);
  const absenceOn = (id: number, key: string) =>
    absences.find((a) => a.employeeId === id && a.startDate.slice(0, 10) <= key && key <= a.endDate.slice(0, 10));

  useEffect(() => {
    fetch("/api/absences", { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d.absences) && setAbsences(d.absences)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/staff", { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d.employees) && setPeople(d.employees)).catch(() => {});
  }, []);

  const weeksWithShifts = useMemo(() => {
    const set = new Set<string>();
    shifts.forEach((s) => set.add(mondayKey(new Date(s.date))));
    return set;
  }, [shifts]);

  const dayKeys = DAYS.map((_, i) => shiftDays(week, i));
  const weekShifts = shifts.filter((s) => dayKeys.includes(String(s.date).slice(0, 10)));

  const rows = useMemo(() => {
    const map = new Map<number, { id: number; name: string; byDay: Shift[][]; hours: number }>();
    people.forEach((p) => map.set(p.id, { id: p.id, name: p.name, byDay: DAYS.map(() => []), hours: 0 }));
    weekShifts.forEach((s) => {
      const row = map.get(s.employeeId) ?? { id: s.employeeId, name: s.employee?.name || `ID ${s.employeeId}`, byDay: DAYS.map(() => []), hours: 0 };
      row.byDay[dayKeys.indexOf(String(s.date).slice(0, 10))].push(s);
      row.hours += hoursOf(s);
      map.set(s.employeeId, row);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, people, week]);

  function open(row: { id: number; name: string }, date: string, shift?: Shift) {
    setMsg("");
    setForm(shift ? { startTime: shift.startTime, endTime: shift.endTime, roleName: shift.roleName } : { startTime: "10:00", endTime: "18:00", roleName: ALL_POSITIONS[0] });
    setEditor({ employeeId: row.id, name: row.name, date, shift });
  }

  async function call(method: string, body: object) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/schedule/shifts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setEditor(null);
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    return editor.shift
      ? call("PATCH", { id: editor.shift.id, ...form })
      : call("POST", { employeeId: editor.employeeId, date: editor.date, ...form });
  };

  return (
    <section style={{ marginTop: 32, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Расписание на неделю</h2>
          <p style={{ margin: "6px 0 0", color: "#777", fontSize: 14 }}>
            Смен: {weekShifts.length}. Нажми на смену, чтобы изменить или удалить её, на «+», чтобы добавить.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => setWeek(shiftDays(week, -7))}>←</button>
          <strong style={{ minWidth: 120, textAlign: "center" }}>{fmt(week)} – {fmt(shiftDays(week, 6))}</strong>
          <button type="button" style={btn} onClick={() => setWeek(shiftDays(week, 7))}>→</button>
          <button type="button" style={btn} onClick={() => setWeek(mondayKey(new Date(todayKey)))}>Эта неделя</button>
          <button type="button" style={{ ...btn, background: "#176b3a", color: "white", border: "none" }} onClick={onRefresh}>Обновить</button>
        </div>
      </div>

      {weeksWithShifts.size > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {[...weeksWithShifts].sort().map((w) => (
            <button key={w} type="button" onClick={() => setWeek(w)}
              style={{ ...btn, padding: "5px 10px", fontSize: 13, ...(w === week ? { background: "#087f3e", color: "white", borderColor: "#087f3e" } : {}) }}>
              {fmt(w)}–{fmt(shiftDays(w, 6))}
            </button>
          ))}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr style={{ background: "#f4f8f5" }}>
              <th style={{ ...th, textAlign: "left" }}>Сотрудник</th>
              {DAYS.map((d, i) => (
                <th key={d} style={{ ...th, background: dayKeys[i] === todayKey ? "#dff3e6" : undefined }}>
                  {d}<div style={{ fontWeight: 400, fontSize: 12, color: "#777" }}>{fmt(dayKeys[i])}</div>
                </th>
              ))}
              <th style={th}>Часов</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 600 }}>{row.name}</td>
                {row.byDay.map((list, i) => (
                  <td key={i} style={{ padding: 6, borderBottom: "1px solid #eee", textAlign: "center", verticalAlign: "top", background: dayKeys[i] === todayKey ? "#f3fbf6" : undefined }}>
                    {absenceOn(row.id, dayKeys[i]) && (
                      <div style={{ background: "#fff3d6", color: "#8a5a00", borderRadius: 8, padding: "3px 6px", marginBottom: 4, fontSize: 12, fontWeight: 700 }}>
                        {absenceOn(row.id, dayKeys[i])!.type === "SICK" ? "Больничный" : absenceOn(row.id, dayKeys[i])!.type === "VACATION" ? "Отпуск" : "Отсутствует"}
                      </div>
                    )}
                    {list.map((s) => (
                      <div key={s.id} onClick={() => open(row, dayKeys[i], s)} title="Изменить смену"
                        style={{ background: "#e8f5ec", borderRadius: 8, padding: "4px 6px", marginBottom: 4, fontSize: 13, cursor: "pointer" }}>
                        <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{s.startTime}–{s.endTime}</div>
                        <div style={{ color: "#4b6455", fontSize: 12 }}>{s.roleName}</div>
                        {s.breakMins > 0 && <div style={{ color: "#8a8a8a", fontSize: 11 }}>перерыв {s.breakMins} мин</div>}
                      </div>
                    ))}
                    <button type="button" onClick={() => open(row, dayKeys[i])} title="Добавить смену"
                      style={{ border: "none", background: "none", color: list.length ? "#c4cfc8" : "#9aa9a0", cursor: "pointer", fontSize: 16 }}>+</button>
                  </td>
                ))}
                <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "center", fontWeight: 700 }}>{Math.round(row.hours * 10) / 10}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div style={{ padding: 20, color: "#777", textAlign: "center" }}>Сотрудников пока нет. Добавь их в разделе «Сотрудники».</div>}

      {editor && (
        <div onClick={() => setEditor(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380, display: "grid", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 20 }}>{editor.shift ? "Изменить смену" : "Новая смена"}</h3>
            <div style={{ color: "#555" }}>{editor.name} · {fmt(editor.date)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="time" style={field} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              <input type="time" style={field} value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </div>
            <select style={field} value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value })}>
              {[...new Set([form.roleName, ...ALL_POSITIONS])].map((p) => <option key={p}>{p}</option>)}
            </select>
            {msg && <div style={{ padding: 10, borderRadius: 10, background: "#fdecec", color: "#b3261e" }}>{msg}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" disabled={busy} style={{ background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Сохраняю…" : "Сохранить"}</button>
              {editor.shift && <button type="button" disabled={busy} onClick={() => call("DELETE", { id: editor.shift!.id })} style={{ ...btn, color: "#b3261e" }}>Удалить</button>}
              <button type="button" onClick={() => setEditor(null)} style={btn}>Закрыть</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
