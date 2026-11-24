import { NextResponse } from "next/server";
import { prisma } from "../../../../src/lib/prisma";
import { getBreakMinutes, MINOR_LIMITS } from "../../../../src/lib/planner";

export const runtime = "nodejs";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

// Проверка правил политики: смена 2–12 ч, отдых между сменами от 12 ч,
// несовершеннолетние — до 8 ч и до 22:00, смены одного сотрудника не пересекаются
async function validate(input: {
  employeeId: number; date: Date; startTime: string; endTime: string; ignoreId?: number;
}) {
  const { employeeId, date, startTime, endTime, ignoreId } = input;
  if (!TIME.test(startTime) || !TIME.test(endTime)) return "Время укажи в формате ЧЧ:ММ";
  const start = mins(startTime);
  const end = mins(endTime);
  if (end <= start) return "Конец смены должен быть позже начала";
  if (end - start < 120) return "Смена не может быть короче 2 часов";
  if (end - start > 12 * 60) return "Смена не может быть длиннее 12 часов";

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return "Сотрудник не найден";
  if (employee.isMinor) {
    if (end - start > MINOR_LIMITS.maxHours * 60) return "Несовершеннолетнему нельзя больше 8 часов в день";
    if (end > MINOR_LIMITS.endMin) return "Несовершеннолетнему нельзя работать после 22:00";
  }

  const around = await prisma.shift.findMany({
    where: { employeeId, date: { gte: addDays(date, -1), lt: addDays(date, 2) }, NOT: ignoreId ? { id: ignoreId } : undefined },
  });
  for (const other of around) {
    const offset = Math.round((other.date.getTime() - date.getTime()) / 86400000) * 1440;
    const os = mins(other.startTime) + offset;
    const oe = mins(other.endTime) + offset;
    if (os < end && start < oe) return "У сотрудника уже есть смена в это время";
    if (oe <= start && start - oe < 720) return "Между сменами должно быть не меньше 12 часов отдыха";
    if (os >= end && os - end < 720) return "Между сменами должно быть не меньше 12 часов отдыха";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    const date = dayStart(String(b.date ?? ""));
    if (!Number.isInteger(employeeId) || Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Укажи сотрудника и дату" }, { status: 400 });
    }
    const startTime = String(b.startTime);
    const endTime = String(b.endTime);
    const error = await validate({ employeeId, date, startTime, endTime });
    if (error) return NextResponse.json({ error }, { status: 400 });

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    const shift = await prisma.shift.create({
      data: {
        employeeId, date, startTime, endTime,
        roleName: String(b.roleName || "Смена"),
        breakMins: getBreakMinutes(mins(endTime) - mins(startTime), Boolean(employee?.isMinor)),
      },
    });
    return NextResponse.json({ success: true, shift });
  } catch (e) {
    console.error("SHIFT_CREATE_ERROR:", e);
    return NextResponse.json({ error: "Не удалось добавить смену" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const b = await request.json();
    const id = Number(b.id);
    const current = await prisma.shift.findUnique({ where: { id }, include: { employee: true } });
    if (!current) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });

    const startTime = String(b.startTime ?? current.startTime);
    const endTime = String(b.endTime ?? current.endTime);
    const error = await validate({ employeeId: current.employeeId, date: current.date, startTime, endTime, ignoreId: id });
    if (error) return NextResponse.json({ error }, { status: 400 });

    const shift = await prisma.shift.update({
      where: { id },
      data: {
        startTime, endTime,
        roleName: b.roleName ? String(b.roleName) : current.roleName,
        breakMins: getBreakMinutes(mins(endTime) - mins(startTime), current.employee.isMinor),
      },
    });
    return NextResponse.json({ success: true, shift });
  } catch (e) {
    console.error("SHIFT_UPDATE_ERROR:", e);
    return NextResponse.json({ error: "Не удалось изменить смену" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number((await request.json()).id);
    await prisma.shift.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("SHIFT_DELETE_ERROR:", e);
    return NextResponse.json({ error: "Не удалось удалить смену" }, { status: 500 });
  }
}
