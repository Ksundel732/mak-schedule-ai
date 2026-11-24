import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

const TYPES = ["VACATION", "SICK", "OTHER"];
const asDate = (v: unknown) => new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);

export async function GET() {
  try {
    const absences = await prisma.absence.findMany({
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { startDate: "asc" },
    });
    return NextResponse.json({ absences });
  } catch (error) {
    console.error("ABSENCES_LOAD_ERROR:", error);
    return NextResponse.json({ error: "Не удалось загрузить отсутствия. Проверь, что миграция базы выполнена." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    const startDate = asDate(b.startDate);
    const endDate = asDate(b.endDate);
    const type = TYPES.includes(b.type) ? b.type : "OTHER";

    if (!Number.isInteger(employeeId) || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return NextResponse.json({ error: "Укажи сотрудника и даты" }, { status: 400 });
    }
    if (endDate < startDate) {
      return NextResponse.json({ error: "Дата окончания раньше даты начала" }, { status: 400 });
    }

    const absence = await prisma.absence.create({
      data: { employeeId, type, startDate, endDate, note: b.note ? String(b.note).slice(0, 200) : null },
    });
    return NextResponse.json({ success: true, absence });
  } catch (error) {
    console.error("ABSENCE_CREATE_ERROR:", error);
    const detail = error instanceof Error ? error.message.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300) : "";
    return NextResponse.json({ error: `Не удалось сохранить отсутствие. ${detail}`.trim() }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await prisma.absence.delete({ where: { id: Number((await request.json()).id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("ABSENCE_DELETE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 });
  }
}