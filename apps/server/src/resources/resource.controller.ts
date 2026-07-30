import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  ManagedResourceVersion,
  ResourceMatchRequest,
} from '@smart-form/contracts';
import { AccessTokenGuard, type AuthenticatedRequest } from '../auth/access-token.guard';
import { ForbiddenError } from '../shared/app-error';
import { ResourceService } from './resource.service';

@Controller('/v1/resources')
@UseGuards(AccessTokenGuard)
export class ResourceController {
  constructor(
    @Inject(ResourceService)
    private readonly service: ResourceService,
  ) {}

  @Post('/versions')
  publish(
    @Req() request: AuthenticatedRequest,
    @Body() body: ManagedResourceVersion,
  ) {
    if (body.tenantId !== request.principal.tenantId) {
      throw new ForbiddenError('Cannot publish resources for another tenant');
    }
    return this.service.publish(body);
  }

  @Post('/match')
  match(
    @Req() request: AuthenticatedRequest,
    @Body() body: ResourceMatchRequest,
  ) {
    if (body.tenantId !== request.principal.tenantId) {
      throw new ForbiddenError('Cannot match resources for another tenant');
    }
    return this.service.match(body);
  }

  @Post('/:resourceId/versions/:version/activate')
  activate(
    @Req() request: AuthenticatedRequest,
    @Param('resourceId') resourceId: string,
    @Param('version') version: string,
  ) {
    return this.service.activate(request.principal.tenantId, resourceId, version);
  }

  @Post('/:resourceId/versions/:version/rollback')
  rollback(
    @Req() request: AuthenticatedRequest,
    @Param('resourceId') resourceId: string,
    @Param('version') version: string,
  ) {
    return this.service.rollback(request.principal.tenantId, resourceId, version);
  }
}
