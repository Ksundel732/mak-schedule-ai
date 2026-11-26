// Создаёт таблицу данных сотрудника и недостающие колонки, если миграция ещё не применилась
type Raw = { $executeRawUnsafe: (query: string) => Promise<unknown> };

export const EMPLOYMENT_LABELS: Record<string, string> = {
  PART: "Неполное время",
  COMBINED: "Совместитель",
  FULL: "Полное время",
};

export const POSITION_OPTIONS = [
  "Член бригады ресторана 3 разряда",
  "Член бригады ресторана 4 разряда",
  "Бариста 3 разряда",
  "Инструктор производственного обучения 5 разряда",
  "Уборщик помещений 2 разряда",
  "Уборщик территорий 2 разряда",
  "Администратор зала",
  "Менеджер смены",
];

export async function ensureProfileTable(db: Raw) {
  await db.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "EmployeeProfile" ("employeeId" INTEGER NOT NULL, "phone" TEXT, "birthDate" TIMESTAMP(3), "hireDate" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("employeeId"))`
  );
  for (const column of ["employeeNumber", "position", "employment", "email"]) {
    await db.$executeRawUnsafe(`ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "${column}" TEXT`);
  }
}
