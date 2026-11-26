"use client";

import { useEffect, useMemo, useState } from "react";
import { EMPLOYMENT_LABELS } from "../src/lib/profile-table";
import { buildDayReport, buildDayForm, weekKeysOf } from "../src/lib/day-report";
import { POSITIONS, GROUPS, buildNeed, groupOfSkill, getBreakParts, OPEN_MIN, CLOSE_MIN, SLOT_COUNT, MINOR_LIMITS, ordersInHour, DAILY_ORDERS, setDailyOrders } from "../src/lib/planner";

type Shift = { breakMins?: number; id: number; employeeId: number; date: string; startTime: string; endTime: string; roleName: string; employee?: { name: string } };
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
const hoursOfShift = (s: Shift) => (toMin(s.endTime) - toMin(s.startTime)) / 60;
const coverageFor = (list: Shift[], wd: number) => {
  const need = buildNeed(wd);
  return Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const t = OPEN_MIN + slot * 30;
    return {
      want: GROUPS.reduce((sum, g) => sum + need[g.id][slot], 0),
      have: list.filter((x) => toMin(x.startTime) <= t && toMin(x.endTime) >= t + 30).length,
    };
  });
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtDate = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;

export default function Reports() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tab, setTab] = useState<"acks" | "people" | "stations" | "summary" | "stats" | "sub" | "breaks" | "training">("stations");
  const [day, setDay] = useState("");
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [forecastVersion, setForecastVersion] = useState(0);
  const [acks, setAcks] = useState<{ employeeId: number; weekStart: string; ackedAt: string }[]>([]);
  const [ackWeek, setAckWeek] = useState("");

  useEffect(() => {
    fetch("/api/ack", { cache: "no-store" }).then((r) => r.json()).then((d) => setAcks(d.acks ?? [])).catch(() => {});
  }, [tab]);
  const [profiles, setProfiles] = useState<Record<number, Record<string, string | null>>>({});

  useEffect(() => {
    fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      const map: typeof profiles = {};
      (d.profiles ?? []).forEach((p: Record<string, string | null> & { employeeId: number }) => { map[p.employeeId] = p; });
      setProfiles(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/forecast", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d.orders) { setDailyOrders(d.orders); setForecastVersion((v) => v + 1); } }).catch(() => {});
  }, []);

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
  }, [dayShifts, day, forecastVersion]);

  const problem = (s: Shift) => {
    const p = staff.find((x) => x.id === s.employeeId);
    const len = toMin(s.endTime) - toMin(s.startTime);
    if (len > 12 * 60) return "Смена длиннее 12 часов";
    if (p?.isMinor && len > MINOR_LIMITS.maxHours * 60) return "Несовершеннолетний: больше 8 часов";
    if (p?.isMinor && toMin(s.endTime) > MINOR_LIMITS.endMin) return "Несовершеннолетний: после 22:00";
    return "";
  };

  // Сводка дня: по часам прогноз заказов, нужно / запланировано людей, GCPH
  const hourly = useMemo(() => {
    const wd = weekdayOf(day || "1970-01-05");
    const cov = coverageFor(dayShifts, wd);
    return Array.from({ length: SLOT_COUNT / 2 }, (_, h) => {
      const a = cov[h * 2];
      const b = cov[h * 2 + 1];
      const want = Math.max(a.want, b.want);
      const have = (a.have + b.have) / 2;
      const orders = ordersInHour(wd, h);
      return { hour: 7 + h, orders, want, have, diff: have - want, gcph: have > 0 ? orders / have : 0 };
    });
  }, [dayShifts, day, forecastVersion]);

  // Статистика недели, в которую входит выбранный день
  const weekStats = useMemo(() => {
    if (!day) return [];
    const wd = weekdayOf(day);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${day}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (wd - 1) + i);
      const key = d.toISOString().slice(0, 10);
      const list = shifts.filter((x) => dayKey(x) === key);
      const hours = list.reduce((sum, x) => sum + hoursOfShift(x), 0);
      const breaks = list.reduce((sum, x) => sum + (x.breakMins ?? 0), 0) / 60;
      const orders = DAILY_ORDERS[i + 1] ?? 0;
      const gaps = coverageFor(list, i + 1).filter((c) => c.have < c.want).length / 2;
      return { key, shiftsCount: list.length, hours, breaks, orders, gaps, gcph: hours > 0 ? orders / hours : 0 };
    });
  }, [shifts, day, forecastVersion]);

  const trained = (p: Staff, code: string) => {
    const pos = POSITIONS.find((x) => x.code === code)!;
    return p.skills.includes(`${pos.code} ${pos.title}`);
  };


  // Скачивание печатного Excel: «Расписание на день» (по образцу ESP) и «График недели»
  function downloadExcel(scope: "day" | "week", kind: "form" | "chart" = "chart") {
    if (!day) return;
    const keys = scope === "day" ? [day] : weekKeysOf(day);
    const people = staff.map((p) => ({ id: p.id, name: p.name, isMinor: p.isMinor }));
    const profs = profiles as Record<number, { employeeNumber?: string | null; employment?: string | null }>;
    const bytes = kind === "form"
      ? buildDayForm({ days: keys, shifts, staff: people, profiles: profs })
      : buildDayReport({ days: keys, shifts, staff: people, profiles: profs, withWeek: scope === "week" });
    const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind === "form" ? "blank" : "raspisanie"}-${scope === "day" ? day : `nedelya-${keys[0]}`}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
        <button type="button" style={tabBtn(tab === "acks")} onClick={() => setTab("acks")}>Ознакомление</button>
        <button type="button" style={tabBtn(tab === "people")} onClick={() => setTab("people")}>Сотрудники</button>
        <button type="button" style={tabBtn(tab === "stations")} onClick={() => setTab("stations")}>По станциям</button>
        <button type="button" style={tabBtn(tab === "summary")} onClick={() => setTab("summary")}>Сводка дня</button>
        <button type="button" style={tabBtn(tab === "stats")} onClick={() => setTab("stats")}>Статистика</button>
        <button type="button" style={tabBtn(tab === "sub")} onClick={() => setTab("sub")}>Готовы выйти на замену</button>
        <button type="button" style={tabBtn(tab === "breaks")} onClick={() => setTab("breaks")}>Перерывы</button>
        <button type="button" style={tabBtn(tab === "training")} onClick={() => setTab("training")}>Обучение</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16, padding: 12, background: "#f4f8f5", borderRadius: 12 }}>
        <strong style={{ fontSize: 14 }}>Печать (Excel):</strong>
        {daySelect}
        <button type="button" onClick={() => downloadExcel("day", "form")} disabled={!day} style={{ ...tabBtn(true), opacity: day ? 1 : 0.5 }}>Бланк «Расписание на день» (с перерывами и фактом)</button>
        <button type="button" onClick={() => downloadExcel("week", "form")} disabled={!day} style={{ ...tabBtn(true), opacity: day ? 1 : 0.5 }}>Бланки на всю неделю</button>
        <button type="button" onClick={() => downloadExcel("day", "chart")} disabled={!day} style={{ ...tabBtn(false), opacity: day ? 1 : 0.5 }}>Шкала дня</button>
        <button type="button" onClick={() => downloadExcel("week", "chart")} disabled={!day} style={{ ...tabBtn(false), opacity: day ? 1 : 0.5 }}>График недели</button>
      </div>
      {error && <div style={{ color: "#b3261e" }}>{error}</div>}

      {tab === "acks" && (() => {
        const mondayOf = (k: string) => { const d = new Date(`${k}T00:00:00Z`); const wd = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (wd === 0 ? -6 : 1 - wd)); return d.toISOString().slice(0, 10); };
        const weeks = [...new Set(shifts.map((x) => mondayOf(dayKey(x))))].sort();
        const week = ackWeek || weeks[weeks.length - 1] || "";
        const people = new Map<number, { name: string; count: number }>();
        shifts.filter((x) => mondayOf(dayKey(x)) === week).forEach((x) => {
          const cur = people.get(x.employeeId) ?? { name: x.employee?.name ?? `ID ${x.employeeId}`, count: 0 };
          cur.count += 1;
          people.set(x.employeeId, cur);
        });
        const rows = [...people.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "ru"));
        const done = rows.filter(([id]) => acks.some((a) => a.employeeId === id && a.weekStart === week)).length;
        return (
          <>
            <p style={{ color: "#777", fontSize: 14 }}>
              По политике (п. 2.12) каждый сотрудник должен ознакомиться с расписанием под подпись «Ознакомлен и согласен». Здесь видно, кто уже нажал кнопку в своём кабинете.{" "}
              <select value={week} onChange={(e) => setAckWeek(e.target.value)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #d5e2da" }}>
                {weeks.map((w) => <option key={w} value={w}>Неделя с {fmtDate(w)}</option>)}
              </select>
            </p>
            <p style={{ fontWeight: 700 }}>Ознакомлены: {done} из {rows.length}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead><tr>{["Сотрудник", "Смен", "Статус"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(([id, r]) => {
                    const ack = acks.find((a) => a.employeeId === id && a.weekStart === week);
                    return (
                      <tr key={id}>
                        <td style={cell}>{r.name}</td>
                        <td style={cell}>{r.count}</td>
                        <td style={{ ...cell, fontWeight: 700, color: ack ? "#176b3a" : "#b3261e" }}>{ack ? `✓ ${new Date(ack.ackedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "не ознакомлен"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <div style={{ color: "#777", padding: 12 }}>Смен пока нет.</div>}
          </>
        );
      })()}

      {tab === "people" && (() => {
        const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
        const seniority = (iso: string | null | undefined) => {
          if (!iso) return "—";
          const from = new Date(iso);
          const now = new Date();
          let months = (now.getFullYear() - from.getUTCFullYear()) * 12 + now.getMonth() - from.getUTCMonth();
          if (now.getDate() < from.getUTCDate()) months -= 1;
          if (months < 0) return "—";
          return months >= 12 ? `${Math.floor(months / 12)} г. ${months % 12} мес.` : `${months} мес.`;
        };
        const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
        const birthdays = staff
          .filter((p) => profiles[p.id]?.birthDate)
          .sort((a, b) => (profiles[a.id]!.birthDate as string).slice(5).localeCompare((profiles[b.id]!.birthDate as string).slice(5)));
        return (
          <>
            <p style={{ color: "#777", fontSize: 14 }}>Список сотрудников, стаж, дни рождения по месяцам и часы в месяце выбранного дня. Минимум по политике: 40 часов в месяц при неполном времени, 20 для совместителей (красным, если не набрано). Данные вносятся при регистрации или кнопкой «Данные» во вкладке «Сотрудники».</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr>{["Таб. №", "Сотрудник", "Должность", "Занятость", "Телефон", "Дата рождения", "Принят", "Стаж", "Часов в месяце"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                <tbody>
                  {staff.map((p) => (
                    <tr key={p.id}>
                      <td style={cell}>{profiles[p.id]?.employeeNumber || "—"}</td>
                      <td style={cell}>{p.name}</td>
                      <td style={cell}>{profiles[p.id]?.position || "—"}</td>
                      <td style={cell}>{EMPLOYMENT_LABELS[profiles[p.id]?.employment ?? ""] ?? "—"}</td>
                      <td style={cell}>{profiles[p.id]?.phone || "—"}</td>
                      <td style={cell}>{ddmm(profiles[p.id]?.birthDate)}</td>
                      <td style={cell}>{ddmm(profiles[p.id]?.hireDate)}</td>
                      <td style={cell}>{seniority(profiles[p.id]?.hireDate)}</td>
                      {(() => {
                        const monthKey = (day || new Date().toISOString().slice(0, 10)).slice(0, 7);
                        const hours = shifts.filter((x) => x.employeeId === p.id && dayKey(x).startsWith(monthKey)).reduce((sum, x) => sum + hoursOfShift(x), 0);
                        const min = profiles[p.id]?.employment === "PART" ? 40 : profiles[p.id]?.employment === "COMBINED" ? 20 : 0;
                        return <td style={{ ...cell, color: min && hours < min ? "#b3261e" : undefined }} title={min ? `Минимум по политике: ${min} ч в месяц` : undefined}>{r1(hours)}{min ? ` / ${min}` : ""}</td>;
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ margin: "20px 0 8px" }}>Дни рождения</h3>
            {birthdays.length === 0 && <div style={{ color: "#777" }}>Дат рождения пока нет.</div>}
            {MONTHS.map((m, i) => {
              const list = birthdays.filter((p) => Number((profiles[p.id]!.birthDate as string).slice(5, 7)) === i + 1);
              return list.length ? (
                <div key={m} style={{ marginBottom: 8, fontSize: 14 }}>
                  <strong>{m}:</strong> {list.map((p) => `${p.name} (${(profiles[p.id]!.birthDate as string).slice(8, 10)}.${(profiles[p.id]!.birthDate as string).slice(5, 7)})`).join(", ")}
                </div>
              ) : null;
            })}
          </>
        );
      })()}

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

      {tab === "summary" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>
            Ежедневная сводка по часам: прогноз заказов, сколько людей нужно и сколько запланировано, и заказы на человека в час (GCPH). {daySelect}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead><tr>{["Час", "Прогноз заказов", "Нужно человек", "Запланировано", "+/-", "GCPH"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {hourly.map((r) => (
                  <tr key={r.hour}>
                    <td style={cell}>{String(r.hour).padStart(2, "0")}:00</td>
                    <td style={cell}>{r1(r.orders)}</td>
                    <td style={cell}>{r.want}</td>
                    <td style={cell}>{r1(r.have)}</td>
                    <td style={{ ...cell, fontWeight: 700, color: r.diff < 0 ? "#b3261e" : "#176b3a" }}>{r.diff > 0 ? "+" : ""}{r1(r.diff)}</td>
                    <td style={cell}>{r.have > 0 ? r1(r.gcph) : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...cell, fontWeight: 700 }}>Итого</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r1(hourly.reduce((a, r) => a + r.orders, 0))}</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r1(hourly.reduce((a, r) => a + r.want, 0))} ч</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r1(hourly.reduce((a, r) => a + r.have, 0))} ч</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r1(hourly.reduce((a, r) => a + r.diff, 0))}</td>
                  <td style={cell}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "stats" && (
        <>
          <p style={{ color: "#777", fontSize: 14 }}>
            Статистика недели, в которую входит выбранный день: заказы, часы, перерывы, GCPH и часы, когда людей не хватает. {daySelect}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["День", "Прогноз заказов", "Смен", "Часов", "Перерывы, ч", "GCPH", "Пробелы, ч"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {weekStats.map((r, i) => (
                  <tr key={r.key}>
                    <td style={cell}>{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]} {r.key.slice(8, 10)}.{r.key.slice(5, 7)}</td>
                    <td style={cell}>{r.orders}</td>
                    <td style={cell}>{r.shiftsCount}</td>
                    <td style={cell}>{r1(r.hours)}</td>
                    <td style={cell}>{r1(r.breaks)}</td>
                    <td style={cell}>{r.hours > 0 ? r1(r.gcph) : "—"}</td>
                    <td style={{ ...cell, fontWeight: 700, color: r.gaps > 0 ? "#b3261e" : "#176b3a" }}>{r.gaps}</td>
                  </tr>
                ))}
                {(() => {
                  const t = weekStats.reduce((a, r) => ({ orders: a.orders + r.orders, shiftsCount: a.shiftsCount + r.shiftsCount, hours: a.hours + r.hours, breaks: a.breaks + r.breaks, gaps: a.gaps + r.gaps }), { orders: 0, shiftsCount: 0, hours: 0, breaks: 0, gaps: 0 });
                  return (
                    <tr>
                      <td style={{ ...cell, fontWeight: 700 }}>Неделя</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{t.orders}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{t.shiftsCount}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{r1(t.hours)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{r1(t.breaks)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{t.hours > 0 ? r1(t.orders / t.hours) : "—"}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{t.gaps}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
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
