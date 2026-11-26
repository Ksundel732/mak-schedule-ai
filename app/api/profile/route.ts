import { NextResponse } from "next/server";
import { prisma } from "../../../src/lib/prisma";
import { ensureProfileTable } from "../../../src/lib/profile-table";

export const runtime = "nodejs";

const asDate = (v: unknown) => {
  const text = String(v ?? "").slice(0, 10);
  if (!text) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const text = (v: unknown, max: number) => (v ? String(v).trim().slice(0, max) || null : null);

export async function GET(request: Request) {
  try {
    await ensureProfileTable(prisma);
    const id = Number(new URL(request.url).searchParams.get("employeeId"));
    const profiles = await prisma.employeeProfile.findMany({
      where: Number.isInteger(id) && id > 0 ? { employeeId: id } : undefined,
    });
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
      phone: text(b.phone, 40),
      birthDate: asDate(b.birthDate),
      hireDate: asDate(b.hireDate),
      employeeNumber: text(b.employeeNumber, 30),
      position: text(b.position, 80),
      employment: ["PART", "COMBINED", "FULL"].includes(b.employment) ? b.employment : null,
      email: text(b.email, 80),
    };
    await ensureProfileTable(prisma);
    await prisma.employeeProfile.upsert({ where: { employeeId }, update: data, create: { employeeId, ...data } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PROFILE_SAVE_ERROR:", error);
    return NextResponse.json({ error: "Не удалось сохранить данные сотрудника" }, { status: 500 });
  }
}
