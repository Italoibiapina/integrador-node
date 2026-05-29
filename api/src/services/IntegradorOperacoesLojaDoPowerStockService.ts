import { PrismaClient } from '@prisma/client';
import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { PowerStockGetOperationsService } from './PowerStockGetOperationsService.js';
import { DispatcherService } from './DispatcherService.js';
import type { ApiServiceExecution } from './apiIntegrationTypes.js';

type IntegradorResult = {
  success: boolean;
  batchId: string;
  error?: string;
};

type IntegradorExecuteOptions = {
  dataEmissaoInicio?: string;
  dataEmissaoFim?: string;
};

export class IntegradorOperacoesLojaDoPowerStockService {
  private readonly powerStockService: PowerStockGetOperationsService;
  private readonly dispatcherService: DispatcherService;

  constructor(
    private readonly repository: ApiServiceRepository,
    private readonly prisma: PrismaClient
  ) {
    this.powerStockService = new PowerStockGetOperationsService(repository);
    this.dispatcherService = new DispatcherService(prisma, {
      maxConcurrency: 2,
      maxRetries: 3,
    });
  }

  async execute(
    triggerType: 'manual' | 'scheduled' = 'manual',
    options: IntegradorExecuteOptions = {}
  ): Promise<IntegradorResult> {
    const integradorConfig = await this.repository.getServiceByServiceName('IntegradorOperacoesLojaDoPowerStockService');
    if (!integradorConfig) {
      throw new Error('Service "IntegradorOperacoesLojaDoPowerStockService" não encontrado em api_services.');
    }

    const powerStockConfig = await this.repository.getServiceByServiceName('PowerStockGetOperationsService');
    if (!powerStockConfig) {
      throw new Error('Service "PowerStockGetOperationsService" não encontrado em api_services.');
    }

    const dispatcherConfig = await this.repository.getServiceByServiceName('DispatcherService');
    if (!dispatcherConfig) {
      throw new Error('Service "DispatcherService" não encontrado em api_services.');
    }

    const batchId = await this.repository.createBatch(triggerType, {
      name: 'IntegradorOperacoesLojaDoPowerStockService',
      description: 'Orquestra PowerStockGetOperationsService + DispatcherService',
      is_active: true,
      parametros: {
        powerstock_service_id: powerStockConfig.id,
        dispatcher_service_id: dispatcherConfig.id,
      },
      auth_config_id: powerStockConfig.auth_config_id,
    });

    const integradorExecutionId = await this.createExecution(batchId, integradorConfig.id, {
      service: { ...integradorConfig, name: 'IntegradorOperacoesLojaDoPowerStockService' },
      auth: {},
    });

    const powerStockExecutionId = await this.createExecution(batchId, powerStockConfig.id, {
      service: { ...powerStockConfig, name: 'PowerStockGetOperationsService (integrado)' },
      auth: powerStockConfig.auth_config_id
        ? (await this.repository.getAuthConfigById(powerStockConfig.auth_config_id)) ?? {}
        : {},
    }, integradorExecutionId);

    const dispatcherExecutionId = await this.createExecution(batchId, dispatcherConfig.id, {
      service: { ...dispatcherConfig, name: 'DispatcherService (integrado)' },
      auth: dispatcherConfig.auth_config_id
        ? (await this.repository.getAuthConfigById(dispatcherConfig.auth_config_id)) ?? {}
        : {},
    }, integradorExecutionId);

    let powerStockResult: { success: boolean; data?: any; error?: string } | null = null;
    const requestedRange = {
      dataEmissaoInicio: options.dataEmissaoInicio ?? null,
      dataEmissaoFim: options.dataEmissaoFim ?? null,
    };

    try {
      powerStockResult = await this.powerStockService.executeService(powerStockConfig.id, {
        batchId,
        executionId: powerStockExecutionId,
        dataEmissaoInicio: options.dataEmissaoInicio,
        dataEmissaoFim: options.dataEmissaoFim,
      });

      if (!powerStockResult.success) {
        await this.repository.finishServiceExecution(
          dispatcherExecutionId,
          'failed',
          new Date(),
          null,
          'Dispatcher não executado: etapa PowerStock falhou.'
        );
        const errorMessage = powerStockResult.error ?? 'Falha na etapa PowerStockGetOperationsService.';
        const resolvedRange = {
          dataEmissaoInicio: (powerStockResult.data?.dataEmissaoInicio as string | undefined) ?? requestedRange.dataEmissaoInicio,
          dataEmissaoFim: (powerStockResult.data?.dataEmissaoFim as string | undefined) ?? requestedRange.dataEmissaoFim,
        };
        await this.repository.finishServiceExecution(
          integradorExecutionId,
          'failed',
          new Date(),
          { ...resolvedRange, powerstock_success: false, dispatcher_executed: false },
          errorMessage
        );
        await this.repository.finishBatch(batchId, 'failed', errorMessage, {
          ...resolvedRange,
          powerstock_success: false,
          dispatcher_executed: false,
        });
        return { success: false, batchId, error: errorMessage };
      }

      await this.dispatcherService.processPendingBatch({
        batchId,
        executionId: dispatcherExecutionId,
        serviceId: dispatcherConfig.id,
      });

      const resolvedRange = {
        dataEmissaoInicio: (powerStockResult.data?.dataEmissaoInicio as string | undefined) ?? requestedRange.dataEmissaoInicio,
        dataEmissaoFim: (powerStockResult.data?.dataEmissaoFim as string | undefined) ?? requestedRange.dataEmissaoFim,
      };
      await this.repository.finishServiceExecution(integradorExecutionId, 'success', new Date(), {
        ...resolvedRange,
        powerstock_success: true,
        dispatcher_executed: true,
      });
      await this.repository.finishBatch(batchId, 'success', undefined, {
        ...resolvedRange,
        powerstock_success: true,
        dispatcher_executed: true,
      });
      return { success: true, batchId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalStatus = powerStockResult?.success ? 'partial' : 'failed';
      const resolvedRange = {
        dataEmissaoInicio: (powerStockResult?.data?.dataEmissaoInicio as string | undefined) ?? requestedRange.dataEmissaoInicio,
        dataEmissaoFim: (powerStockResult?.data?.dataEmissaoFim as string | undefined) ?? requestedRange.dataEmissaoFim,
      };
      await this.repository.finishServiceExecution(
        integradorExecutionId,
        finalStatus === 'partial' ? 'success' : 'failed',
        new Date(),
        {
          ...resolvedRange,
          powerstock_success: Boolean(powerStockResult?.success),
          dispatcher_executed: Boolean(powerStockResult?.success),
        },
        finalStatus === 'partial' ? `Execução parcial: ${message}` : message
      );
      await this.repository.finishBatch(batchId, finalStatus, message, {
        ...resolvedRange,
        powerstock_success: Boolean(powerStockResult?.success),
        dispatcher_executed: Boolean(powerStockResult?.success),
      });
      return { success: false, batchId, error: message };
    }
  }

  private async createExecution(
    batchId: string,
    serviceId: string,
    snapshotConfig: ApiServiceExecution['snapshot_config'],
    parentExecutionId?: string
  ): Promise<string> {
    return this.repository.createServiceExecution({
      batch_id: batchId,
      service_id: serviceId,
      parent_execution_id: parentExecutionId ?? null,
      snapshot_config: snapshotConfig,
      started_at: new Date(),
      status: 'running',
    });
  }
}
