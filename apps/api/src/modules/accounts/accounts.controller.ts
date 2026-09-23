import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccountSummaryDto } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, ListAccountsQueryDto, UpdateAccountDto } from './dto/account.dto';
import { AccountVo } from './dto/account.vo';

@ApiBearerAuth()
@ApiTags('账户')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({ summary: '账户列表：随行返回派生余额（初始 + Σ收入 − Σ支出 + Σ转入 − Σ转出）' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAccountsQueryDto): Promise<AccountVo[]> {
    return this.accounts.list(user.id, query);
  }

  @Get('summary')
  @ApiOperation({ summary: '余额汇总：总额与按账户类型分组的小计' })
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAccountsQueryDto): Promise<AccountSummaryDto> {
    return this.accounts.summary(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: '新建账户；年化利率与结息周期成对提供即开启自动结息' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAccountDto): Promise<AccountVo> {
    return this.accounts.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '改名称 / 类型 / 排序 / 计息配置（传 null 关闭计息）' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountVo> {
    return this.accounts.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账户：仅限无流水的账户，否则返回 409' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.accounts.remove(user.id, id);
  }
}
