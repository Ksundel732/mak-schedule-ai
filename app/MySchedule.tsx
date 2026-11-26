"use client";

import { useCallback, useEffect, useState } from "react";

type Shift = { id: number; date: string; startTime: string; endTime: string; breakMins?: number; roleName: string };

const DAY = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const key = (iso: string) => String(iso).slice(0, 10);
const ddmm = (k: string) => `${k.slice(8, 10)}.${k.slice(5, 7)}`;
const monday = (k: string) => {
  const d = new Date(`${k}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
};
const plusDays = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function MySchedule({ shifts, employeeId }: { shifts: Shift[]; employeeId: number }) {
  const [acks, setAcks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/ack?employeeId=${employeeId}`, { cache: "no-store" }).then((r) => r.json());
      const map: Record<string, string> = {};
      (d.acks ?? []).forEach((a: { weekStart: string; ackedAt: string }) => { map[a.weekStart] = a.ackedAt; });
      setAcks(map);
    } catch {}
  }, [employeeId]);
  useEffect(() => { if (employeeId) load(); }, [employeeId, load]);

  async function acknowledge(week: string) {
    setBusy(week);
    setError("");
    try {
      const r = await fetch("/api/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, weekStart: week }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  const sorted = [...shifts].sort((a, b) => key(a.date).localeCompare(key(b.date)) || a.startTime.localeCompare(b.startTime));
  const weeks = [...new Set(sorted.map((s) => monday(key(s.date))))];
  const next = sorted.find((s) => key(s.date) > today || (key(s.date) === today && toMin(s.endTime) > now.getHours() * 60 + now.getMinutes()));

  if (sorted.length === 0) {
    return <p>Смен пока нет. График появится здесь, когда менеджер его утвердит.</p>;
  }

  return (
    <div>
      {next && (
        <div style={{ background: "#e8f5ec", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#4b6455" }}>Ближайшая смена</div>
          <strong>{key(next.date) === today ? "Сегодня" : `${DAY[new Date(`${key(next.date)}T00:00:00Z`).getUTCDay()]} ${ddmm(key(next.date))}`}</strong>
          {" · "}{next.startTime}–{next.endTime} · {next.roleName}
        </div>
      )}
      {weeks.map((week) => {
        const list = sorted.filter((s) => monday(key(s.date)) === week);
        const hours = list.reduce((sum, s) => sum + (toMin(s.endTime) - toMin(s.startTime)) / 60, 0);
        const ackedAt = acks[week];
        return (
          <div key={week} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {ddmm(week)} – {ddmm(plusDays(week, 6))} · {list.length} смен · {Math.round(hours * 10) / 10} ч
            </div>
            <div className="availability">
              {list.map((s) => (
                <div key={s.id} style={key(s.date) === today ? { background: "#fff8e1", borderRadius: 8 } : undefined}>
                  <b>{DAY[new Date(`${key(s.date)}T00:00:00Z`).getUTCDay()]} {ddmm(key(s.date))}</b>
                  <span>
                    {s.startTime}–{s.endTime} · {s.roleName}
                    {s.breakMins ? ` · перерыв ${s.breakMins} мин` : ""}
                  </span>
                </div>
              ))}
            </div>
            {ackedAt ? (
              <div style={{ marginTop: 8, color: "#176b3a", fontSize: 14 }}>
                ✓ Ознакомлена и согласна ({new Date(ackedAt).toLocaleDateString("ru-RU")})
              </div>
            ) : (
              <button type="button" disabled={busy === week} onClick={() => acknowledge(week)}
                style={{ marginTop: 8, background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>
                {busy === week ? "Сохраняю…" : "Ознакомлен и согласен"}
              </button>
            )}
          </div>
        );
      })}
      {error && <div style={{ color: "#b3261e" }}>{error}</div>}
    </div>
  );
}
