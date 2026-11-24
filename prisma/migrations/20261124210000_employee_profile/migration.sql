-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeProfile" (
    "employeeId" INTEGER NOT NULL,
    "phone" TEXT,
    "birthDate" TIMESTAMP(3),
    "hireDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("employeeId")
);
