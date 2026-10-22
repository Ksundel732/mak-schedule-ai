
import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const requests = await prisma.availabilityRequest.findMany({
      include: {
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
        days: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("REQUESTS_GET_ERROR:", error);

    return NextResponse.json(
      { error: "Не удалось загрузить заявки" },
      { status: 500 }
    );
  }
}
