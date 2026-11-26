import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

async function ensureTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "ScheduleAck" ("employeeId" INTEGER NOT NULL, "weekStart" TEXT NOT NULL, "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ScheduleAck_pkey" PRIMARY KEY ("employeeId", "weekStart"))`
  );
}

// Кто с какой неделей ознакомился (для одного сотрудника или для всех)
export async function GET(request: Request) {
  try {
    await ensureTable();
    const id = Number(new URL(request.url).searchParams.get("employeeId"));
    const acks = await prisma.scheduleAck.findMany({
      where: Number.isInteger(id) && id > 0 ? { employeeId: id } : undefined,
    });
    return NextResponse.json({ acks });
  } catch (error) {
    console.error("ACK_LOAD_ERROR:", error);
    return NextResponse.json({ acks: [] });
  }
}

// «Ознакомлен и согласен» с расписанием недели
export async function POST(request: Request) {
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    const weekStart = String(b.weekStart ?? "").slice(0, 10);

    if (!Number.isInteger(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: "Не указана неделя" }, { status: 400 });
    }

    await ensureTable();
    const ack = await prisma.scheduleAck.upsert({
      where: { employeeId_weekStart: { employeeId, weekStart } },
      update: {},
      create: { employeeId, weekStart },
    });
    return NextResponse.json({ success: true, ack });
  } catch (error) {
    console.error("ACK_SAVE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить ознакомление" }, { status: 500 });
  }
}
