-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchItemStatus" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'EXECUTED', 'FAILED', 'EXPIRED', 'CANCELLED', 'SKIPPED');

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "virtualPin" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" "BatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "waveIndex" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_projectId_idx" ON "batches"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "batches_id_projectId_key" ON "batches"("id", "projectId");

-- CreateIndex
CREATE INDEX "batch_items_batchId_projectId_idx" ON "batch_items"("batchId", "projectId");

-- CreateIndex
CREATE INDEX "batch_items_deviceId_projectId_idx" ON "batch_items"("deviceId", "projectId");

-- CreateIndex
CREATE INDEX "batch_items_deviceId_virtualPin_idx" ON "batch_items"("deviceId", "virtualPin");

-- CreateIndex
CREATE UNIQUE INDEX "devices_id_projectId_key" ON "devices"("id", "projectId");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batchId_projectId_fkey" FOREIGN KEY ("batchId", "projectId") REFERENCES "batches"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_deviceId_projectId_fkey" FOREIGN KEY ("deviceId", "projectId") REFERENCES "devices"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_deviceId_virtualPin_fkey" FOREIGN KEY ("deviceId", "virtualPin") REFERENCES "datastreams"("deviceId", "virtualPin") ON DELETE CASCADE ON UPDATE CASCADE;
