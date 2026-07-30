import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ManagedResourceKind,
  type ManagedResourceKind as ResourceKind,
  type RuntimeCompatibility,
} from '@smart-form/contracts';
import { AccessTokenGuard, type AuthenticatedRequest } from '../auth/access-token.guard';
import { ValidationError } from '../shared/app-error';
import { ArtifactService } from './artifact.service';

interface PublishArtifactBody {
  artifactId: string;
  kind: ResourceKind;
  version: string;
  contentBase64: string;
  compatibility?: RuntimeCompatibility;
}

@Controller('/v1/artifacts')
@UseGuards(AccessTokenGuard)
export class ArtifactController {
  constructor(
    @Inject(ArtifactService)
    private readonly service: ArtifactService,
  ) {}

  @Post()
  publish(
    @Req() request: AuthenticatedRequest,
    @Body() body: PublishArtifactBody,
  ) {
    if (!body.contentBase64 || body.contentBase64.length > 8_000_000) {
      throw new ValidationError('Artifact content is missing or exceeds the API upload limit');
    }
    const content = Buffer.from(body.contentBase64, 'base64');
    return this.service.publish({
      tenantId: request.principal.tenantId,
      artifactId: body.artifactId,
      kind: ManagedResourceKind.parse(body.kind),
      version: body.version,
      content,
      compatibility: body.compatibility,
    });
  }

  @Get('/signing-keys/current')
  currentSigningKey() {
    return this.service.getCurrentSigningKey();
  }

  @Get('/:kind/:artifactId/versions/:version')
  async download(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param('kind') kindInput: string,
    @Param('artifactId') artifactId: string,
    @Param('version') version: string,
  ): Promise<void> {
    const kind = ManagedResourceKind.parse(kindInput);
    const artifact = await this.service.get(
      request.principal.tenantId,
      kind,
      artifactId,
      version,
    );
    response.setHeader('content-type', 'application/octet-stream');
    response.setHeader('content-length', artifact.content.byteLength);
    response.setHeader('etag', `"sha256:${artifact.reference.sha256}"`);
    response.send(artifact.content);
  }
}
