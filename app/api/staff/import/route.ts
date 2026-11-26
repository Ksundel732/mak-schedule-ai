import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";
import { positionName, POSITIONS } from "../../../../src/lib/planner";
import { ensureProfileTable } from "../../../../src/lib/profile-table";

export const runtime = "nodejs";

type Row = {
  name?: string;
  employeeNumber?: string;
  phone?: string;
  birthDate?: string; // YYYY-MM-DD
  hireDate?: string; // YYYY-MM-DD
  position?: string;
  employment?: string; // PART | COMBINED | FULL
  email?: string;
  skills?: string[]; // коды позиций: C1, I, Z ...
  availability?: { dayOfWeek: number; isOff: boolean; startTime: string | null; endTime: string | null }[];
  username?: string;
  password?: string;
};

const MAX_ROWS = 200;
const RU: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const translit = (s: string) =>
  s.toLowerCase().split("").map((ch) => (ch in RU ? RU[ch] : ch)).join("").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");

const asDate = (v: unknown) => {
  const text = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const clip = (v: unknown, max: number) => (v ? String(v).trim().slice(0, max) || null : null);

const isMinorOn = (birth: Date | null) => {
  if (!birth) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age < 18;
};

const TIME = /^([01]\d|2[0-4]):[0-5]\d$/;
const cleanAvailability = (list: Row["availability"]) => {
  if (!Array.isArray(list) || list.length !== 7) return null;
  const out = [];
  for (let d = 1; d <= 7; d++) {
    const a = list.find((x) => Number(x.dayOfWeek) === d);
    if (!a || a.isOff) { out.push({ dayOfWeek: d, isOff: true, startTime: null, endTime: null }); continue; }
    if (!a.startTime || !a.endTime || !TIME.test(a.startTime) || !TIME.test(a.endTime) || a.startTime >= a.endTime) throw new Error(`неверное время доступности в дне ${d}`);
    out.push({ dayOfWeek: d, isOff: false, startTime: a.startTime, endTime: a.endTime });
  }
  return out;
};

const skillNamesFor = (codes: string[] | undefined) => {
  if (!codes?.length) return null;
  const names: string[] = [];
  for (const raw of codes) {
    const code = String(raw).trim().toUpperCase();
    const pos = POSITIONS.find((p) => p.code === code);
    if (pos && !names.includes(positionName(pos))) names.push(positionName(pos));
  }
  return names;
};

// Массовый импорт сотрудников (Excel / CSV / вставка из таблицы).
// Существующий сотрудник (по табельному номеру, иначе по имени) обновляется,
// остальные создаются. Пароль сотрудника при обновлении не меняется.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const manager = await prisma.employee.findFirst({
      where: { username: { equals: String(body.managerUsername ?? "").trim(), mode: "insensitive" } },
    });
    if (!manager || manager.role !== "MANAGER" || manager.password !== String(body.managerPassword ?? "")) {
      return NextResponse.json({ error: "Нет прав менеджера" }, { status: 403 });
    }

    const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Нет строк для импорта" }, { status: 400 });
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `За один запрос — не больше ${MAX_ROWS} строк` }, { status: 400 });

    await ensureProfileTable(prisma);

    // один раз загружаем всех, чтобы не делать запросы на каждую строку
    const [employees, profiles] = await Promise.all([
      prisma.employee.findMany({ where: { role: "EMPLOYEE" }, select: { id: true, name: true } }),
      prisma.employeeProfile.findMany({ select: { employeeId: true, employeeNumber: true } }),
    ]);
    const allUsernames = new Set((await prisma.employee.findMany({ select: { username: true } })).map((e) => e.username.toLowerCase()));
    const byNumber = new Map<string, number>();
    profiles.forEach((p) => { if (p.employeeNumber) byNumber.set(p.employeeNumber.trim(), p.employeeId); });
    const byName = new Map<string, number>();
    employees.forEach((e) => byName.set(e.name.trim().toLowerCase(), e.id));
    const employeeIds = new Set(employees.map((e) => e.id));
    const withNumber = new Set(byNumber.values());

    const results: { line: number; name: string; status: "created" | "updated" | "error"; username?: string; password?: string; error?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = Number(body.firstLine ?? 1) + i;
      const name = String(row.name ?? "").trim().slice(0, 80);
      const number = clip(row.employeeNumber, 30);

      try {
        if (!name) throw new Error("не указано имя");

        const birth = asDate(row.birthDate);
        const profileData = {
          phone: clip(row.phone, 40),
          birthDate: birth,
          hireDate: asDate(row.hireDate),
          employeeNumber: number,
          position: clip(row.position, 80),
          employment: ["PART", "COMBINED", "FULL"].includes(String(row.employment)) ? String(row.employment) : null,
          email: clip(row.email, 80),
        };
        const skills = skillNamesFor(row.skills);
        const availability = cleanAvailability(row.availability);

        // по табельному номеру; по имени — только если у найденного сотрудника нет другого номера
        let id = (number && byNumber.get(number)) || 0;
        if (!id) {
          const sameName = byName.get(name.toLowerCase()) ?? 0;
          if (sameName && !(number && withNumber.has(sameName))) id = sameName;
        }
        if (id && !employeeIds.has(id)) id = 0;
        let status: "created" | "updated" = "updated";
        let username: string | undefined;
        let password: string | undefined;

        if (!id) {
          status = "created";
          const base = clip(row.username, 40)?.toLowerCase() || number || translit(name) || "user";
          username = base;
          for (let n = 2; allUsernames.has(username.toLowerCase()); n++) username = `${base}${n}`;
          password = clip(row.password, 40) || (number ? number.padStart(4, "0") : "") || "1234";
          if (password.length < 4) password = password.padStart(4, "0");

          const created = await prisma.employee.create({
            data: {
              name,
              username,
              password,
              role: "EMPLOYEE",
              isMinor: isMinorOn(birth),
              availabilities: {
                create: availability ?? Array.from({ length: 7 }, (_, d) => ({
                  dayOfWeek: d + 1,
                  isOff: false,
                  startTime: "07:00",
                  endTime: isMinorOn(birth) ? "22:00" : "23:00",
                })),
              },
            },
            select: { id: true },
          });
          id = created.id;
          allUsernames.add(username.toLowerCase());
          employeeIds.add(id);
        } else {
          // существующий: обновляем имя и возраст (если известна дата рождения)
          await prisma.employee.update({
            where: { id },
            data: { name, ...(birth ? { isMinor: isMinorOn(birth) } : {}) },
          });
        }

        // доступность из файла заменяет прежнюю; если колонка пустая — не трогаем
        if (availability && status === "updated") {
          for (const a of availability) {
            await prisma.permanentAvailability.upsert({
              where: { employeeId_dayOfWeek: { employeeId: id, dayOfWeek: a.dayOfWeek } },
              update: { isOff: a.isOff, startTime: a.startTime, endTime: a.endTime },
              create: { employeeId: id, ...a },
            });
          }
        }

        // обновление профиля: пустые ячейки не стирают уже сохранённое
        const existing = await prisma.employeeProfile.findUnique({ where: { employeeId: id } });
        const merged = {
          phone: profileData.phone ?? existing?.phone ?? null,
          birthDate: profileData.birthDate ?? existing?.birthDate ?? null,
          hireDate: profileData.hireDate ?? existing?.hireDate ?? null,
          employeeNumber: profileData.employeeNumber ?? existing?.employeeNumber ?? null,
          position: profileData.position ?? existing?.position ?? null,
          employment: profileData.employment ?? existing?.employment ?? null,
          email: profileData.email ?? existing?.email ?? null,
        };
        await prisma.employeeProfile.upsert({ where: { employeeId: id }, update: merged, create: { employeeId: id, ...merged } });
        if (merged.employeeNumber) { byNumber.set(merged.employeeNumber, id); withNumber.add(id); }
        byName.set(name.toLowerCase(), id);

        if (skills) {
          await prisma.$transaction(async (tx) => {
            await tx.employeeSkill.deleteMany({ where: { employeeId: id } });
            for (const skillName of skills) {
              const skill = await tx.skill.upsert({ where: { name: skillName }, update: {}, create: { name: skillName } });
              await tx.employeeSkill.create({ data: { employeeId: id, skillId: skill.id } });
            }
          });
        }

        results.push({ line, name, status, username, password });
      } catch (rowError) {
        console.error("STAFF_IMPORT_ROW_ERROR:", line, rowError);
        results.push({ line, name, status: "error", error: rowError instanceof Error ? rowError.message : "ошибка" });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("STAFF_IMPORT_ERROR:", error);
    return NextResponse.json({ error: "Не удалось выполнить импорт" }, { status: 500 });
  }
}
