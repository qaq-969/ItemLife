import { Module } from '@nestjs/common';
import { CostService } from './cost.service';
import { AccessoriesController, ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  controllers: [ItemsController, AccessoriesController],
  providers: [ItemsService, CostService],
  exports: [ItemsService, CostService],
})
export class ItemsModule {}
