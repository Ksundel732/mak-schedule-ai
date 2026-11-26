// Разбор таблицы сотрудников (Excel, CSV или вставка из таблицы) для импорта
import { buildXlsx } from "./xlsx";

export type ImportRow = {
  name: string;
  employeeNumber?: string;
  phone?: string;
  birthDate?: string;
  hireDate?: string;
  position?: string;
  employment?: string;
  email?: string;
  skills?: string[];
  availability?: DayAvailability[];
  username?: string;
  password?: string;
};

export type DayAvailability = { dayOfWeek: number; isOff: boolean; startTime: string | null; endTime: string | null };

export const TEMPLATE_HEADERS = ["Таб. №", "Фамилия Имя", "Телефон", "Дата рождения", "Дата приёма", "Должность", "Занятость", "Email", "Позиции (коды через запятую)", "Доступность"];

const DAY_INDEX: Record<string, number> = { пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 7 };

// «Доступность»: «07:00-23:00» — каждый день; «Пн-Пт 15:00-22:00; Сб,Вс 08:00-22:00; Ср вых».
// Если названы конкретные дни, остальные считаются выходными.
export function parseAvailability(raw: string): { value?: DayAvailability[]; error?: string } {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const days: (DayAvailability | null)[] = Array(7).fill(null);
  let anyDays = false;
  let bare: DayAvailability | null = null;

  for (const part of text.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(?:([а-яё]{2}(?:\s*[-–—,]\s*[а-яё]{2})*)\s+)?(.+)$/i.exec(part);
    if (!m) return { error: `не понял «${part}»` };
    const dayPart = (m[1] ?? "").toLowerCase();
    const rest = m[2].trim().toLowerCase();

    let timeInfo: { isOff: boolean; startTime: string | null; endTime: string | null };
    if (/^(вых|выходной|off|нет)/.test(rest)) timeInfo = { isOff: true, startTime: null, endTime: null };
    else {
      const t = /^(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?$/.exec(rest);
      if (!t) return { error: `не понял время «${rest}»` };
      const fmt = (h: string, mm?: string) => `${h.padStart(2, "0")}:${mm ?? "00"}`;
      const start = fmt(t[1], t[2]);
      const end = fmt(t[3], t[4]);
      if (Number(t[1]) > 24 || Number(t[3]) > 24 || start >= end) return { error: `время «${rest}»: начало должно быть раньше конца` };
      timeInfo = { isOff: false, startTime: start, endTime: end };
    }

    if (!dayPart) { bare = { dayOfWeek: 0, ...timeInfo }; continue; }
    anyDays = true;
    const selected = new Set<number>();
    for (const piece of dayPart.split(",").map((x) => x.trim()).filter(Boolean)) {
      const range = piece.split(/\s*[-–—]\s*/);
      const a = DAY_INDEX[range[0]];
      const b = range.length > 1 ? DAY_INDEX[range[1]] : a;
      if (!a || !b) return { error: `не понял день «${piece}»` };
      for (let d = a; ; d = d === 7 ? 1 : d + 1) { selected.add(d); if (d === b) break; }
    }
    selected.forEach((d) => { days[d - 1] = { dayOfWeek: d, ...timeInfo }; });
  }

  const base = bare && !anyDays ? bare : null;
  return {
    value: days.map((d, i) => (d ? d : base ? { ...base, dayOfWeek: i + 1 } : { dayOfWeek: i + 1, isOff: true, startTime: null, endTime: null })),
  };
}

type Field = keyof ImportRow;

// Распознавание заголовков по ключевым словам
const FIELD_RULES: [Field, RegExp][] = [
  ["phone", /тел/i],
  ["employeeNumber", /таб|№|номер|^id$/i],
  ["birthDate", /рожд/i],
  ["hireDate", /прием|приём|принят|найм/i],
  ["email", /mail|почт/i],
  ["position", /должн/i],
  ["employment", /занят|тип/i],
  ["availability", /доступн|возможн/i],
  ["skills", /позици|обуч|станц/i],
  ["username", /логин/i],
  ["password", /парол/i],
  ["name", /фио|фамил|имя|сотрудн|name/i],
];

export function detectColumns(header: string[]): Field[] | null {
  const mapped: (Field | null)[] = header.map((h) => {
    const text = String(h ?? "").trim();
    if (!text) return null;
    return FIELD_RULES.find(([, re]) => re.test(text))?.[0] ?? null;
  });
  if (!mapped.includes("name")) return null;
  const seen = new Set<Field>();
  return mapped.map((f) => {
    if (!f || seen.has(f)) return "" as Field;
    seen.add(f);
    return f;
  });
}

const DEFAULT_ORDER: Field[] = ["employeeNumber", "name", "phone", "birthDate", "hireDate", "position", "employment", "email", "skills"];

// Excel хранит даты числом (дни с 30.12.1899)
export function parseDate(raw: string): string | undefined {
  const v = String(raw ?? "").trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(v);
  if (dmy) {
    const yyyy = dmy[3].length === 2 ? (Number(dmy[3]) > 40 ? "19" : "20") + dmy[3] : dmy[3];
    return `${yyyy}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const serial = Number(v.replace(",", "."));
  if (Number.isFinite(serial) && serial > 1000 && serial < 80000) {
    return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return undefined;
}

export function parseEmployment(raw: string): string | undefined {
  const v = String(raw ?? "").toLowerCase();
  if (!v.trim()) return undefined;
  if (/совмест|combin/.test(v)) return "COMBINED";
  if (/неполн|part|pt/.test(v)) return "PART";
  if (/полн|full|ft/.test(v)) return "FULL";
  return undefined;
}

export function parseTableRows(table: string[][]): { rows: ImportRow[]; problems: string[]; firstLine: number } {
  const data = table.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (data.length === 0) return { rows: [], problems: ["Таблица пустая"], firstLine: 1 };

  let columns = detectColumns(data[0]);
  let body = data;
  const problems: string[] = [];
  if (columns) body = data.slice(1);
  else {
    columns = DEFAULT_ORDER;
    problems.push("Заголовки не распознаны — использован порядок колонок из шаблона");
  }

  const rows: ImportRow[] = [];
  body.forEach((cells, i) => {
    const r: Record<string, string> = {};
    columns!.forEach((f, c) => { if (f) r[f] = String(cells[c] ?? "").trim(); });
    const name = (r.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) { problems.push(`Строка ${i + 2}: нет имени — пропущена`); return; }
    const number = (r.employeeNumber ?? "").replace(/\.0+$/, "");
    const row: ImportRow = { name, employeeNumber: number || undefined };
    if (r.phone) row.phone = r.phone;
    if (r.email) row.email = r.email;
    if (r.position) row.position = r.position;
    if (r.username) row.username = r.username;
    if (r.password) row.password = r.password;
    if (r.birthDate) { row.birthDate = parseDate(r.birthDate); if (!row.birthDate) problems.push(`Строка ${i + 2}: не понял дату рождения «${r.birthDate}»`); }
    if (r.hireDate) { row.hireDate = parseDate(r.hireDate); if (!row.hireDate) problems.push(`Строка ${i + 2}: не понял дату приёма «${r.hireDate}»`); }
    if (r.employment) { row.employment = parseEmployment(r.employment); if (!row.employment) problems.push(`Строка ${i + 2}: не понял занятость «${r.employment}»`); }
    if (r.availability) {
      const a = parseAvailability(r.availability);
      if (a.error) problems.push(`Строка ${i + 2}: доступность — ${a.error}`);
      else row.availability = a.value;
    }
    if (r.skills) row.skills = r.skills.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    rows.push(row);
  });
  return { rows, problems, firstLine: 2 };
}

// Текст из CSV или вставки из Excel (разделитель — табуляция, «;» или «,»)
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delim = first.includes("\t") ? "\t" : first.split(";").length >= first.split(",").length ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

export function buildTemplate(): Uint8Array {
  const head = { bold: true, fill: "E6EFE9", border: true, wrap: true, align: "center" as const };
  const cell = { border: true };
  return buildXlsx([
    {
      name: "Сотрудники",
      colWidths: [9, 26, 17, 14, 14, 34, 16, 24, 30, 40],
      rows: [
        TEMPLATE_HEADERS.map((h) => ({ v: h, s: head })),
        ["101", "Иванова Анна", "+375 29 111-11-11", "15.03.1999", "01.09.2024", "Член бригады ресторана 3 разряда", "Неполное время", "anna@example.com", "C1, C2, DT", "Пн-Пт 15:00-22:00; Сб,Вс 08:00-22:00"].map((v) => ({ v, s: cell })),
        ["102", "Петров Илья", "+375 33 222-22-22", "20.05.2009", "10.06.2025", "Член бригады ресторана 3 разряда", "Совместитель", "", "I, Z, S", "07:00-23:00"].map((v) => ({ v, s: cell })),
      ],
      freeze: { rows: 1 },
    },
  ]);
}
