import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './auth/access-token.guard';
import { ArtifactController } from './artifacts/artifact.controller';
import { FileArtifactStore } from './artifacts/artifact-store';
import { ArtifactService } from './artifacts/artifact.service';
import {
  ACCESS_TOKEN_VERIFIER,
} from './auth/auth.types';
import { ConfiguredAccessTokenVerifier } from './auth/access-token.verifier';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health/health.controller';
import { RealtimeHub } from './realtime/realtime-hub';
import { InMemoryResourceRepository } from './resources/in-memory-resource.repository';
import { PrismaResourceRepository } from './resources/prisma-resource.repository';
import { ResourceController } from './resources/resource.controller';
import type { ResourceRepository } from './resources/resource.repository';
import { ResourceService } from './resources/resource.service';
import { APP_CONFIG, loadConfig } from './shared/config';
import { TaskController } from './tasks/task.controller';
import { TaskCoordinator } from './tasks/task-coordinator';
import { InMemoryTaskRepository } from './tasks/in-memory-task.repository';
import { PrismaTaskRepository } from './tasks/prisma-task.repository';
import type { TaskRepository } from './tasks/task.repository';

export const RESOURCE_REPOSITORY = Symbol('RESOURCE_REPOSITORY');
export const ARTIFACT_STORE = Symbol('ARTIFACT_STORE');
export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');

@Module({
  controllers: [HealthController, ResourceController, ArtifactController, TaskController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
    PrismaService,
    PrismaResourceRepository,
    PrismaTaskRepository,
    {
      provide: ARTIFACT_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof loadConfig>) => (
        new FileArtifactStore(config.ARTIFACT_ROOT)
      ),
    },
    {
      provide: ArtifactService,
      inject: [ARTIFACT_STORE, APP_CONFIG],
      useFactory: (
        store: FileArtifactStore,
        config: ReturnType<typeof loadConfig>,
      ) => new ArtifactService(store, config),
    },
    {
      provide: RESOURCE_REPOSITORY,
      inject: [APP_CONFIG, PrismaResourceRepository],
      useFactory: (
        config: ReturnType<typeof loadConfig>,
        prismaRepository: PrismaResourceRepository,
      ): ResourceRepository => config.RESOURCE_REPOSITORY === 'prisma'
        ? prismaRepository
        : new InMemoryResourceRepository(),
    },
    {
      provide: ResourceService,
      inject: [RESOURCE_REPOSITORY],
      useFactory: (repository: ResourceRepository) => new ResourceService(repository),
    },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof loadConfig>) => (
        new ConfiguredAccessTokenVerifier(config)
      ),
    },
    AccessTokenGuard,
    RealtimeHub,
    {
      provide: TASK_REPOSITORY,
      inject: [APP_CONFIG, PrismaTaskRepository],
      useFactory: (
        config: ReturnType<typeof loadConfig>,
        prismaRepository: PrismaTaskRepository,
      ): TaskRepository => config.RESOURCE_REPOSITORY === 'prisma'
        ? prismaRepository
        : new InMemoryTaskRepository(),
    },
    {
      provide: TaskCoordinator,
      inject: [ResourceService, RealtimeHub, TASK_REPOSITORY],
      useFactory: (
        resources: ResourceService,
        realtime: RealtimeHub,
        tasks: TaskRepository,
      ) => (
        new TaskCoordinator(resources, realtime, tasks)
      ),
    },
  ],
})
export class AppModule {}
