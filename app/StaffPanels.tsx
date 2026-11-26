"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPLOYMENT_LABELS, POSITION_OPTIONS } from "../src/lib/profile-table";

type Staff = { id: number; name: string; username: string; isMinor: boolean; skills: string[] };
type Catalog = { label: string; skills: string[] }[];

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
type Prof = { phone: string; birthDate: string; hireDate: string; employeeNumber: string; position: string; employment: string; email: string };
const EMPTY_PROF: Prof = { phone: "", birthDate: "", hireDate: "", employeeNumber: "", position: "", employment: "", email: "" };

function ProfileFields({ value, onChange }: { value: Prof; onChange: (v: Prof) => void }) {
  const set = (patch: Partial<Prof>) => onChange({ ...value, ...patch });
  const small: React.CSSProperties = { fontSize: 13, color: "#777" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
      <input style={input} placeholder="Табельный номер" value={value.employeeNumber} onChange={(e) => set({ employeeNumber: e.target.value })} />
      <input style={input} list="position-options" placeholder="Должность" value={value.position} onChange={(e) => set({ position: e.target.value })} />
      <datalist id="position-options">{POSITION_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
      <label style={small}>Занятость
        <select style={input} value={value.employment} onChange={(e) => set({ employment: e.target.value })}>
          <option value="">Не указано</option>
          {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <input style={input} placeholder="Телефон" value={value.phone} onChange={(e) => set({ phone: e.target.value })} />
      <input style={input} placeholder="Эл. почта" value={value.email} onChange={(e) => set({ email: e.target.value })} />
      <label style={small}>Дата рождения<input type="date" style={input} value={value.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></label>
      <label style={small}>Принят на работу<input type="date" style={input} value={value.hireDate} onChange={(e) => set({ hireDate: e.target.value })} /></label>
    </div>
  );
}

const card: React.CSSProperties = { marginTop: 24, background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.06)" };
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };
const green: React.CSSProperties = { background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 700, cursor: "pointer" };

function useStaff() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/staff", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка загрузки");
      setStaff(d.employees);
      setCatalog(d.catalog);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { staff, catalog, loadError, load };
}

