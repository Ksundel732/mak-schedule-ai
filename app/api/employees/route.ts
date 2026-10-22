
import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        role: "EMPLOYEE",
      },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isMinor: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({
      success: true,
      employees,
    });
  } catch (error) {
    console.error("EMPLOYEES_API_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить сотрудников" },
      { status: 500 }
    );
  }
}
