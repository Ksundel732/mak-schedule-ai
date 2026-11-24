-- CreateTable
CREATE TABLE "Forecast" (
    "dayOfWeek" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("dayOfWeek")
);
