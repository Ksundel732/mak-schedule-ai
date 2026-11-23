"use client";

import { useState } from "react";

const field: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #d5e2da", fontSize: 15, width: "100%", boxSizing: "border-box" };

export default function ChangePassword({
  username,
  currentPassword,
  onChanged,
}: {
  username: string;
  currentPassword: string;
  onChanged: (newPassword: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [repeat, setRepeat] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false); setOld(""); setNew(""); setRepeat(""); setMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== repeat) return setMsg({ ok: false, text: "Новые пароли не совпадают" });
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, oldPassword, newPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ошибка");
      onChanged(newPassword);
      setMsg({ ok: true, text: "Пароль изменён" });
      setOld(""); setNew(""); setRepeat("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="logout-button" style={{ marginRight: 8 }} onClick={() => { setOpen(true); setOld(currentPassword ? "" : ""); }}>
        Сменить пароль
      </button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380, display: "grid", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 20 }}>Смена пароля</h3>
            <input style={field} type="password" placeholder="Старый пароль" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
            <input style={field} type="password" placeholder="Новый пароль (от 4 символов)" value={newPassword} onChange={(e) => setNew(e.target.value)} />
            <input style={field} type="password" placeholder="Повторите новый пароль" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            {msg && <div style={{ padding: 10, borderRadius: 10, background: msg.ok ? "#e8f5ec" : "#fdecec", color: msg.ok ? "#176b3a" : "#b3261e" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={busy} style={{ background: "#087f3e", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Сохраняю…" : "Сохранить"}</button>
              <button type="button" onClick={close} style={{ background: "white", border: "1px solid #d5e2da", borderRadius: 10, padding: "10px 16px", cursor: "pointer" }}>Закрыть</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
