import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

// Если миграция ещё не применилась, создаём таблицу сами
async function ensureTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "EmployeeProfile" ("employeeId" INTEGER NOT NULL, "phone" TEXT, "birthDate" TIMESTAMP(3), "hireDate" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("employeeId"))`
  );
}

const asDate = (v: unknown) => {
  const text = String(v ?? "").slice(0, 10);
  if (!text) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET() {
  try {
    await ensureTable();
    const profiles = await prisma.employeeProfile.findMany();
    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("PROFILE_LOAD_ERROR:", error);
    return NextResponse.json({ profiles: [] });
  }
}

export async function PUT(request: Request) {
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Не указан сотрудник" }, { status: 400 });
    }
    const data = {
      phone: b.phone ? String(b.phone).trim().slice(0, 40) : null,
      birthDate: asDate(b.birthDate),
      hireDate: asDate(b.hireDate),
    };
    await ensureTable();
    await prisma.employeeProfile.upsert({ where: { employeeId }, update: data, create: { employeeId, ...data } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PROFILE_SAVE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить данные сотрудника" }, { status: 500 });
  }
}