function SkillPicker({ catalog, value, onChange }: { catalog: Catalog; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {catalog.map((g) => (
        <div key={g.label}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#30493a" }}>{g.label}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {g.skills.map((s) => (
              <button key={s} type="button" onClick={() => toggle(s)}
                style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid #d5e2da", cursor: "pointer", fontSize: 14,
                  background: value.includes(s) ? "#087f3e" : "white", color: value.includes(s) ? "white" : "#30493a" }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Окно «Сотрудники»: регистрация =====
export function RegisterPanel({ managerLogin, managerPassword }: { managerLogin: string; managerPassword: string }) {
  const { staff, catalog, loadError, load } = useStaff();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [prof, setProf] = useState<Prof>(EMPTY_PROF);
  const [skills, setSkills] = useState<string[]>([]);
  const [days, setDays] = useState(DAYS.map(() => ({ isOff: false, startTime: "09:00", endTime: "22:00" })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setDay = (i: number, patch: Partial<(typeof days)[number]>) =>
    setDays(days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password, isMinor, skills, ...prof,
          availability: days.map((d, i) => ({ dayOfWeek: i + 1, ...d })) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setMsg({ ok: true, text: `Сотрудник ${d.employee.name} зарегистрирован` });
      setName(""); setUsername(""); setPassword(""); setIsMinor(false); setSkills([]); setProf(EMPTY_PROF);
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" });
    } finally {
      setBusy(false);
    }
  }

  // Данные сотрудников (телефон, даты) и их редактирование
  const [profiles, setProfiles] = useState<Record<number, Prof>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Prof>(EMPTY_PROF);
  const [profMsg, setProfMsg] = useState("");

  const loadProfiles = useCallback(async () => {
    try {
      const d = await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json());
      const map: Record<number, Prof> = {};
      (d.profiles ?? []).forEach((p: Record<string, string | number | null>) => {
        const str = (k: string) => (p[k] == null ? "" : String(p[k]));
        map[Number(p.employeeId)] = { phone: str("phone"), birthDate: str("birthDate").slice(0, 10), hireDate: str("hireDate").slice(0, 10), employeeNumber: str("employeeNumber"), position: str("position"), employment: str("employment"), email: str("email") };
      });
      setProfiles(map);
    } catch {}
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  async function saveProfile(id: number) {
    setProfMsg("");
    try {
      const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: id, ...draft }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setEditId(null);
      loadProfiles();
    } catch (err) {
      setProfMsg(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function resetPassword(s: Staff) {
    const newPassword = window.prompt(`Новый пароль для ${s.name} (от 4 символов):`);
    if (!newPassword) return;
    try {
      const r = await fetch("/api/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerUsername: managerLogin, managerPassword, employeeId: s.id, newPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      window.alert(`Пароль для ${s.name} изменён. Передайте его сотруднику.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Ошибка");
    }
  }

  return (
    <>
      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 22 }}>Регистрация нового сотрудника</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <input style={input} placeholder="Имя и фамилия" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={input} placeholder="Логин" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
            <input style={input} placeholder="Пароль (от 4 символов)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <ProfileFields value={prof} onChange={setProf} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={isMinor} onChange={(e) => setIsMinor(e.target.checked)} />
            Несовершеннолетний
          </label>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Временные возможности (когда может работать)</div>
            <div style={{ display: "grid", gap: 6 }}>
              {days.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ width: 28 }}>{DAYS[i]}</strong>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", width: 100 }}>
                    <input type="checkbox" checked={d.isOff} onChange={(e) => setDay(i, { isOff: e.target.checked })} /> выходной
                  </label>
                  {!d.isOff && (
                    <>
                      <input type="time" style={{ ...input, width: 120 }} value={d.startTime} onChange={(e) => setDay(i, { startTime: e.target.value })} />
                      <span>–</span>
                      <input type="time" style={{ ...input, width: 120 }} value={d.endTime} onChange={(e) => setDay(i, { endTime: e.target.value })} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Обучен на позициях (можно заполнить позже в окне «Обучение»)</div>
            <SkillPicker catalog={catalog} value={skills} onChange={setSkills} />
          </div>

          {msg && <div style={{ padding: 12, borderRadius: 10, background: msg.ok ? "#e8f5ec" : "#fdecec", color: msg.ok ? "#176b3a" : "#b3261e" }}>{msg.text}</div>}
          <div><button type="submit" style={{ ...green, opacity: busy ? 0.6 : 1 }} disabled={busy}>{busy ? "Сохраняю…" : "Зарегистрировать"}</button></div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Сотрудники · {staff.length}</h2>
        {loadError && <div style={{ color: "#b3261e" }}>{loadError}</div>}
        <div style={{ display: "grid", gap: 6 }}>
          {staff.map((s) => (
          <div key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eee" }}>
              <span><strong>{s.name}</strong>{s.isMinor ? " · несовершеннолетний" : ""}</span>
              <span style={{ color: "#777", display: "flex", gap: 10, alignItems: "center" }}>
                {s.username}
                <button type="button" onClick={() => { setEditId(s.id); setProfMsg(""); setDraft(profiles[s.id] ?? EMPTY_PROF); }} style={{ border: "1px solid #d5e2da", background: "white", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>Данные</button>
                <button type="button" onClick={() => resetPassword(s)} style={{ border: "1px solid #d5e2da", background: "white", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>Сбросить пароль</button>
              </span>
            </div>
            {editId === s.id && (
              <div style={{ background: "#f4f8f5", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                <ProfileFields value={draft} onChange={setDraft} />
                {profMsg && <div style={{ color: "#b3261e" }}>{profMsg}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => saveProfile(s.id)} style={green}>Сохранить</button>
                  <button type="button" onClick={() => setEditId(null)} style={{ ...green, background: "white", color: "#30493a", border: "1px solid #d5e2da" }}>Отмена</button>
                </div>
              </div>
            )}
          </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ===== Окно «Обучение»: кто на чём обучен =====
export function TrainingPanel() {
  const { staff, catalog, loadError, load } = useStaff();
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(id: number) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: id, skills: draft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      setOpen(null);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Обучение сотрудников</h2>
      <p style={{ margin: "0 0 16px", color: "#777", fontSize: 14 }}>Отметь позиции, на которых сотрудник обучен: расписание ставит его только на них.</p>
      {loadError && <div style={{ color: "#b3261e" }}>{loadError}</div>}
      {staff.length === 0 && !loadError && <div style={{ color: "#777" }}>Сотрудников пока нет. Добавь их в окне «Сотрудники».</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {staff.map((s) => (
          <div key={s.id} style={{ border: "1px solid #e3ece6", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{s.name}</strong>
              {open !== s.id && (
                <button type="button" style={{ ...green, padding: "7px 14px" }} onClick={() => { setOpen(s.id); setDraft(s.skills); setMsg(""); }}>Изменить</button>
              )}
            </div>
            {open === s.id ? (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <SkillPicker catalog={catalog} value={draft} onChange={setDraft} />
                {msg && <div style={{ color: "#b3261e" }}>{msg}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={green} disabled={busy} onClick={() => save(s.id)}>{busy ? "Сохраняю…" : "Сохранить"}</button>
                  <button type="button" style={{ ...green, background: "white", color: "#30493a", border: "1px solid #d5e2da" }} onClick={() => setOpen(null)}>Отмена</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {s.skills.length === 0 ? <span style={{ color: "#b3261e", fontSize: 14 }}>Не обучен ни на одной позиции</span>
                  : s.skills.map((k) => <span key={k} style={{ background: "#e8f5ec", borderRadius: 999, padding: "4px 10px", fontSize: 13 }}>{k}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
