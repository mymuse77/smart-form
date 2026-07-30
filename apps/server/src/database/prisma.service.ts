import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../shared/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(APP_CONFIG)
    private readonly config: AppConfig,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (this.config.RESOURCE_REPOSITORY === 'prisma') {
      await this.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.config.RESOURCE_REPOSITORY === 'prisma') {
      await this.$disconnect();
    }
  }
}
