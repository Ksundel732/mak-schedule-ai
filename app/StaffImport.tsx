"use client";

import { useState } from "react";
import { readXlsxRows } from "../src/lib/xlsx";
import { buildTemplate, parseDelimited, parseTableRows, type ImportRow } from "../src/lib/staff-import";
import { DEMO_TABLE } from "../src/lib/demo-roster";
import { EMPLOYMENT_LABELS } from "../src/lib/profile-table";

type Result = { line: number; name: string; status: "created" | "updated" | "error"; username?: string; password?: string; error?: string };

const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #eee", textAlign: "left", fontSize: 13 };
const head: React.CSSProperties = { ...cell, background: "#f4f8f5", fontWeight: 700 };
const btn = (primary: boolean): React.CSSProperties => ({ padding: "10px 16px", borderRadius: 10, border: "1px solid #087f3e", cursor: "pointer", fontWeight: 700, background: primary ? "#087f3e" : "white", color: primary ? "white" : "#087f3e" });
const BATCH = 25;

function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Массовая загрузка базы сотрудников из Excel / CSV / вставки из таблицы
export default function StaffImport({ managerLogin, managerPassword, onDone }: { managerLogin: string; managerPassword: string; onDone?: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [firstLine, setFirstLine] = useState(2);
  const [paste, setPaste] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function applyTable(table: string[][]) {
    const parsed = parseTableRows(table);
    setRows(parsed.rows);
    setProblems(parsed.problems);
    setFirstLine(parsed.firstLine);
    setResults([]);
    setError(parsed.rows.length ? "" : "Не нашёл ни одного сотрудника в таблице");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (/\.xlsx$/i.test(file.name)) applyTable(await readXlsxRows(await file.arrayBuffer()));
      else if (/\.xls$/i.test(file.name)) setError("Старый формат .xls не поддерживается: сохрани файл как .xlsx или .csv");
      else applyTable(parseDelimited(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    }
  }

  async function run() {
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const all: Result[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await fetch("/api/staff/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ managerUsername: managerLogin, managerPassword, rows: rows.slice(i, i + BATCH), firstLine: firstLine + i }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Ошибка импорта");
        all.push(...d.results);
        setResults([...all]);
      }
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  const created = results.filter((r) => r.status === "created");
  const updated = results.filter((r) => r.status === "updated").length;
  const failed = results.filter((r) => r.status === "error");

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>Импорт базы сотрудников</h2>
      <p style={{ color: "#777", fontSize: 14, marginTop: 0 }}>
        Загрузи Excel (.xlsx) или CSV с колонками: табельный №, фамилия и имя, телефон, дата рождения, дата приёма, должность, занятость, email, позиции (коды вроде C1, I, Z).
        Существующие сотрудники (по табельному номеру или имени) обновятся, новые будут созданы. Пустые ячейки уже сохранённые данные не стирают.
        Несовершеннолетие определяется по дате рождения. Новым сотрудникам ставится доступность 7:00–23:00 (несовершеннолетним до 22:00), её можно поменять в кабинете.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label style={{ ...btn(true), display: "inline-block" }}>
          Выбрать файл
          <input type="file" accept=".xlsx,.csv,.txt,.tsv" onChange={onFile} style={{ display: "none" }} />
        </label>
        <button type="button" style={btn(false)} onClick={() => applyTable(DEMO_TABLE)}>Подставить готовую базу (61 сотрудник)</button>
        <button type="button" style={btn(false)} onClick={() => download(buildTemplate(), "shablon-sotrudniki.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>Скачать шаблон</button>
      </div>
      <textarea
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="…или вставь сюда ячейки, скопированные из Excel (первая строка — заголовки)"
        style={{ width: "100%", minHeight: 80, padding: 10, borderRadius: 10, border: "1px solid #d5e2da", fontFamily: "inherit", boxSizing: "border-box" }}
      />
      <div style={{ margin: "8px 0 16px" }}>
        <button type="button" style={btn(false)} disabled={!paste.trim()} onClick={() => applyTable(parseDelimited(paste))}>Разобрать вставленное</button>
      </div>

      {error && <div style={{ color: "#b3261e", marginBottom: 12 }}>{error}</div>}
      {problems.length > 0 && (
        <ul style={{ color: "#8a5a00", fontSize: 13, margin: "0 0 12px", paddingLeft: 20 }}>
          {problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
          {problems.length > 8 && <li>…и ещё {problems.length - 8}</li>}
        </ul>
      )}

      {rows.length > 0 && results.length === 0 && (
        <>
          <p style={{ fontWeight: 700 }}>Найдено сотрудников: {rows.length}</p>
          <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Таб. №", "Сотрудник", "Телефон", "Родился", "Принят", "Должность", "Занятость", "Позиции"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td style={cell}>{r.employeeNumber || "—"}</td>
                    <td style={cell}>{r.name}</td>
                    <td style={cell}>{r.phone || "—"}</td>
                    <td style={cell}>{r.birthDate || "—"}</td>
                    <td style={cell}>{r.hireDate || "—"}</td>
                    <td style={cell}>{r.position || "—"}</td>
                    <td style={cell}>{EMPLOYMENT_LABELS[r.employment ?? ""] ?? "—"}</td>
                    <td style={cell}>{r.skills?.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <div style={{ color: "#777", fontSize: 13, marginTop: 6 }}>Показаны первые 50 из {rows.length}</div>}
          <div style={{ marginTop: 14 }}>
            <button type="button" style={{ ...btn(true), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={run}>{busy ? "Импортирую…" : `Импортировать ${rows.length}`}</button>
          </div>
        </>
      )}

      {results.length > 0 && (
        <>
          <p style={{ fontWeight: 700 }}>
            Создано: {created.length} · обновлено: {updated}{failed.length ? ` · ошибок: ${failed.length}` : ""}{busy ? " (идёт импорт…)" : ""}
          </p>
          {failed.length > 0 && (
            <ul style={{ color: "#b3261e", fontSize: 13 }}>
              {failed.map((f) => <li key={f.line}>Строка {f.line} ({f.name || "без имени"}): {f.error}</li>)}
            </ul>
          )}
          {created.length > 0 && (
            <>
              <p style={{ color: "#777", fontSize: 13 }}>Логины и стартовые пароли новых сотрудников (по умолчанию логин и пароль — табельный номер). Передай их сотрудникам; пароль сотрудник меняет сам.</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", minWidth: 360 }}>
                  <thead><tr>{["Сотрудник", "Логин", "Пароль"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                  <tbody>{created.map((c) => <tr key={c.line}><td style={cell}>{c.name}</td><td style={cell}>{c.username}</td><td style={cell}>{c.password}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
