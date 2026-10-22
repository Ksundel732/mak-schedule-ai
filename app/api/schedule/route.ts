
import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const shifts = await prisma.shift.findMany({
      include: {
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { date: "asc" },
        { startTime: "asc" },
      ],
    });

    return NextResponse.json({ shifts });
  } catch (error) {
    console.error("SCHEDULE_LOAD_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить расписание" },
      { status: 500 }
    );
  }
}
