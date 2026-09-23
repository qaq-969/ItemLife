import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, BalanceService],
  exports: [BalanceService, TransactionsService],
})
export class TransactionsModule {}
