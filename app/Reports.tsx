"use client";

import { useEffect, useMemo, useState } from "react";
import { POSITIONS, GROUPS, buildNeed, groupOfSkill, getBreakParts, OPEN_MIN, CLOSE_MIN, SLOT_COUNT, MINOR_LIMITS } from "../src/lib/planner";

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
  const [tab, setTab] = useState<"stations" | "sub" | "breaks" | "training">("stations");
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

  // Смены по станциям + покрытие: нужно / есть по 30-минутным отрезкам
  const stations = useMemo(() => {
    const groups = [...GROUPS.map((g) => ({ id: g.id as string, label: g.label })), { id: "other", label: "Прочие позиции" }];
    return groups
      .map((g) => ({ ...g, list: dayShifts.filter((s) => (groupOfSkill(s.roleName) ?? "other") === g.id) }))
      .filter((g) => g.list.length > 0);
  }, [dayShifts]);

  const coverage = useMemo(() => {
    const need = buildNeed(weekdayOf(day || "1970-01-05"));
    return Array.from({ length: SLOT_COUNT }, (_, slot) => {
      const t = OPEN_MIN + slot * 30;
      const want = GROUPS.reduce((sum, g) => sum + need[g.id][slot], 0);
      const have = dayShifts.filter((s) => toMin(s.startTime) <= t && toMin(s.endTime) >= t + 30).length;
      return { want, have };
    });
  }, [dayShifts, day]);

  const problem = (s: Shift) => {
    const p = staff.find((x) => x.id === s.employeeId);
    const len = toMin(s.endTime) - toMin(s.startTime);
    if (len > 12 * 60) return "Смена длиннее 12 часов";
    if (p?.isMinor && len > MINOR_LIMITS.maxHours * 60) return "Несовершеннолетний: больше 8 часов";
    if (p?.isMinor && toMin(s.endTime) > MINOR_LIMITS.endMin) return "Несовершеннолетний: после 22:00";
    return "";
  };

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
        <button type="button" style={tabBtn(tab === "stations")} onClick={() => setTab("stations")}>По станциям</button>
        <button type="button" style={tabBtn(tab === "sub")} onClick={() => setTab("sub")}>Готовы выйти на замену</button>
        <button type="button" style={tabBtn(tab === "breaks")} onClick={() => setTab("breaks")}>Перерывы</button>
        <button type="button" style={tabBtn(tab === "training")} onClick={() => setTab("training")}>Обучение</button>
      </div>
      {error && <div style={{ color: "#b3261e" }}>{error}</div>}

      {tab === "stations" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>
            Смены дня по станциям. Синий — смена в порядке, красный — нарушение правил, серая полоса сверху — часы, когда людей меньше, чем нужно. {daySelect}
          </p>
          {(() => {
            const total = CLOSE_MIN - OPEN_MIN;
            const left = (m: number) => `${((m - OPEN_MIN) / total) * 100}%`;
            const gapSlots = coverage.filter((c) => c.have < c.want).length;
            return (
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 720 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ width: 230, fontSize: 13, fontWeight: 700 }}>Покрытие (пробелов: {gapSlots / 2} ч)</div>
                    <div style={{ flex: 1, display: "flex", height: 18, borderRadius: 6, overflow: "hidden", border: "1px solid #e5e5e5" }}>
                      {coverage.map((c, i) => (
                        <div key={i} title={`${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"} — нужно ${c.want}, есть ${c.have}`}
                          style={{ flex: 1, background: c.have >= c.want ? "#cfe9d8" : "#9aa0a6" }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", marginLeft: 230, fontSize: 11, color: "#777", marginBottom: 6, position: "relative", height: 14 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      {[7, 9, 11, 13, 15, 17, 19, 21, 23].map((h) => <span key={h} style={{ position: "absolute", left: left(h * 60), transform: "translateX(-50%)" }}>{h}:00</span>)}
                    </div>
                  </div>
                  {stations.map((g) => (
                    <div key={g.id} style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, background: "#f4f8f5", padding: "6px 10px", borderRadius: 8 }}>{g.label}</div>
                      {g.list.map((sh) => {
                        const bad = problem(sh);
                        return (
                          <div key={sh.id} style={{ display: "flex", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #f0f0f0" }} title={bad || undefined}>
                            <div style={{ width: 230, fontSize: 13 }}>
                              <strong>{sh.employee?.name}</strong>
                              <div style={{ color: "#777", fontSize: 12 }}>{sh.roleName} · {sh.startTime}–{sh.endTime}{bad ? ` · ${bad}` : ""}</div>
                            </div>
                            <div style={{ flex: 1, position: "relative", height: 16, background: "#f6f6f6", borderRadius: 4 }}>
                              <div style={{ position: "absolute", top: 0, bottom: 0, left: left(toMin(sh.startTime)), width: `${((toMin(sh.endTime) - toMin(sh.startTime)) / total) * 100}%`, background: bad ? "#d93025" : "#2f6fd6", borderRadius: 4 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {stations.length === 0 && <div style={{ color: "#777", padding: 12 }}>В этот день смен нет.</div>}
                </div>
              </div>
            );
          })()}
        </>
      )}

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
