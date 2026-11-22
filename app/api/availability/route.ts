import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

// Постоянная доступность и навыки одного сотрудника
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = Number(searchParams.get("employeeId"));

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return NextResponse.json(
        { error: "Не указан сотрудник" },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        availabilities: {
          orderBy: { dayOfWeek: "asc" },
        },
        skills: {
          select: {
            skill: { select: { name: true } },
          },
        },
      },
    });

    if (!employee) {
      return NextResponse.json(
        { error: "Сотрудник не найден" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      availabilities: employee.availabilities,
      skills: employee.skills.map((item) => item.skill.name),
    });
  } catch (error) {
    console.error("AVAILABILITY_LOAD_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить доступность" },
      { status: 500 }
    );
  }
}
