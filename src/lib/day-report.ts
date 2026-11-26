/*
 * Печатный отчёт «Расписание на день» в Excel — по образцу ESP
 * («Ежедневное расписание», руководство ESP, стр. 86–87) и «График работы
 * сотрудников» (компактный вид, стр. 90–91).
 */
import { buildXlsx, type Cell, type CellStyle, type Sheet } from "./xlsx";
import {
  GROUPS,
  OPEN_MIN,
  CLOSE_MIN,
  buildNeed,
  groupOfSkill,
  getBreakParts,
  ordersInHour,
  MINOR_LIMITS,
  DAILY_ORDERS,
} from "./planner";

export type ReportShift = {
  id: number;
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  roleName: string;
  breakMins?: number;
  employee?: { name: string };
};
export type ReportStaff = { id: number; name: string; isMinor: boolean };
export type ReportProfile = { employeeNumber?: string | null };

const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const Q = 15; // минут в одной колонке графика
const QCOLS = (CLOSE_MIN - OPEN_MIN) / Q; // 68
const FIRST_Q = 6; // индекс первой колонки графика
const HEAD_COLS = 6;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const weekdayOf = (key: string) => {
  const d = new Date(`${key}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const fmtDate = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const dayKey = (s: { date: string }) => String(s.date).slice(0, 10);
const roleCode = (roleName: string) => roleName.split(" ")[0];

export function weekKeysOf(day: string): string[] {
  const wd = weekdayOf(day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (wd - 1) + i);
    return d.toISOString().slice(0, 10);
  });
}

const BLUE = "2F6FD6";
const RED = "D93025";
const HEAD_FILL = "E6EFE9";
const GROUP_FILL = "F1F1F1";

const base: CellStyle = { border: true, valign: "center" };
const txt = (v: string | number, s: CellStyle = {}): Cell => ({ v, s: { ...base, ...s } });
const blank = (s: CellStyle = {}): Cell => ({ s: { ...base, ...s } });

function daySheet(day: string, shifts: ReportShift[], staff: ReportStaff[]): Sheet {
  const wd = weekdayOf(day);
  const list = shifts
    .filter((s) => dayKey(s) === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || (a.employee?.name ?? "").localeCompare(b.employee?.name ?? "", "ru"));
  const isMinor = (id: number) => staff.find((p) => p.id === id)?.isMinor ?? false;
  const totalCols = FIRST_Q + QCOLS;

  const rows: Sheet["rows"] = [];
  const merges: [number, number, number, number][] = [];
  const rowHeights: Record<number, number> = {};
  const newRow = () => {
    const r: (Cell | null)[] = Array.from({ length: totalCols }, () => null);
    rows.push(r);
    return rows.length - 1;
  };
  const merge = (r: number, c1: number, c2: number) => merges.push([r, c1, r, c2]);

  // заголовок
  let r = newRow();
  rows[r][0] = { v: "РАСПИСАНИЕ НА ДЕНЬ", s: { bold: true, size: 14 } };
  merge(r, 0, HEAD_COLS + 20);
  rowHeights[r] = 22;
  r = newRow();
  rows[r][0] = { v: `${WEEKDAYS[wd - 1]}, ${fmtDate(day)}   ·   прогноз заказов (GC): ${DAILY_ORDERS[wd] ?? 0}`, s: { bold: true, size: 11 } };
  merge(r, 0, HEAD_COLS + 20);
  rowHeights[r] = 18;
  newRow();

  // шкала часов
  const hoursRow = newRow();
  ["Сотрудник", "Начало", "Конец", "Позиция", "Часы", "Перерыв"].forEach((h, c) => {
    rows[hoursRow][c] = txt(h, { bold: true, fill: HEAD_FILL, align: "center" });
  });
  for (let h = 0; h < QCOLS / 4; h++) {
    const c = FIRST_Q + h * 4;
    rows[hoursRow][c] = txt(OPEN_MIN / 60 + h, { bold: true, fill: HEAD_FILL, align: "center", size: 9 });
    for (let k = 1; k < 4; k++) rows[hoursRow][c + k] = blank({ fill: HEAD_FILL });
    merge(hoursRow, c, c + 3);
  }

  // итоги по часам
  const need = buildNeed(wd);
  const slotWant = Array.from({ length: need.cashier.length }, (_, i) => GROUPS.reduce((a, g) => a + need[g.id][i], 0));
  const slotHave = slotWant.map((_, i) => {
    const t = OPEN_MIN + i * 30;
    return list.filter((x) => toMin(x.startTime) <= t && toMin(x.endTime) >= t + 30).length;
  });
  const hourly = Array.from({ length: slotWant.length / 2 }, (_, h) => {
    const want = Math.max(slotWant[h * 2], slotWant[h * 2 + 1]);
    const have = (slotHave[h * 2] + slotHave[h * 2 + 1]) / 2;
    return { orders: ordersInHour(wd, h), want, have };
  });
  const summary: [string, (h: (typeof hourly)[number]) => number, boolean][] = [
    ["Прогноз заказов (GC)", (h) => r1(h.orders), false],
    ["Прогноз по Labor (нужно людей)", (h) => h.want, false],
    ["Labor (запланировано)", (h) => r1(h.have), false],
    ["+/- разница", (h) => r1(h.have - h.want), true],
  ];
  for (const [label, get, colored] of summary) {
    const sr = newRow();
    rows[sr][0] = txt(label, { bold: true, fill: HEAD_FILL });
    for (let c = 1; c < HEAD_COLS; c++) rows[sr][c] = blank({ fill: HEAD_FILL });
    merge(sr, 0, HEAD_COLS - 1);
    hourly.forEach((h, i) => {
      const c = FIRST_Q + i * 4;
      const v = get(h);
      rows[sr][c] = txt(v, { align: "center", size: 9, numFmt: "0.#", color: colored && v < 0 ? RED : undefined, bold: colored });
      for (let k = 1; k < 4; k++) rows[sr][c + k] = blank();
      merge(sr, c, c + 3);
    });
  }
  const freezeRows = rows.length;

  // смены по группам
  const groups = [...GROUPS.map((g) => ({ id: g.id as string, label: g.label })), { id: "other", label: "Прочие позиции" }];
  let totalHours = 0;
  let totalBreak = 0;
  for (const g of groups) {
    const items = list.filter((x) => (groupOfSkill(x.roleName) ?? "other") === g.id);
    if (!items.length) continue;
    const gr = newRow();
    rows[gr][0] = txt(g.label.toUpperCase(), { bold: true, fill: GROUP_FILL });
    for (let c = 1; c < totalCols; c++) rows[gr][c] = blank({ fill: GROUP_FILL });
    merge(gr, 0, totalCols - 1);

    for (const sh of items) {
      const sr = newRow();
      const s = toMin(sh.startTime);
      const e = toMin(sh.endTime);
      const hours = (e - s) / 60;
      const minor = isMinor(sh.employeeId);
      const parts = getBreakParts(e - s, minor);
      const bad = (e - s > 12 * 60) || (minor && ((e - s) / 60 > MINOR_LIMITS.maxHours || e > MINOR_LIMITS.endMin));
      totalHours += hours;
      totalBreak += parts.reduce((a, b) => a + b, 0);

      rows[sr][0] = txt(`${sh.employee?.name ?? staff.find((p) => p.id === sh.employeeId)?.name ?? `ID ${sh.employeeId}`}${minor ? " (НЕТ18)" : ""}`, { bold: true });
      rows[sr][1] = txt(sh.startTime, { align: "center" });
      rows[sr][2] = txt(sh.endTime, { align: "center" });
      rows[sr][3] = txt(roleCode(sh.roleName), { align: "center" });
      rows[sr][4] = txt(r1(hours), { align: "center", numFmt: "0.0" });
      rows[sr][5] = txt(parts.length ? parts.join("+") + " мин" : "—", { align: "center", size: 9 });

      const c1 = Math.max(0, Math.floor((s - OPEN_MIN) / Q));
      const c2 = Math.min(QCOLS, Math.ceil((e - OPEN_MIN) / Q)) - 1;
      for (let c = 0; c < QCOLS; c++) {
        const inBar = c >= c1 && c <= c2;
        rows[sr][FIRST_Q + c] = inBar
          ? { v: c === c1 ? roleCode(sh.roleName) : undefined, s: { ...base, fill: bad ? RED : BLUE, color: "FFFFFF", bold: true, size: 8, align: "center" } }
          : blank({ fill: c % 4 === 0 ? "F6F6F6" : undefined });
      }
      if (c2 > c1) merge(sr, FIRST_Q + c1, FIRST_Q + c2);
    }
  }
  if (list.length === 0) {
    const er = newRow();
    rows[er][0] = { v: "В этот день смен нет", s: { italic: true } };
  }

  // итоги внизу
  newRow();
  const tr = newRow();
  rows[tr][0] = { v: `Смен: ${list.length}     Часов всего: ${r1(totalHours)}     Перерывы: ${r1(totalBreak / 60)} ч     Рабочих часов без перерывов: ${r1(totalHours - totalBreak / 60)}`, s: { bold: true } };
  merge(tr, 0, HEAD_COLS + 40);
  newRow();
  const sign = newRow();
  rows[sign][0] = { v: "Менеджер: ______________________        Директор / 1-й ассистент: ______________________", s: {} };
  merge(sign, 0, HEAD_COLS + 40);

  return {
    name: `${WD_SHORT[wd - 1]} ${day.slice(8, 10)}.${day.slice(5, 7)}`,
    rows,
    merges,
    rowHeights,
    colWidths: [26, 7, 7, 9, 6, 14, ...Array.from({ length: QCOLS }, () => 2.3)],
    freeze: { rows: freezeRows, cols: HEAD_COLS },
    landscape: true,
  };
}

// «График работы сотрудников» (компактный): сотрудники слева, дни недели сверху
function weekSheet(days: string[], shifts: ReportShift[], staff: ReportStaff[], profiles: Record<number, ReportProfile>): Sheet {
  const weekDays = weekKeysOf(days[0]);
  const week = new Set(weekDays);
  const inWeek = shifts.filter((s) => week.has(dayKey(s)));
  const rows: Sheet["rows"] = [];
  const merges: [number, number, number, number][] = [];

  rows.push([{ v: `ГРАФИК РАБОТЫ СОТРУДНИКОВ   ${fmtDate(weekDays[0])} – ${fmtDate(weekDays[6])}`, s: { bold: true, size: 14 } }]);
  merges.push([0, 0, 0, 8]);
  rows.push([]);
  rows.push([
    txt("Таб. №", { bold: true, fill: HEAD_FILL, align: "center" }),
    txt("Сотрудник", { bold: true, fill: HEAD_FILL }),
    ...weekDays.map((d, i) => txt(`${WD_SHORT[i]} ${d.slice(8, 10)}.${d.slice(5, 7)}`, { bold: true, fill: HEAD_FILL, align: "center" })),
    txt("Часов", { bold: true, fill: HEAD_FILL, align: "center" }),
    txt("Смен", { bold: true, fill: HEAD_FILL, align: "center" }),
  ]);

  const ids = new Map<number, string>();
  staff.forEach((p) => ids.set(p.id, p.name));
  inWeek.forEach((s) => { if (!ids.has(s.employeeId)) ids.set(s.employeeId, s.employee?.name ?? `ID ${s.employeeId}`); });
  const people = [...ids.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru", { numeric: true }));

  for (const [id, name] of people) {
    const mine = inWeek.filter((s) => s.employeeId === id);
    const hours = mine.reduce((a, s) => a + (toMin(s.endTime) - toMin(s.startTime)) / 60, 0);
    rows.push([
      txt(profiles[id]?.employeeNumber ?? "", { align: "center" }),
      txt(name, { bold: true }),
      ...weekDays.map((d) => {
        const dayShifts = mine.filter((s) => dayKey(s) === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return txt(dayShifts.map((s) => `${s.startTime}–${s.endTime} ${roleCode(s.roleName)}`).join("\n"), { align: "center", size: 9, wrap: true, fill: dayShifts.length ? "EAF1FD" : undefined });
      }),
      txt(mine.length ? r1(hours) : "", { align: "center", numFmt: "0.0" }),
      txt(mine.length || "", { align: "center" }),
    ]);
  }
  const total = inWeek.reduce((a, s) => a + (toMin(s.endTime) - toMin(s.startTime)) / 60, 0);
  rows.push([null, txt("ИТОГО", { bold: true, fill: HEAD_FILL }), ...weekDays.map(() => blank({ fill: HEAD_FILL })), txt(r1(total), { bold: true, fill: HEAD_FILL, align: "center", numFmt: "0.0" }), txt(inWeek.length, { bold: true, fill: HEAD_FILL, align: "center" })]);

  return {
    name: "График недели",
    rows,
    merges,
    colWidths: [8, 26, ...Array.from({ length: 7 }, () => 15), 8, 7],
    freeze: { rows: 3, cols: 2 },
    landscape: true,
  };
}

// Книга Excel: выбранные дни (по листу на день) + при необходимости «График недели»
export function buildDayReport(opts: {
  days: string[];
  shifts: ReportShift[];
  staff: ReportStaff[];
  profiles?: Record<number, ReportProfile>;
  withWeek?: boolean;
}): Uint8Array {
  const sheets: Sheet[] = [];
  if (opts.withWeek && opts.days.length) sheets.push(weekSheet(opts.days, opts.shifts, opts.staff, opts.profiles ?? {}));
  for (const d of opts.days) sheets.push(daySheet(d, opts.shifts, opts.staff));
  return buildXlsx(sheets);
}
