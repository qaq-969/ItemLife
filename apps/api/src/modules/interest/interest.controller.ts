import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { InterestRunResult } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { InterestPostDto, InterestPreviewQueryDto } from './dto/interest.dto';
import { InterestService } from './interest.service';

@ApiBearerAuth()
@ApiTags('结息')
@Controller('interest')
export class InterestController {
  constructor(private readonly interest: InterestService) {}

  @Get('preview')
  @ApiOperation({ summary: '预估应计利息：Σ(每日余额 × 年化 ÷ 365)，只算不入账' })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InterestPreviewQueryDto,
  ): Promise<InterestRunResult[]> {
    return this.interest.preview(user.id, query);
  }

  @Post('post')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '手动结息：把应计利息记为一笔「利息收益」收入；重复提交不会重复入账' })
  post(@CurrentUser() user: AuthenticatedUser, @Body() dto: InterestPostDto): Promise<InterestRunResult> {
    return this.interest.post(user.id, dto.accountId);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiOperation({ summary: '立即结算所有到期账户（自动任务每日 02:30 也会执行一次）' })
  run(): Promise<InterestRunResult[]> {
    return this.interest.runDue();
  }
}
