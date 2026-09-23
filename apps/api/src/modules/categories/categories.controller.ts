import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto';
import { ListCategoriesQueryDto } from './dto/category-list.dto';
import { CategoryVo } from './dto/category.vo';

@ApiBearerAuth()
@ApiTags('分类')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: '分类树（最多两级）：默认不含已停用，可传 kind 只取支出或收入' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCategoriesQueryDto): Promise<CategoryVo[]> {
    return this.categories.list(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: '新建分类；parentId 指向顶层分类即为二级' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto): Promise<CategoryVo> {
    return this.categories.create(user.id, dto);
  }

  @Put('order')
  @ApiOperation({ summary: '批量排序 / 跨组移动（移动端拖拽落库）' })
  reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderCategoriesDto): Promise<CategoryVo[]> {
    return this.categories.reorder(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '改名 / 图标 / 颜色 / 父分类 / 排序；archived=true 停用（含子分类）' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryVo> {
    return this.categories.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除分类；已有流水引用时返回 409，请改用停用' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.categories.remove(user.id, id);
  }
}
