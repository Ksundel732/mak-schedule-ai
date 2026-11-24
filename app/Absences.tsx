"use client";

import { useCallback, useEffect, useState } from "react";

type Absence = { id: number; employeeId: number; type: string; startDate: string; endDate: string; note: string | null; employee: { name: string } };
type Person = { id: number; name: string };

const LABEL: Record<string, string> = { VACATION: "Отпуск", SICK: "Больничный", OTHER: "Другое" };
const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const field: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };
const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export default function Absences() {
  const [list, setList] = useState<Absence[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("VACATION");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([fetch("/api/absences", { cache: "no-store" }).then((r) => r.json()), fetch("/api/staff", { cache: "no-store" }).then((r) => r.json())]);
      if (a.error) setMsg(a.error); else setList(a.absences);
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
      const r = await fetch("/api/absences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, type, startDate, endDate: endDate || startDate, note }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setNote(""); setStart(""); setEnd("");
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await fetch("/api/absences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Отсутствие сотрудников</h2>
      <p style={{ margin: "0 0 16px", color: "#777", fontSize: 14 }}>Отпуск и больничный переопределяют доступность: при генерации расписания сотрудник в эти дни не ставится на смены.</p>
      <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, alignItems: "end" }}>
        <select style={field} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          <option value="">Сотрудник…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={field} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ fontSize: 13, color: "#777" }}>С<input type="date" style={field} value={startDate} onChange={(e) => setStart(e.target.value)} required /></label>
        <label style={{ fontSize: 13, color: "#777" }}>По (включительно)<input type="date" style={field} value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></label>
        <input style={field} placeholder="Примечание" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" disabled={busy} style={{ background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Сохраняю…" : "Добавить"}</button>
      </form>
      {msg && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#fdecec", color: "#b3261e" }}>{msg}</div>}
      <div style={{ marginTop: 20, display: "grid", gap: 6 }}>
        {list.length === 0 && !msg && <div style={{ color: "#777" }}>Отсутствий пока нет.</div>}
        {list.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
            <span><strong>{a.employee.name}</strong> · {LABEL[a.type] ?? a.type} · {fmt(a.startDate)} – {fmt(a.endDate)}{a.note ? ` · ${a.note}` : ""}</span>
            <button type="button" onClick={() => remove(a.id)} style={{ border: "1px solid #d5e2da", background: "white", borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "#b3261e" }}>Удалить</button>
          </div>
        ))}
      </div>
    </section>
  );
}
