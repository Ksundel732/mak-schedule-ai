import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

async function ensureTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "FixedShift" ("id" SERIAL NOT NULL, "employeeId" INTEGER NOT NULL, "dayOfWeek" INTEGER NOT NULL, "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "roleName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FixedShift_pkey" PRIMARY KEY ("id"))`
  );
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await prisma.fixedShift.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] });
    const names = await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, name: true } });
    return NextResponse.json({
      fixedShifts: rows.map((r) => ({ ...r, employeeName: names.find((n) => n.id === r.employeeId)?.name ?? `ID ${r.employeeId}` })),
    });
  } catch (error) {
    console.error("FIXED_LOAD_ERROR:", error);
    return NextResponse.json({ error: "Не удалось загрузить фиксированные смены" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    const dayOfWeek = Number(b.dayOfWeek);
    const startTime = String(b.startTime);
    const endTime = String(b.endTime);
    const roleName = String(b.roleName || "").trim();

    if (!Number.isInteger(employeeId) || !(dayOfWeek >= 1 && dayOfWeek <= 7) || !roleName) {
      return NextResponse.json({ error: "Укажи сотрудника, день и позицию" }, { status: 400 });
    }
    if (!TIME.test(startTime) || !TIME.test(endTime) || mins(endTime) - mins(startTime) < 120) {
      return NextResponse.json({ error: "Смена должна быть не короче 2 часов, время в формате ЧЧ:ММ" }, { status: 400 });
    }
    if (mins(endTime) - mins(startTime) > 12 * 60) {
      return NextResponse.json({ error: "Смена не может быть длиннее 12 часов" }, { status: 400 });
    }

    await ensureTable();
    await prisma.fixedShift.deleteMany({ where: { employeeId, dayOfWeek } });
    const fixedShift = await prisma.fixedShift.create({ data: { employeeId, dayOfWeek, startTime, endTime, roleName } });
    return NextResponse.json({ success: true, fixedShift });
  } catch (error) {
    console.error("FIXED_SAVE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить фиксированную смену" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await prisma.fixedShift.delete({ where: { id: Number((await request.json()).id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("FIXED_DELETE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 });
  }
}
