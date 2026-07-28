export interface CapabilityManifest {
  capabilityId: string;
  name: string;
  version: string;
  mode: 'read' | 'write';
  domain: string;
  targetUrl: string;
  author: string;
  status: 'DRAFT' | 'VALIDATING' | 'ACTIVE' | 'REJECTED' | 'DEGRADED' | 'RETIRED';
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  checksum: string;
  createdAt: number;
}
