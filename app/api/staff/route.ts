import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";
import { GROUPS, OTHER_SKILLS } from "../../../src/lib/planner";

export const runtime = "nodejs";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Список сотрудников с навыками + каталог позиций для окон менеджера
export async function GET() {
  try {
    const employees = await prisma.employee.findMany({
      where: { role: "EMPLOYEE" },
      select: {
        id: true,
        name: true,
        username: true,
        isMinor: true,
        createdAt: true,
        skills: { select: { skill: { select: { name: true } } } },
        availabilities: { select: { dayOfWeek: true, isOff: true, startTime: true, endTime: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      employees: employees.map((e) => ({
        ...e,
        skills: e.skills.map((s) => s.skill.name),
      })),
      catalog: [
        ...GROUPS.map((g) => ({ label: g.label, skills: g.skills })),
        { label: "Прочие позиции (в расчёт расписания не входят)", skills: OTHER_SKILLS },
      ],
    });
  } catch (error) {
    console.error("STAFF_LOAD_ERROR:", error);
    return NextResponse.json({ error: "Не удалось загрузить сотрудников" }, { status: 500 });
  }
}

// Регистрация нового сотрудника
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const skills: string[] = Array.isArray(body.skills) ? body.skills.map(String) : [];
    const days = Array.isArray(body.availability) ? body.availability : [];

    if (!name || !username || password.length < 4) {
      return NextResponse.json(
        { error: "Укажи имя, логин и пароль (минимум 4 символа)" },
        { status: 400 }
      );
    }

    const availability = [];
    for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
      const d = days.find((x: { dayOfWeek?: number }) => Number(x.dayOfWeek) === dayOfWeek);
      if (!d || d.isOff) {
        availability.push({ dayOfWeek, isOff: true, startTime: null, endTime: null });
        continue;
      }
      if (!TIME.test(d.startTime) || !TIME.test(d.endTime) || d.startTime >= d.endTime) {
        return NextResponse.json(
          { error: `Проверь время в дне ${dayOfWeek}: начало должно быть раньше конца` },
          { status: 400 }
        );
      }
      availability.push({ dayOfWeek, isOff: false, startTime: d.startTime, endTime: d.endTime });
    }

    if (await prisma.employee.findUnique({ where: { username } })) {
      return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 });
    }

    const employee = await prisma.employee.create({
      data: {
        name,
        username,
        password,
        isMinor: Boolean(body.isMinor),
        availabilities: { create: availability },
        skills: {
          create: [...new Set(skills)].map((skillName) => ({
            skill: {
              connectOrCreate: { where: { name: skillName }, create: { name: skillName } },
            },
          })),
        },
      },
      select: { id: true, name: true },
    });

    if (body.phone || body.birthDate || body.hireDate) {
      try {
        await prisma.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "EmployeeProfile" ("employeeId" INTEGER NOT NULL, "phone" TEXT, "birthDate" TIMESTAMP(3), "hireDate" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("employeeId"))`
        );
        const day = (v: unknown) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : null);
        await prisma.employeeProfile.create({
          data: { employeeId: employee.id, phone: body.phone ? String(body.phone).slice(0, 40) : null, birthDate: day(body.birthDate), hireDate: day(body.hireDate) },
        });
      } catch (profileError) {
        console.error("PROFILE_CREATE_ERROR:", profileError);
      }
    }

    return NextResponse.json({ success: true, employee });
  } catch (error) {
    console.error("STAFF_CREATE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось зарегистрировать сотрудника" }, { status: 500 });
  }
}

// Обучение: полностью заменяет список навыков сотрудника
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const employeeId = Number(body.employeeId);
    const skills: string[] = Array.isArray(body.skills) ? [...new Set(body.skills.map(String))] as string[] : [];

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: "Не указан сотрудник" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.employeeSkill.deleteMany({ where: { employeeId } });
      for (const name of skills) {
        const skill = await tx.skill.upsert({ where: { name }, update: {}, create: { name } });
        await tx.employeeSkill.create({ data: { employeeId, skillId: skill.id } });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("STAFF_SKILLS_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить обучение" }, { status: 500 });
  }
}
