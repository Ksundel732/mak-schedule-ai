"use client";

import { useEffect, useMemo, useState } from "react";
import { POSITIONS, getBreakParts } from "../src/lib/planner";

type Shift = { id: number; employeeId: number; date: string; startTime: string; endTime: string; roleName: string; employee?: { name: string } };
type Staff = {
  id: number; name: string; isMinor: boolean; skills: string[];
  availabilities: { dayOfWeek: number; isOff: boolean; startTime: string | null; endTime: string | null }[];
};

const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left", fontSize: 14 };
const head: React.CSSProperties = { ...cell, background: "#f4f8f5", fontWeight: 700 };
const tabBtn = (on: boolean): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 10, border: "1px solid", cursor: "pointer", fontWeight: 700, borderColor: on ? "#087f3e" : "#d5e2da", background: on ? "#087f3e" : "white", color: on ? "white" : "#30493a" });
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayKey = (s: Shift) => String(s.date).slice(0, 10);
const weekdayOf = (key: string) => { const d = new Date(`${key}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const fmtDate = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;

export default function Reports() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tab, setTab] = useState<"sub" | "breaks" | "training">("sub");
  const [day, setDay] = useState("");
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/schedule", { cache: "no-store" }).then((r) => r.json()), fetch("/api/staff", { cache: "no-store" }).then((r) => r.json())])
      .then(([a, b]) => {
        setShifts(a.shifts ?? []);
        setStaff(b.employees ?? []);
        const keys = (a.shifts ?? []).map(dayKey).sort();
        const today = new Date().toISOString().slice(0, 10);
        setDay(keys.includes(today) ? today : keys[0] ?? today);
      })
      .catch(() => setError("Не удалось загрузить данные для отчётов"));
  }, []);

  const days = useMemo(() => [...new Set(shifts.map(dayKey))].sort(), [shifts]);
  const dayShifts = shifts.filter((s) => dayKey(s) === day).sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Список готовых выйти на замену: доступны в этот день, сначала те, у кого нет смены
  const substitutes = useMemo(() => {
    const wd = weekdayOf(day || "1970-01-05");
    const weekKeys = day ? [...Array(7)].map((_, i) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (wd - 1) + i); return d.toISOString().slice(0, 10); }) : [];
    return staff.flatMap((p) => {
      const a = p.availabilities.find((x) => x.dayOfWeek === wd);
      if (!a || a.isOff || !a.startTime || !a.endTime) return [];
      const mine = shifts.filter((s) => s.employeeId === p.id && weekKeys.includes(dayKey(s)));
      const today = mine.filter((s) => dayKey(s) === day);
      const hours = mine.reduce((sum, s) => sum + (toMin(s.endTime) - toMin(s.startTime)) / 60, 0);
      return [{ p, a, today, hours, count: mine.length }];
    }).sort((x, y) => x.today.length - y.today.length || x.hours - y.hours);
  }, [staff, shifts, day]);

  const trained = (p: Staff, code: string) => {
    const pos = POSITIONS.find((x) => x.code === code)!;
    return p.skills.includes(`${pos.code} ${pos.title}`);
  };

  const daySelect = (
    <select value={day} onChange={(e) => setDay(e.target.value)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #d5e2da" }}>
      {days.length === 0 && <option value={day}>{fmtDate(day || new Date().toISOString().slice(0, 10))}</option>}
      {days.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
    </select>
  );

  return (
    <section style={card}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: "0 12px 0 0", fontSize: 22 }}>Отчёты</h2>
        <button type="button" style={tabBtn(tab === "sub")} onClick={() => setTab("sub")}>Готовы выйти на замену</button>
        <button type="button" style={tabBtn(tab === "breaks")} onClick={() => setTab("breaks")}>Перерывы</button>
        <button type="button" style={tabBtn(tab === "training")} onClick={() => setTab("training")}>Обучение</button>
      </div>
      {error && <div style={{ color: "#b3261e" }}>{error}</div>}

      {tab === "sub" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>Кто может выйти в выбранный день по своим временным возможностям. Сначала те, у кого смены в этот день нет. {daySelect}</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Сотрудник", "Доступное время", "Смена в этот день", "Часов / смен за неделю", "Обучен на"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {substitutes.map(({ p, a, today, hours, count }) => (
                  <tr key={p.id}>
                    <td style={cell}>{p.name}{p.isMinor ? " (несов.)" : ""}</td>
                    <td style={cell}>{a.startTime}–{a.endTime}</td>
                    <td style={cell}>{today.length ? today.map((s) => `${s.startTime}–${s.endTime} ${s.roleName}`).join("; ") : "-отсутствует-"}</td>
                    <td style={cell}>{Math.round(hours * 10) / 10} ч / {count}</td>
                    <td style={{ ...cell, fontSize: 12 }}>{p.skills.map((k) => k.split(" ")[0]).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {substitutes.length === 0 && <div style={{ color: "#777", padding: 12 }}>На этот день нет доступных сотрудников.</div>}
        </>
      )}

      {tab === "breaks" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>Перерывы по правилам ESP: взрослым от 4,5 ч — 30 мин, от 5,5 ч — ещё 15, от 7,5 ч — ещё 15; несовершеннолетним от 2,5 ч — 30 мин, от 5,5 ч — ещё 15. Отмечай перерыв, когда он состоялся. {daySelect}</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead><tr>{["Сотрудник", "Смена", "Перерывы", "Обработан"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {dayShifts.map((s) => {
                  const p = staff.find((x) => x.id === s.employeeId);
                  const parts = getBreakParts(toMin(s.endTime) - toMin(s.startTime), Boolean(p?.isMinor));
                  return (
                    <tr key={s.id}>
                      <td style={cell}>{s.employee?.name ?? p?.name}</td>
                      <td style={cell}>{s.startTime}–{s.endTime} {s.roleName}</td>
                      <td style={cell}>{parts.length ? parts.map((m) => `${m} мин`).join(" + ") : "не положен"}</td>
                      <td style={cell}><input type="checkbox" checked={Boolean(done[s.id])} disabled={!parts.length} onChange={(e) => setDone({ ...done, [s.id]: e.target.checked })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dayShifts.length === 0 && <div style={{ color: "#777", padding: 12 }}>В этот день смен нет.</div>}
        </>
      )}

      {tab === "training" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>Кто на каких позициях обучен. Внизу — сколько человек обучено на позиции: красным те, на которых не обучен никто.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr><th style={head}>Сотрудник</th>{POSITIONS.map((x) => <th key={x.code} style={{ ...head, textAlign: "center", padding: "8px 6px" }} title={x.title}>{x.code}</th>)}</tr>
              </thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.id}>
                    <td style={cell}>{p.name}</td>
                    {POSITIONS.map((x) => <td key={x.code} style={{ ...cell, textAlign: "center", padding: "8px 6px", color: "#087f3e" }}>{trained(p, x.code) ? "●" : ""}</td>)}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cell, fontWeight: 700 }}>Всего обучено</td>
                  {POSITIONS.map((x) => {
                    const n = staff.filter((p) => trained(p, x.code)).length;
                    return <td key={x.code} style={{ ...cell, textAlign: "center", padding: "8px 6px", fontWeight: 700, color: n === 0 ? "#b3261e" : "#176b3a" }}>{n}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
