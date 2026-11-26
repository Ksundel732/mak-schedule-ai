-- CreateTable
CREATE TABLE IF NOT EXISTS "ScheduleAck" (
    "employeeId" INTEGER NOT NULL,
    "weekStart" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleAck_pkey" PRIMARY KEY ("employeeId", "weekStart")
);
