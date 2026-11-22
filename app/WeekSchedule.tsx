"use client";

import { useMemo, useState } from "react";

type Shift = {
  id: number;
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  breakMins: number;
  roleName: string;
  employee?: { id: number; name: string };
};

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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

function fmt(key: string) {
  return `${key.slice(8, 10)}.${key.slice(5, 7)}`;
}

function hoursOf(s: Shift) {
  const [a, b] = [s.startTime, s.endTime].map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  });
  return Math.max(0, (b - a - s.breakMins) / 60);
}

export default function WeekSchedule({
  shifts,
  onRefresh,
}: {
  shifts: Shift[];
  onRefresh: () => void;
}) {
  const now = new Date();
  const todayKey = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  )
    .toISOString()
    .slice(0, 10);
  const [week, setWeek] = useState(mondayKey(new Date(todayKey)));

  const weeksWithShifts = useMemo(() => {
    const set = new Set<string>();
    shifts.forEach((s) => set.add(mondayKey(new Date(s.date))));
    return set;
  }, [shifts]);

  const dayKeys = DAYS.map((_, i) => shiftDays(week, i));
  const weekShifts = shifts.filter((s) =>
    dayKeys.includes(String(s.date).slice(0, 10))
  );

  const rows = useMemo(() => {
    const map = new Map<number, { name: string; byDay: Shift[][]; hours: number }>();
    weekShifts.forEach((s) => {
      const row =
        map.get(s.employeeId) ??
        { name: s.employee?.name || `ID ${s.employeeId}`, byDay: DAYS.map(() => []), hours: 0 };
      row.byDay[dayKeys.indexOf(String(s.date).slice(0, 10))].push(s);
      row.hours += hoursOf(s);
      map.set(s.employeeId, row);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekShifts.length, week]);

  const btn: React.CSSProperties = {
    border: "1px solid #d5e2da", background: "white", color: "#30493a",
    borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer",
  };
  const th: React.CSSProperties = { padding: 10, borderBottom: "1px solid #e5e5e5", textAlign: "center" };

  return (
    <section style={{ marginTop: 32, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Расписание на неделю</h2>
          <p style={{ margin: "6px 0 0", color: "#777", fontSize: 14 }}>
            Смен на этой неделе: {weekShifts.length}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => setWeek(shiftDays(week, -7))}>←</button>
          <strong style={{ minWidth: 120, textAlign: "center" }}>
            {fmt(week)} – {fmt(shiftDays(week, 6))}
          </strong>
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

      {rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: "#777", background: "#f8f9f8", borderRadius: 14 }}>
          На эту неделю смен нет. Выбери другую неделю или создай расписание.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
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
                <tr key={row.name}>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 600 }}>{row.name}</td>
                  {row.byDay.map((list, i) => (
                    <td key={i} style={{ padding: 6, borderBottom: "1px solid #eee", textAlign: "center", verticalAlign: "top", background: dayKeys[i] === todayKey ? "#f3fbf6" : undefined }}>
                      {list.length === 0 ? (
                        <span style={{ color: "#bbb" }}>—</span>
                      ) : (
                        list.map((s) => (
                          <div key={s.id} style={{ background: "#e8f5ec", borderRadius: 8, padding: "4px 6px", marginBottom: 4, fontSize: 13 }}>
                            <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{s.startTime}–{s.endTime}</div>
                            <div style={{ color: "#4b6455", fontSize: 12 }}>{s.roleName}</div>
                          </div>
                        ))
                      )}
                    </td>
                  ))}
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "center", fontWeight: 700 }}>
                    {Math.round(row.hours * 10) / 10}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
