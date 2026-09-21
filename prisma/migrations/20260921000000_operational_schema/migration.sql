-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('VALUE_CARD', 'GAUGE', 'LIVE_CHART', 'SWITCH');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OFFLINE', 'AUTOMATION_TRIGGERED', 'SYSTEM');

-- CreateTable
CREATE TABLE "widgets" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "datastreamId" TEXT NOT NULL,
    "type" "WidgetType" NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "w" INTEGER NOT NULL,
    "h" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conditionDatastreamId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "conditionValue" DOUBLE PRECISION NOT NULL,
    "actionDatastreamId" TEXT NOT NULL,
    "actionValue" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceIdentifier" TEXT NOT NULL,
    "virtualPin" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "widgets_deviceId_idx" ON "widgets"("deviceId");

-- CreateIndex
CREATE INDEX "widgets_datastreamId_idx" ON "widgets"("datastreamId");

-- CreateIndex
CREATE INDEX "automation_rules_deviceId_idx" ON "automation_rules"("deviceId");

-- CreateIndex
CREATE INDEX "automation_rules_conditionDatastreamId_idx" ON "automation_rules"("conditionDatastreamId");

-- CreateIndex
CREATE INDEX "automation_rules_actionDatastreamId_idx" ON "automation_rules"("actionDatastreamId");

-- CreateIndex
CREATE INDEX "notifications_deviceId_createdAt_idx" ON "notifications"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_commands_deviceId_idx" ON "device_commands"("deviceId");

-- CreateIndex
CREATE INDEX "device_commands_status_idx" ON "device_commands"("status");

-- AddForeignKey
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_datastreamId_fkey" FOREIGN KEY ("datastreamId") REFERENCES "datastreams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_conditionDatastreamId_fkey" FOREIGN KEY ("conditionDatastreamId") REFERENCES "datastreams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_actionDatastreamId_fkey" FOREIGN KEY ("actionDatastreamId") REFERENCES "datastreams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
