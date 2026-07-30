CREATE TYPE "ResourceKind" AS ENUM ('capability', 'prompt', 'skill', 'rule');
CREATE TYPE "ResourceStatus" AS ENUM ('DRAFT', 'VALIDATING', 'ACTIVE', 'DEGRADED', 'RETIRED', 'REJECTED');
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidencePublicKey" TEXT NOT NULL,
    "evidenceSigningKeyId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "activeVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedResourceVersion" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL,
    "criteria" JSONB NOT NULL,
    "artifact" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagedResourceVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Artifact" (
    "internalId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "version" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signingKeyId" TEXT NOT NULL,
    "contentLength" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("internalId")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestId" TEXT,
    "detail" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Device_tenantId_status_idx" ON "Device"("tenantId", "status");
CREATE INDEX "ManagedResource_tenantId_kind_idx" ON "ManagedResource"("tenantId", "kind");
CREATE UNIQUE INDEX "ManagedResource_tenantId_resourceKey_key" ON "ManagedResource"("tenantId", "resourceKey");
CREATE INDEX "ManagedResourceVersion_tenantId_status_idx" ON "ManagedResourceVersion"("tenantId", "status");
CREATE UNIQUE INDEX "ManagedResourceVersion_resourceId_version_key" ON "ManagedResourceVersion"("resourceId", "version");
CREATE INDEX "Task_tenantId_deviceId_state_idx" ON "Task"("tenantId", "deviceId", "state");
CREATE INDEX "Artifact_tenantId_kind_idx" ON "Artifact"("tenantId", "kind");
CREATE UNIQUE INDEX "Artifact_tenantId_kind_artifactId_version_key" ON "Artifact"("tenantId", "kind", "artifactId", "version");
CREATE INDEX "AuditLog_tenantId_timestamp_idx" ON "AuditLog"("tenantId", "timestamp");
CREATE INDEX "AuditLog_tenantId_resource_resourceId_idx" ON "AuditLog"("tenantId", "resource", "resourceId");

ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedResource" ADD CONSTRAINT "ManagedResource_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedResourceVersion" ADD CONSTRAINT "ManagedResourceVersion_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "ManagedResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
