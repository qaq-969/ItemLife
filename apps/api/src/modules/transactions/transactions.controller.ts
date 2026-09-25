import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Paginated, TransactionSummaryDto } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import {
  CreateTransactionDto,
  ListTransactionsQueryDto,
  SummaryQueryDto,
  UpdateTransactionDto,
} from './dto/transaction.dto';
import { TransactionVo } from './dto/transaction.vo';
import { TransactionsService } from './transactions.service';

@ApiBearerAuth()
@ApiTags('流水')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: '流水列表：游标分页（occurred_at + id 降序），支持类型 / 账户 / 分类 / 日期 / 备注筛选' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Paginated<TransactionVo>> {
    return this.transactions.list(user.id, query);
  }

  @Get('summary')
  @ApiOperation({ summary: '区间收支小计（转账不计入收支，仅统计收入与支出）' })
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: SummaryQueryDto): Promise<TransactionSummaryDto> {
    return this.transactions.summary(user.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: '移动端重复提交保护：24 小时内相同键返回首次结果' })
  @ApiOperation({ summary: '记一笔：收入 / 支出 / 转账（transfer_out + toAccountId 成对写入）' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransactionVo> {
    return this.transactions.create(user.id, dto, idempotencyKey);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改流水：金额 / 账户 / 分类 / 时间 / 备注 / 分摊项（转账仅支持金额与时间备注）' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<TransactionVo> {
    return this.transactions.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除流水：同步删除本流水新建的物品及追加配件，其他共享流水实时扣减对应金额' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.transactions.remove(user.id, id);
  }
}
