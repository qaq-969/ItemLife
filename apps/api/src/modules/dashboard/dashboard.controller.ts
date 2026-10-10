import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DashboardBreakdownDto, DashboardOverviewDto, DashboardTrendDto } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

@ApiBearerAuth()
@ApiTags('看板')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: '区间消费、收入、储蓄、收益、当前净值、同环比与物品投入' })
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: DashboardQueryDto): Promise<DashboardOverviewDto> {
    return this.dashboard.overview(user.id, query);
  }

  @Get('trend')
  @ApiOperation({ summary: '消费、收入、储蓄、收益与净值趋势' })
  trend(@CurrentUser() user: AuthenticatedUser, @Query() query: DashboardQueryDto): Promise<DashboardTrendDto> {
    return this.dashboard.trend(user.id, query);
  }

  @Get('breakdown')
  @ApiOperation({ summary: '支出分类占比与账户余额分布' })
  breakdown(@CurrentUser() user: AuthenticatedUser, @Query() query: DashboardQueryDto): Promise<DashboardBreakdownDto> {
    return this.dashboard.breakdown(user.id, query);
  }
}
