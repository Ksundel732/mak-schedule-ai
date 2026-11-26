-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "employeeNumber" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "position" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "employment" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "email" TEXT;
