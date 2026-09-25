import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Paginated } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { AccessoryQtyDto, CreateAccessoryDto, CreateItemDto, InventoryRevertDto, ListItemsQueryDto, UpdateItemDto } from './dto/item.dto';
import { AccessoryUsageVo, AccessoryVo, ItemDetailVo, ItemsOverviewVo, ItemVo } from './dto/item.vo';
import { ItemsService } from './items.service';

@ApiBearerAuth()
@ApiTags('物品')
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @ApiOperation({ summary: '物品列表：游标分页，含成本指标；支持状态 / 分类 / 名称筛选' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListItemsQueryDto): Promise<Paginated<ItemVo>> {
    return this.items.list(user.id, query);
  }

  @Get('overview')
  @ApiOperation({ summary: '物品看板：总投入、当前持有成本、配件库存价值、在役数与成本排行' })
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: ListItemsQueryDto): Promise<ItemsOverviewVo> {
    return this.items.overview(user.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建物品：可同时带入配件批次（含初始已用数）' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateItemDto): Promise<ItemVo> {
    return this.items.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '物品详情：成本指标 + 配件批次 + 使用审计 + 成本演进 + 关联流水' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<ItemDetailVo> {
    return this.items.detail(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑物品：名称 / 分类 / 购买日 / 本体价 / 预期寿命 / 状态 / 备注' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ): Promise<ItemVo> {
    return this.items.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除物品：同步移除流水分摊并扣减流水金额，生成可追溯撤销记录' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InventoryRevertDto): Promise<null> {
    return this.items.remove(user.id, id, dto);
  }

  @Post(':id/accessories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '添加配件批次：名称 / 单价 / 数量 / 购入日期（可关联购买流水）' })
  addAccessory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAccessoryDto,
  ): Promise<AccessoryVo> {
    return this.items.addAccessory(user.id, id, dto);
  }
}

@ApiBearerAuth()
@ApiTags('配件')
@Controller('accessories')
export class AccessoriesController {
  constructor(private readonly items: ItemsService) {}

  @Delete(':id')
  @ApiOperation({ summary: '撤销配件库存：保留批次、购买流水与撤销凭据' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InventoryRevertDto): Promise<null> {
    return this.items.removeAccessory(user.id, id, dto);
  }

  @Post(':id/consume')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: '使用 N 个配件（默认 1）：used_qty + n，不可超过剩余' })
  consume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccessoryQtyDto,
  ): Promise<AccessoryUsageVo> {
    return this.items.consume(user.id, id, dto);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: '撤销使用 N 个配件（默认 1）：used_qty − n，不可小于 0' })
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccessoryQtyDto,
  ): Promise<AccessoryUsageVo> {
    return this.items.restore(user.id, id, dto);
  }
}
