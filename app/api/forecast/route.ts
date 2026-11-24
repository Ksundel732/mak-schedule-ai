import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";
import { DAILY_ORDERS } from "../../../src/lib/planner";

export const runtime = "nodejs";

// Если миграция ещё не применилась, создаём таблицу прогноза сами
async function ensureTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "Forecast" ("dayOfWeek" INTEGER NOT NULL, "orders" INTEGER NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Forecast_pkey" PRIMARY KEY ("dayOfWeek"))`
  );
}

// Прогноз заказов по дням недели (1 — Пн … 7 — Вс): сохранённый или стандартный
export async function GET() {
  const orders: Record<number, number> = { ...DAILY_ORDERS };
  try {
    await ensureTable();
    const rows = await prisma.forecast.findMany();
    rows.forEach((r) => { orders[r.dayOfWeek] = r.orders; });
  } catch (error) {
    console.error("FORECAST_LOAD_ERROR:", error);
  }
  return NextResponse.json({ orders });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const entries: [number, number][] = [];

    for (let day = 1; day <= 7; day++) {
      const value = Number(body.orders?.[day]);
      if (!Number.isInteger(value) || value < 0 || value > 20000) {
        return NextResponse.json({ error: `Проверь число заказов для дня ${day}: целое от 0 до 20000` }, { status: 400 });
      }
      entries.push([day, value]);
    }

    await ensureTable();
    await prisma.$transaction(
      entries.map(([dayOfWeek, orders]) =>
        prisma.forecast.upsert({ where: { dayOfWeek }, update: { orders }, create: { dayOfWeek, orders } })
      )
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("FORECAST_SAVE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить прогноз. Возможно, таблица прогноза ещё не создана в базе." }, { status: 500 });
  }
}